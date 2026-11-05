import test from 'node:test';
import assert from 'node:assert/strict';

Object.assign(process.env, {
  SETU_BASE_URL: 'https://fiu-sandbox.setu.co', SETU_MODE: 'sandbox',
  SETU_PRODUCT_INSTANCE_ID: 'product-test', SETU_CLIENT_ID: 'client-test', SETU_CLIENT_SECRET: 'secret-test'
});
const { setu, setuDiagnose } = await import('./providers.js');
const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });

const html403 = () => new Response('<html><body><h1>403 Forbidden</h1></body></html>', { status: 403, headers: { 'content-type': 'text/html', server: 'awselb/2.0' } });

test('firewall HTML 403 gives a clear, non-credential message', async () => {
  globalThis.fetch = async () => html403();
  await assert.rejects(() => setu('/consents', 'POST', {}), e => e.code === 'SETU_FIREWALL' && /allowlist/.test(e.message) && e.status === 502);
});

test('JSON 401 still reports the provider message', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'Token issuer not allowed' }), { status: 401, headers: { 'content-type': 'application/json' } });
  await assert.rejects(() => setu('/consents', 'POST', {}), e => /Token issuer not allowed/.test(e.message));
});

test('diagnose reports a firewall block without leaking secrets', async () => {
  globalThis.fetch = async () => html403();
  const d = await setuDiagnose();
  assert.equal(d.authStep, 'blocked-by-firewall');
  assert.ok(!JSON.stringify(d).includes('secret-test'));
});

test('diagnose reports success when login and API are reachable', async () => {
  globalThis.fetch = async (url) => String(url).includes('users/login')
    ? new Response(JSON.stringify({ success: true, data: { token: 't' } }), { status: 200 })
    : new Response(JSON.stringify({ message: 'not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  const d = await setuDiagnose();
  assert.equal(d.authStep, 'ok');
  assert.equal(d.consentApi, 'reachable');
});