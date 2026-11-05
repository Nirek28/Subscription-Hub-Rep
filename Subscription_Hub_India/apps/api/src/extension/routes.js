import { Router } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { randomBytes, randomUUID } from 'node:crypto';
import { requireAuth } from '../services/auth.js';
import { findUserById, listSubscriptions } from '../services/repository.js';
import * as store from './store.js';
import { hash, catalog, validateEvent, splitInterval } from './core.js';
const router = Router();
const origin = () => new URL(process.env.WEB_ORIGIN || 'http://localhost:5173').origin;
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
router.use(cors({ origin: (value, done) => done(null, !value || value === origin() || /^chrome-extension:\/\/[a-p]{32}$/.test(value)), credentials: true, allowedHeaders: ['Content-Type', 'Authorization'], methods: ['GET','POST','PUT','DELETE','OPTIONS'] }));
router.use(rateLimit({ windowMs: 60000, limit: 120, standardHeaders: true, legacyHeaders: false }));
router.use((req, res, next) => {
  if (!['GET','HEAD','OPTIONS'].includes(req.method) && !req.is('application/json')) return res.status(415).json({ error: 'Use application/json.' });
  next();
});
const website = [ (req, res, next) => {
  if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.get('origin') !== origin()) return res.status(403).json({ error: 'Website origin required.' });
  next();
}, requireAuth ];
const device = wrap(async (req, res, next) => {
  const token = req.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  const row = token && await store.get('device:' + hash(token));
  if (!row || row.data.expiresAt <= Date.now() || !await findUserById(row.userId)) return res.status(401).json({ error: 'Reconnect this extension from website Settings.' });
  req.device = row; next();
});
async function configuration(userId) {
  const mapping = (await store.get('config:' + userId))?.data || [];
  const subs = await listSubscriptions(userId);
  return mapping.filter(m => subs.some(s => s.id === m.subscriptionId && s.status === 'active')).map(m => ({ ...catalog.find(c => c.key === m.key), subscriptionId: m.subscriptionId }));
}
router.get('/settings', ...website, wrap(async (req,res) => {
  const devices = await store.rows(req.user.id, 'device:');
  res.json({ catalog, subscriptions: (await listSubscriptions(req.user.id)).filter(s => s.status === 'active').map(s => ({ id:s.id, name:s.name })), mappings: await configuration(req.user.id), devices: devices.map(x => ({ id: x.data.id, name:x.data.name, expiresAt:x.data.expiresAt, lastSync:x.data.lastSync })) });
}));
router.put('/settings', ...website, wrap(async (req,res) => {
  const mappings = req.body.mappings;
  const subs = await listSubscriptions(req.user.id);
  if (!Array.isArray(mappings) || mappings.length > catalog.length || mappings.some(m => !m || !catalog.some(c => c.key === m.key) || !subs.some(s => s.id === m.subscriptionId && s.status === 'active')) || new Set(mappings.map(m=>m.key)).size !== mappings.length || new Set(mappings.map(m=>m.subscriptionId)).size !== mappings.length) return res.status(400).json({ error:'Choose a different active subscription for each enabled website.' });
  await store.put('config:' + req.user.id, req.user.id, mappings.map(({ key, subscriptionId }) => ({ key, subscriptionId })));
  res.json({ ok:true });
}));
router.post('/pairing-code', ...website, wrap(async (req,res) => {
  // Only one pending code per user; creation invalidates the old code.
  for (const row of await store.rows(req.user.id, 'pair:')) await store.remove(row._id);
  const code = randomBytes(24).toString('hex'), expiresAt = Date.now() + 5 * 60000;
  await store.put('pair:' + hash(code), req.user.id, { expiresAt });
  res.json({ code, expiresAt });
}));
router.post('/pair', rateLimit({ windowMs:15*60000, limit:20, standardHeaders:true, legacyHeaders:false }), wrap(async (req,res) => {
  if (typeof req.body.code !== 'string' || !/^[a-f0-9]{48}$/.test(req.body.code)) return res.status(400).json({ error:'Invalid pairing code.' });
  const pairing = await store.take('pair:' + hash(req.body.code));
  if (!pairing || pairing.data.expiresAt <= Date.now() || !await findUserById(pairing.userId)) return res.status(400).json({ error:'Code expired or already used. Generate a new code.' });
  const token = randomBytes(32).toString('hex'), id = randomUUID(), expiresAt = Date.now() + 30*86400000;
  await store.put('device:' + hash(token), pairing.userId, { id, name:String(req.body.name || 'Chrome browser').slice(0,60), expiresAt, lastSync:null });
  res.json({ token, deviceId:id, expiresAt });
}));
router.get('/config', device, wrap(async(req,res) => res.json({ mappings:await configuration(req.device.userId), expiresAt:req.device.data.expiresAt })));
router.post('/usage/batch', device, wrap(async (req,res) => {
  const events = req.body.events;
  if (!Array.isArray(events) || !events.length || events.length > 100) return res.status(400).json({ error:'Send between 1 and 100 events.' });
  const mappings = await configuration(req.device.userId), accepted = [], rejected = [];
  for (const event of events) {
    let interval;
    try {
      interval = validateEvent(event);
      if (!mappings.some(m => m.subscriptionId === event.subscriptionId)) throw new Error('Subscription is no longer enabled for tracking.');
    } catch (e) { rejected.push({ eventId:event?.eventId, reason:e.message }); continue; }
    let part = 0;
    for (const piece of splitInterval(interval)) {
      const _id = hash([req.device.userId, req.device.data.id, event.eventId, part++].join(':'));
      await store.saveUsage({ _id, userId:req.device.userId, subscriptionId:event.subscriptionId, deviceId:req.device.data.id, source:'browser', cost:0, ...piece, receivedAt:new Date() });
    }
    accepted.push(event.eventId);
  }
  // Do not recreate a device which was revoked while this request was running.
  await store.touch(req.device._id);
  res.json({ accepted, rejected });
}));
router.delete('/devices/:id', ...website, wrap(async(req,res) => {
  const row = (await store.rows(req.user.id,'device:')).find(x => x.data.id === req.params.id);
  if (row) await store.remove(row._id);
  res.json({ ok:true });
}));
router.delete('/history', ...website, wrap(async(req,res) => {
  for (const row of await store.rows(req.user.id,'device:')) await store.remove(row._id);
  await store.deleteUsage(req.user.id);
  res.json({ ok:true });
}));
router.use((_req,res) => res.status(404).json({ error:'Unknown extension endpoint.' }));
export default router;
