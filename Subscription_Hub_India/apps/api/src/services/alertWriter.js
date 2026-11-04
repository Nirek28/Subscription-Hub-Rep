const money = (value) => `₹${Number(value || 0).toFixed(2)}`;
const startOfUtcMonth = (date, offset = 0) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1);

export function usageTrend(logs, subscriptionId, now = new Date()) {
  return [-2, -1, 0].map((offset) => {
    const from = startOfUtcMonth(now, offset);
    const to = startOfUtcMonth(now, offset + 1);
    const hours = (logs || [])
      .filter((log) => log.subscriptionId === subscriptionId)
      .filter((log) => { const t = new Date(log.recordedAt || log.createdAt).getTime(); return t >= from && t < to; })
      .reduce((sum, log) => sum + Number(log.hours || 0), 0);
    return Number(hours.toFixed(1));
  });
}

export function riskLevel(trend) {
  const total = trend.reduce((sum, h) => sum + h, 0);
  if (total < 5) return 'high';
  if (trend[0] > 0 && trend[2] < trend[0] * 0.5) return 'medium';
  return 'low';
}

export function localAlertText({ name, monthlyCost, daysLeft, trend, risk }) {
  const total = trend.reduce((sum, h) => sum + h, 0);
  const when = daysLeft <= 0 ? 'today' : daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`;
  if (risk === 'high') return `${name} renews ${when} for ${money(monthlyCost)}, but you logged only ${total.toFixed(1)} hours in the last 3 months. Consider cancelling or downgrading before it renews.`;
  if (risk === 'medium') return `${name} renews ${when} for ${money(monthlyCost)}. Your usage has dropped sharply (${trend.join(' → ')} hours per month), so it may be worth reviewing.`;
  return `${name} renews ${when} for ${money(monthlyCost)}. Your recent usage (${trend.join(' → ')} hours per month) looks healthy.`;
}

export function buildAlertPrompt({ name, monthlyCost, renewalDate, daysLeft, trend, risk }) {
  return [
    'Write a short, friendly churn alert (maximum 50 words, plain text, no markdown, no emojis) for a subscription that renews soon.',
    'Use only the facts below. Do not invent numbers. Suggest the user review or cancel before renewal if usage is low or falling; otherwise say it looks worthwhile.',
    `Facts: ${JSON.stringify({ service: name, monthlyCostINR: Number(monthlyCost), renewsOn: renewalDate, daysLeft, hoursPerMonthLastThreeMonths: trend, risk })}`
  ].join('\n');
}

async function callGemini(input, { apiKey, model }) {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const generative = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model, generationConfig: { temperature: 0.4 } });
  const result = await generative.generateContent(buildAlertPrompt(input));
  return result.response.text();
}

// Only service name, cost, date and monthly hours go to Gemini: no email, user id or bank data.
let quotaPausedUntil = 0;

// Only service name, cost, date and monthly hours go to Gemini: no email, user id or bank data.
export async function generateAlert(input, { apiKey = process.env.GEMINI_API_KEY, model = process.env.GEMINI_MODEL || 'gemini-3.8-flash', llm = callGemini } = {}) {
  if (apiKey && Date.now() >= quotaPausedUntil) {
    try {
      const text = String(await llm(input, { apiKey, model })).replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim().slice(0, 400);
      if (text) return { text, source: 'gemini' };
    } catch (error) {
      if (/429|quota/i.test(error.message)) {
        quotaPausedUntil = Date.now() + 60 * 60 * 1000;
        console.warn('[alerts] Gemini quota reached; using built-in alert text for the next hour.');
      } else {
        console.warn('[alerts] Gemini failed, using built-in text:', error.message.slice(0, 200));
      }
    }
  }
  return { text: localAlertText(input), source: 'local-rules' };
}

export function buildEmail(user, items, webOrigin = process.env.WEB_ORIGIN || 'http://localhost:5173') {
  const lines = [`Hi ${user.name || 'there'},`, '', `${items.length} subscription${items.length === 1 ? '' : 's'} renew${items.length === 1 ? 's' : ''} within 3 days:`, ''];
  items.forEach((item, i) => {
    lines.push(`${i + 1}. ${item.name}: ${money(item.monthlyCost)} on ${item.renewalDate} (risk: ${item.risk})`);
    lines.push(`   Hours per month (last 3 months): ${item.trend.join(', ')}`);
    lines.push(`   ${item.alertText}`);
    lines.push(`   Review or cancel: ${webOrigin}/cancel/${item.subscriptionId}`);
    lines.push('');
  });
  lines.push('You are receiving this because renewal alerts are enabled for your Subscription Hub account.');
  return { to: user.email, subject: `Subscription Hub: ${items.length} renewal${items.length === 1 ? '' : 's'} in the next 3 days`, text: lines.join('\n') };
}