import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInsights, calculateProration, sanitizeTransactions, summarizeAnalytics, validateCancelUrl } from './domain.js';

test('analytics totals spend only for active subscriptions', () => {
  const subs = [{ id: 'a', status: 'active', monthlyCost: 10, name: 'A' }, { id: 'b', status: 'canceled', monthlyCost: 90, name: 'B' }];
  const result = summarizeAnalytics(subs, [{ subscriptionId: 'a', hours: 2, cost: 10, recordedAt: new Date() }]);
  assert.equal(result.monthlySpend, 10); assert.equal(result.activeCount, 1); assert.equal(result.bySubscription[0].costPerHour, 5);
});
test('analytics use only usage recorded in the current UTC month', () => {
  const now = new Date();
  const priorMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 12));
  const result = summarizeAnalytics(
    [{ id: 'a', status: 'active', monthlyCost: 120, name: 'A' }],
    [
      { subscriptionId: 'a', hours: 3, cost: 8, recordedAt: new Date() },
      { subscriptionId: 'a', hours: 100, cost: 20, recordedAt: priorMonth }
    ]
  );
  assert.equal(result.bySubscription[0].hoursThisMonth, 3);
  assert.equal(result.bySubscription[0].costPerHour, 40);
  assert.equal(result.bySubscription[0].usageCostThisMonth, 8);
});
test('low-usage insights are sorted by recurring cost', () => {
  const result = buildInsights([{ subscriptionId: 'a', name: 'A', monthlyCost: 8, hoursThisMonth: 1 }, { subscriptionId: 'b', name: 'B', monthlyCost: 20, hoursThisMonth: 0 }]);
  assert.equal(result[0].subscriptionId, 'b');
});
test('transaction sanitizer rejects invalid amounts and unsafe URLs', () => {
  assert.equal(sanitizeTransactions([{ merchant: 'Netflix', amount: 15 }, { merchant: 'bad', amount: -1 }]).length, 1);
  assert.equal(validateCancelUrl('javascript:alert(1)'), '');
  assert.match(validateCancelUrl('https://example.com/cancel'), /^https:/);
});
test('proration preview calculates each line-item credit for the unused days', () => {
  const result = calculateProration({
    periodStart: '2026-10-01',
    periodEnd: '2026-11-01',
    effectiveDate: '2026-10-17',
    lineItems: [
      { description: 'Base plan', quantity: 1, unitAmount: 310, currency: 'INR' },
      { description: 'Seat add-on', quantity: 2, unitAmount: 31, currency: 'INR' }
    ]
  });
  assert.equal(result.periodDays, 31);
  assert.equal(result.unusedDays, 15);
  assert.equal(result.totalInvoiceAmount, 372);
  assert.equal(result.estimatedCredit, 180);
  assert.equal(result.lineItems.length, 2);
});
test('proration rejects invalid periods and mixed currencies', () => {
  assert.throws(() => calculateProration({
    periodStart: '2026-10-01', periodEnd: '2026-10-01', effectiveDate: '2026-10-02',
    lineItems: [{ description: 'Plan', unitAmount: 100 }]
  }), /valid billing dates/);
  assert.throws(() => calculateProration({
    periodStart: '2026-10-01', periodEnd: '2026-11-01', effectiveDate: '2026-10-02',
    lineItems: [{ description: 'INR plan', unitAmount: 100, currency: 'INR' }, { description: 'USD fee', unitAmount: 10, currency: 'USD' }]
  }), /same currency/);
});
