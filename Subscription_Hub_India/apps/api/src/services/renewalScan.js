import { indiaDay as utcDay } from './indiaTime.js';
import { get, put } from './integrationStore.js';
import { findUserById, listAllActiveSubscriptions, listUsage } from './repository.js';
import { buildEmail, generateAlert, riskLevel, usageTrend } from './alertWriter.js';
import { sendEmail } from './mailer.js';

// Daily scan (Module 5): finds renewals in the next 3 days, builds each 3-month usage trend,
// asks Gemini (or local rules) for a churn alert, and emails one digest per user.
export async function runRenewalScan(now = new Date(), deps = {}) {
  const { generate = generateAlert, send = sendEmail, lookupUser = findUserById, onlyUserId = null } = deps;
  const start = utcDay(now);
  const horizon = new Date(start);
  horizon.setUTCDate(horizon.getUTCDate() + 3);
  const subscriptions = (await listAllActiveSubscriptions()).filter((sub) => !onlyUserId || sub.userId === onlyUserId);
  const due = subscriptions.filter((sub) => {
    const renewal = utcDay(sub.renewalDate);
    return renewal >= start && renewal <= horizon;
  });

  const usageByUser = new Map();
  const itemsByUser = new Map();
  const alerts = [];
  for (const sub of due) {
    if (!usageByUser.has(sub.userId)) usageByUser.set(sub.userId, await listUsage(sub.userId));
    const trend = usageTrend(usageByUser.get(sub.userId), sub.id, now);
    const risk = riskLevel(trend);
    const renewalDate = new Date(sub.renewalDate).toISOString().slice(0, 10);
    const daysLeft = Math.round((utcDay(sub.renewalDate) - start) / 86400000);
    const alert = await generate({ name: sub.name, monthlyCost: sub.monthlyCost, renewalDate, daysLeft, trend, risk });
    const item = { subscriptionId: sub.id, name: sub.name, monthlyCost: sub.monthlyCost, renewalDate, trend, risk, alertText: alert.text };
    if (!itemsByUser.has(sub.userId)) itemsByUser.set(sub.userId, []);
    itemsByUser.get(sub.userId).push(item);
    alerts.push({
      subscriptionId: sub.id,
      userId: sub.userId,
      renewalDate,
      hoursLastThreeMonths: Number(trend.reduce((sum, h) => sum + h, 0).toFixed(1)),
      lowUsage: risk === 'high',
      risk,
      alertSource: alert.source
    });
  }

  let emailsSent = 0;
  let emailsPreviewed = 0;
  let emailsFailed = 0;
  for (const [userId, items] of itemsByUser) {
    try {
      const user = await lookupUser(userId);
      if (!user?.email) continue;
      const key = `${userId}:${start.toISOString().slice(0,10)}`;
      if (await get('reminder', key, userId)) continue;
      const result = await send(buildEmail(user, items));
      if (result.sent) await put('reminder', key, userId, { sentAt: new Date().toISOString() }, new Date(Date.now()+35*86400000));
      if (result.sent) emailsSent += 1; else emailsPreviewed += 1;
    } catch (error) {
      emailsFailed += 1;
      console.error('[alerts] email failed:', error.message);
    }
  }
  return { dueCount: due.length, lowUsageCount: alerts.filter((a) => a.lowUsage).length, emailsSent, emailsPreviewed, emailsFailed, alerts };
}