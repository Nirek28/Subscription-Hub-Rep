import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import auth from './auth.js';
import { createUser, saveAccountToken, consumeAccountToken } from '../services/repository.js';
import { tokenDigest } from '../services/accountEmails.js';

test('account emails, verification, reset, single use and session invalidation', async () => {
  process.env.SENDGRID_API_KEY = 'test-only';
  process.env.ALERT_FROM_EMAIL = 'sender@example.com';
  process.env.WEB_ORIGIN = 'http://localhost:5173';
  const originalFetch = global.fetch;
  const mails = [];
  global.fetch = async (url, options) => {
    if (String(url) === 'https://api.sendgrid.com/v3/mail/send') { mails.push(JSON.parse(options.body)); return new Response('', { status: 202 }); }
    return originalFetch(url, options);
  };
  const app = express(); app.use(express.json()); app.use('/auth', auth);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, body, cookie) => {
    const res = await originalFetch(base + '/auth' + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, body: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
  };
  const mailToken = () => new URL(mails.at(-1).content[0].value.match(/Open this link: (\S+)/)[1]).hash.slice('#token='.length);
  try {
    const credentials = { name: 'Test User', email: 'account-test@example.com', password: 'old-password-123' };
    assert.equal((await call('/register', credentials)).status, 201);
    assert.equal(mails.length, 1);
    const verification = mailToken();
    const login = await call('/login', credentials);
    assert.equal(login.status, 200);
    assert.equal(login.body.user.emailVerified, false);
    assert.equal((await call('/verify-email', { token: verification })).status, 200);
    assert.equal((await call('/verify-email', { token: verification })).status, 400);
    assert.equal((await call('/me', null, login.cookie)).body.user.emailVerified, true);
    const known = await call('/forgot-password', { email: credentials.email });
    const resetToken = mailToken();
    const unknown = await call('/forgot-password', { email: 'unknown@example.com' });
    assert.deepEqual(known.body, unknown.body);
    assert.equal(mails.length, 2);
    assert.equal((await call('/reset-password', { token: resetToken, password: 'short' })).status, 400);
    const reset = await Promise.all([1, 2].map(() => call('/reset-password', { token: resetToken, password: 'new-password-123' })));
    assert.deepEqual(reset.map(r => r.status).sort(), [200, 400]);
    assert.equal((await call('/me', null, login.cookie)).status, 401);
    assert.equal((await call('/login', credentials)).status, 401);
    assert.equal((await call('/login', { ...credentials, password: 'new-password-123' })).status, 200);
    const before = mails.length;
    await call('/resend-verification', { email: credentials.email });
    assert.equal(mails.length, before);
  } finally {
    global.fetch = originalFetch;
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});

test('expired tokens fail and replacement links invalidate previous tokens', async () => {
  const user = await createUser({ name: 'Expiry Test', email: 'expiry@example.com', passwordHash: 'placeholder' });
  await saveAccountToken(user.id, 'verify', tokenDigest('old'), new Date(Date.now() - 1000));
  assert.equal(await consumeAccountToken('verify', tokenDigest('old')), null);
  await saveAccountToken(user.id, 'verify', tokenDigest('first'), new Date(Date.now() + 60000));
  await saveAccountToken(user.id, 'verify', tokenDigest('second'), new Date(Date.now() + 60000));
  assert.equal(await consumeAccountToken('verify', tokenDigest('first')), null);
  assert.equal((await consumeAccountToken('verify', tokenDigest('second'))).emailVerified, true);
  assert.equal(await consumeAccountToken('reset', tokenDigest('second'), 'newhash'), null);
});
