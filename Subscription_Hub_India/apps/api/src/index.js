import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cron from 'node-cron';
import api from './routes/api.js';
import auth from './routes/auth.js';
import indiaRoutes from './routes/india.js';
import razorpayRoutes, { webhook } from './routes/razorpay.js';
import { requireAuth } from './services/auth.js';
import { initializeRepository, repositoryMode } from './services/repository.js';
import { runRenewalScan } from './services/renewalScan.js';


const apiDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(apiDir, '../../../.env') });
dotenv.config({ path: resolve(apiDir, '../.env') });

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) throw new Error('SESSION_SECRET must be configured in production.');
if (!process.env.SESSION_SECRET) console.warn('Using development-only SESSION_SECRET. Set SESSION_SECRET in .env before deployment.');

const app = express();
app.use(helmet());
app.use(cors({
  origin: true,
  credentials: true
}));
app.post('/api/webhooks/razorpay', express.raw({ type: 'application/json', limit: '1mb' }), webhook);
app.use(express.json({ limit: '2mb' }));
app.use('/api', (req,res,next) => {
  if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.get('origin') && req.get('origin') !== (process.env.WEB_ORIGIN || 'http://localhost:5173')) return res.status(403).json({error:'Origin not allowed.'});
  if (!['GET','HEAD','OPTIONS'].includes(req.method) && !req.is('application/json')) return res.status(415).json({error:'Use application/json.'});
  next();
});
app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false }));

app.get('/api/health', (_req, res) => res.json({
  ok: true,
  mode: repositoryMode(),
  auth: 'enabled',
  integrations: { region: 'India' }
}));
app.use('/api/auth', auth);
app.use('/api/india', requireAuth, indiaRoutes);
app.use('/api/razorpay', requireAuth, razorpayRoutes);
app.use('/api', requireAuth, api);
app.use((err, _req, res, _next) => { console.error(err.message); res.status(err.status || 500).json({ error: err.status ? err.message : 'Unexpected server error.' }); });

const mode = await initializeRepository();
console.log(`[cron] ${process.env.ENABLE_CRON === 'true' ? `enabled, schedule "${process.env.CRON_SCHEDULE || '0 0 * * *'}"` : 'disabled (set ENABLE_CRON=true)'}`);
if (process.env.ENABLE_CRON === 'true') cron.schedule(process.env.CRON_SCHEDULE || '0 0 * * *', async () => {
  try {
    const result = await runRenewalScan();
    console.log(`[cron] ${result.dueCount} renewals due in 3 days; ${result.lowUsageCount} low-usage; emails sent ${result.emailsSent}, previewed ${result.emailsPreviewed}, failed ${result.emailsFailed}.`);
  } catch (error) { console.error('[cron] renewal scan failed:', error.message); }
}, { timezone: process.env.CRON_TIMEZONE || 'Asia/Kolkata' });
const port = Number(process.env.PORT || 4000);
app.listen(port, () => console.log(`Subscription Hub API listening on :${port} (${mode} data)`));