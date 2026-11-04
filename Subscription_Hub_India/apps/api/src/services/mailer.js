// Sends through SendGrid when SENDGRID_API_KEY and ALERT_FROM_EMAIL are set (no extra npm package needed).
// Otherwise prints the email to the terminal so the whole flow can be demonstrated without an account.
export async function sendEmail({ to, subject, text }) {
  const apiKey = process.env.SENDGRID_API_KEY;
  const from = process.env.ALERT_FROM_EMAIL;
  if (!apiKey || !from) {
    console.log(`\n[mail:preview] SendGrid not configured, email NOT sent.\nTo: ${to}\nSubject: ${subject}\n\n${text}\n`);
    return { sent: false, mode: 'preview' };
  }
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ personalizations: [{ to: [{ email: to }] }], from: { email: from }, subject, content: [{ type: 'text/plain', value: text }] })
  });
  if (!response.ok) throw new Error(`SendGrid rejected the email (HTTP ${response.status}). Check the API key and that ${from} is a verified sender.`);
  return { sent: true, mode: 'sendgrid' };
}