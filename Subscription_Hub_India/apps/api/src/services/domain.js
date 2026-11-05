import { indiaMonthBounds } from './indiaTime.js';
import { randomUUID } from 'node:crypto';

export function validateCancelUrl(value) {
  if (!value) return '';
  try { const url = new URL(value); return url.protocol === 'https:' ? url.toString() : ''; }
  catch { return ''; }
}

export function summarizeAnalytics(subscriptions, usageLogs) {
  const active = subscriptions.filter((s) => s.status === 'active');
  const monthlySpend = active.reduce((sum, s) => sum + Number(s.monthlyCost || 0), 0);
  const now = new Date();
  const [monthStart, nextMonthStart] = indiaMonthBounds(now);
  const bySubscription = active.map((s) => {
    const logs = usageLogs.filter((log) => {
      const recordedAt = new Date(log.recordedAt || log.createdAt).getTime();
      return log.subscriptionId === s.id && recordedAt >= monthStart && recordedAt < nextMonthStart;
    });
    const hours = logs.reduce((sum, log) => sum + Number(log.hours || 0), 0);
    return {
      subscriptionId: s.id,
      name: s.name,
      monthlyCost: s.monthlyCost,
      hours,
      costPerHour: hours > 0 ? Number((Number(s.monthlyCost || 0) / hours).toFixed(2)) : null,
      hoursThisMonth: hours,
      browserHours: logs.filter(log => log.source === 'browser').reduce((sum, log) => sum + Number(log.hours || 0), 0),
      manualHours: logs.filter(log => log.source === 'manual').reduce((sum, log) => sum + Number(log.hours || 0), 0),
      usageCostThisMonth: Number(logs.reduce((sum, log) => sum + Number(log.cost || 0), 0).toFixed(2))
    };
  });
  return { monthlySpend: Number(monthlySpend.toFixed(2)), activeCount: active.length, canceledCount: subscriptions.filter(s=>s.status==='canceled').length, bySubscription };
}

export function buildInsights(rows) {
  return rows.filter((row) => row.hoursThisMonth < 5)
    .sort((a, b) => b.monthlyCost - a.monthlyCost)
    .slice(0, 3)
    .map((row) => ({ type: 'low-usage', subscriptionId: row.subscriptionId, title: `${row.name} may be underused`, detail: `${row.hoursThisMonth} tracked hours against ₹${Number(row.monthlyCost).toFixed(2)}/month. Review before renewal.` }));
}

const merchantCatalog = {
  netflix: { name: 'Netflix Premium', category: 'Entertainment', cancelUrl: 'https://www.netflix.com/cancelplan' },
  spotify: { name: 'Spotify Premium', category: 'Music', cancelUrl: 'https://www.spotify.com/account/subscription/' },
  cloudbox: { name: 'Cloud Storage Plus', category: 'Productivity', cancelUrl: 'https://example.com/account/billing' },
  'studio fitness': { name: 'Studio Fitness', category: 'Lifestyle', cancelUrl: 'https://example.com/membership' }
};
export function sanitizeTransactions(transactions) {
  return transactions.map((tx) => {
    const merchant = String(tx.merchant || '').trim().slice(0, 100);
    const found = merchantCatalog[merchant.toLowerCase()];
    const amount = Number(tx.amount);
    if (!merchant || !Number.isFinite(amount) || amount <= 0 || amount > 100000) return null;
    return { id: `discovered-${randomUUID()}`, name: found?.name || merchant, merchant, category: found?.category || 'Other', monthlyCost: Number(amount.toFixed(2)), currency: 'INR', renewalDate: new Date(Date.now() + 30 * 86400000), cancelUrl: validateCancelUrl(found?.cancelUrl), status: 'active' };
  }).filter(Boolean);
}

const parseIsoDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(NaN);
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : new Date(NaN);
};
const utcDay = (value) => Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());

/**
 * Estimate the unused portion of a billing period for each invoice line.
 * Billing periods are treated as half-open [start, end) UTC calendar dates.
 * This is an estimate only; providers may apply different contract rules.
 */
export function calculateProration({ periodStart, periodEnd, effectiveDate, lineItems }) {
  const start = parseIsoDate(periodStart);
  const end = parseIsoDate(periodEnd);
  const effective = parseIsoDate(effectiveDate);
  if (![start, end, effective].every((date) => Number.isFinite(date.getTime())) || end <= start) {
    throw new Error('Provide valid billing dates with periodEnd after periodStart.');
  }
  if (!Array.isArray(lineItems) || lineItems.length < 1 || lineItems.length > 50) {
    throw new Error('Provide between 1 and 50 invoice line items.');
  }
  const periodDays = (utcDay(end) - utcDay(start)) / 86400000;
  const unusedDays = Math.max(0, Math.min(periodDays, (utcDay(end) - Math.max(utcDay(start), utcDay(effective))) / 86400000));
  const ratio = unusedDays / periodDays;
  const normalized = lineItems.map((item) => {
    const description = String(item?.description || '').trim().slice(0, 120);
    const quantity = Number(item?.quantity ?? 1);
    const unitAmount = Number(item?.unitAmount);
    const currency = String(item?.currency || 'INR').toUpperCase();
    if (!description || !Number.isFinite(quantity) || quantity <= 0 || quantity > 10000 ||
      !Number.isFinite(unitAmount) || unitAmount < 0 || unitAmount > 10000000 ||
      !/^[A-Z]{3}$/.test(currency)) {
      throw new Error('Each line item needs a description, positive quantity, non-negative unit amount, and 3-letter currency.');
    }
    return { description, quantity, unitAmount, currency, lineTotal: Number((quantity * unitAmount).toFixed(2)) };
  });
  const currencies = new Set(normalized.map((item) => item.currency));
  if (currencies.size !== 1) throw new Error('All line items must use the same currency.');
  const currency = normalized[0].currency;
  const lines = normalized.map((item) => ({
    ...item,
    proratedCredit: Math.round(item.lineTotal * ratio * 100) / 100
  }));
  return {
    currency,
    periodDays,
    unusedDays,
    effectiveDate: effective.toISOString().slice(0, 10),
    totalInvoiceAmount: Number(lines.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2)),
    estimatedCredit: Number(lines.reduce((sum, item) => sum + item.proratedCredit, 0).toFixed(2)),
    lineItems: lines,
    disclaimer: 'Estimate only. The billing provider and contract determine the actual proration.'
  };
}
