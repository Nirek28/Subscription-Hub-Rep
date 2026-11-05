import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const project = process.cwd();
const file = path.join(
  project, 'apps', 'api', 'src', 'routes', 'india.test.js'
);
const temporary = path.join(
  path.dirname(file), `india-diagnostic-${process.pid}.test.js`
);

let created = false;

try {
  let code = fs.readFileSync(file, 'utf8');

  const pattern = /async function user\(email\)\{[^\r\n]*\}/;

  if (!pattern.test(code)) {
    throw new Error('Could not locate the test helper. No files changed.');
  }

  code = code.replace(pattern, `async function user(email) {
    const registration = await request('/auth/register', {
      name: 'Tester', email, password: 'password123'
    });

    console.log('DIAGNOSTIC registration:',
      registration.status, JSON.stringify(registration.data));

    assert.equal(registration.status, 201);

    const login = await request('/auth/login', {
      email, password: 'password123'
    });

    console.log('DIAGNOSTIC login:',
      login.status, 'Cookie present:', !!login.cookie);

    assert.equal(login.status, 200);
    assert.ok(login.cookie, 'Session cookie missing');
    return login.cookie;
  }`);

  fs.writeFileSync(temporary, code, { flag: 'wx' });
  created = true;

  const result = spawnSync(process.execPath, ['--test', temporary], {
    cwd: path.join(project, 'apps', 'api'),
    stdio: 'inherit'
  });

  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (created) fs.unlinkSync(temporary);
}