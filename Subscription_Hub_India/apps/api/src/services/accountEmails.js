import { createHash, randomBytes } from 'node:crypto';
import { saveAccountToken } from './repository.js';
import { sendEmail } from './mailer.js';
export const tokenDigest = token => createHash('sha256').update(token).digest('hex');
export async function sendAccountLink(user, purpose) {
  // Never log account-action links or fall back to email preview mode.
  if (!process.env.SENDGRID_API_KEY || !process.env.ALERT_FROM_EMAIL) throw new Error('Account email delivery is not configured.');
  const base = new URL(process.env.WEB_ORIGIN || 'http://localhost:5173');
  if (process.env.NODE_ENV === 'production' && base.protocol !== 'https:') throw new Error('WEB_ORIGIN must use HTTPS in production.');
  const token = randomBytes(32).toString('hex');
  const minutes = purpose === 'reset' ? 30 : 1440;
  await saveAccountToken(user.id, purpose, tokenDigest(token), new Date(Date.now() + minutes * 60000));
  // Fragments keep tokens out of HTTP request URLs and referrer headers.
  base.pathname = purpose === 'reset' ? '/reset-password' : '/verify-email';
  base.search = ''; base.hash = new URLSearchParams({ token }).toString();
  const subject = purpose === 'reset' ? 'Reset your Subscription Hub password' : 'Verify your Subscription Hub email';
  const result = await sendEmail({ to: user.email, subject, text: `${subject}\n\nOpen this link: ${base.href}\n\nThis single-use link expires in ${minutes === 30 ? '30 minutes' : '24 hours'}. If you did not request this, ignore this email.` });
  if (!result.sent) throw new Error('Account email was not sent.');
}
