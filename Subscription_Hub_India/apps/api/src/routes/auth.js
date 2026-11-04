import rateLimit from 'express-rate-limit';
import { sendAccountLink, tokenDigest } from '../services/accountEmails.js';
import { consumeAccountToken } from '../services/repository.js';
import { Router } from 'express';
import { createUser, findUserByEmail } from '../services/repository.js';
import { clearSessionCookie, requireAuth, setSessionCookie } from '../services/auth.js';
import { hashPassword, verifyPassword } from '../services/passwords.js';

const router = Router();
router.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, skip: req => req.method === 'GET', standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many account requests. Try again in 15 minutes.' } }));
const validEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

router.post('/register', async (req, res, next) => {
  try {
    const { name = '', email = '', password = '' } = req.body || {};
    if (String(name).trim().length < 2 || String(name).trim().length > 100) return res.status(400).json({ error: 'Enter a name between 2 and 100 characters.' });
    if (!validEmail(String(email))) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (String(password).length < 8 || String(password).length > 128) return res.status(400).json({ error: 'Password must be between 8 and 128 characters.' });
    const user = await createUser({ name: String(name), email: String(email), passwordHash: await hashPassword(String(password)) });
    if (!user) return res.status(409).json({ error: 'An account with that email already exists. Sign in instead.' });
    let message = 'Account created. Check your inbox to verify your email, then sign in.';
    try { await sendAccountLink(user, 'verify'); } catch (error) {
      console.error('[auth] verification email failed:', error.message);
      message = 'Account created, but the verification email could not be sent. Use Resend verification to try again.';
    }
    res.status(201).json({ user, message });
  } catch (error) { next(error); }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email = '', password = '' } = req.body || {};
    if (!validEmail(String(email)) || !password || String(password).length > 128) return res.status(400).json({ error: 'Enter a valid email and a password no longer than 128 characters.' });
    const record = await findUserByEmail(String(email));
    const valid = record ? await verifyPassword(String(password), record.passwordHash) : false;
    if (!record || !valid) return res.status(401).json({ error: 'Email or password is incorrect.' });
    const user = { id: record.id, name: record.name, email: record.email, emailVerified: !!record.emailVerified, sessionVersion: record.sessionVersion || 0 };
    setSessionCookie(res, user);
    res.json({ user });
  } catch (error) { next(error); }
});

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));
router.post('/logout', (_req, res) => { clearSessionCookie(res); res.json({ ok: true }); });

const genericMessage = 'If an eligible account exists, an email will arrive shortly. Check Spam too.';
for (const [path, purpose] of [['/forgot-password', 'reset'], ['/resend-verification', 'verify']]) {
  router.post(path, async (req, res, next) => {
    try {
      const email = String(req.body?.email || '').trim();
      if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
      const user = await findUserByEmail(email);
      if (user && (purpose === 'reset' || !user.emailVerified)) {
        try { await sendAccountLink(user, purpose); }
        catch (error) { console.error('[auth] account email failed:', error.message); }
      }
      res.json({ message: genericMessage });
    } catch (error) { next(error); }
  });
}
for (const [path, purpose] of [['/reset-password', 'reset'], ['/verify-email', 'verify']]) {
  router.post(path, async (req, res, next) => {
    try {
      const { token = '', password = '' } = req.body || {};
      if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ error: 'Invalid link. Request a new one.' });
      if (purpose === 'reset' && (typeof password !== 'string' || password.length < 8 || password.length > 128)) return res.status(400).json({ error: 'Password must be between 8 and 128 characters.' });
      const user = await consumeAccountToken(purpose, tokenDigest(token), purpose === 'reset' ? await hashPassword(password) : undefined);
      if (!user) return res.status(400).json({ error: 'This link has expired or was already used. Request a new one.' });
      if (purpose === 'reset') clearSessionCookie(res);
      res.json({ message: purpose === 'reset' ? 'Password reset. Sign in with your new password.' : 'Email verified. You can now sign in.' });
    } catch (error) { next(error); }
  });
}
export default router;
