import { createHmac, timingSafeEqual } from 'node:crypto';
import { findUserById } from './repository.js';
const COOKIE_NAME = 'subscription_hub_session';
const SESSION_SECONDS = 60 * 60 * 24;
const sessionSecret = () => process.env.SESSION_SECRET || 'development-only-change-this-session-secret';

function signSession(user) {
  const payload = Buffer.from(JSON.stringify({ sub: user.id, version: user.sessionVersion || 0, name: user.name, email: user.email, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS })).toString('base64url');
  const signature = createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifySession(token) {
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = createHmac('sha256', sessionSecret()).update(payload).digest();
  let supplied;
  try { supplied = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.sub || !data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch { return null; }
}

function cookieOptions() {
  return `Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}
export function setSessionCookie(res, user) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${signSession(user)}; ${cookieOptions()}`);
}
export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}
function readCookie(req, name) {
  const item = (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : '';
}

export async function requireAuth(req, res, next) {
  try {
    const session = verifySession(readCookie(req, COOKIE_NAME));
    if (!session) return res.status(401).json({ error: 'Please sign in to continue.' });
    const user = await findUserById(session.sub);
    if (!user || (session.version || 0) !== user.sessionVersion) return res.status(401).json({ error: 'Your session is no longer valid. Please sign in again.' });
    req.user = user;
    next();
  } catch (error) { next(error); }
}
