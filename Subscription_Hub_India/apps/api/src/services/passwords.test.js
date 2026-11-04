import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from './passwords.js';

test('password hashes do not store the raw password and verify correctly', async () => {
  const raw = 'correct-horse-battery';
  const hashed = await hashPassword(raw);
  assert.notEqual(hashed, raw);
  assert.equal(await verifyPassword(raw, hashed), true);
  assert.equal(await verifyPassword('wrong-password', hashed), false);
});

test('password hashing uses a different salt per account', async () => {
  const [first, second] = await Promise.all([hashPassword('same-password'), hashPassword('same-password')]);
  assert.notEqual(first, second);
});
