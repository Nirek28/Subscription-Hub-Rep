import { indiaDay } from '../services/indiaTime.js';
import { cancelBilling } from '../services/billing.js';
import { runRenewalScan } from '../services/renewalScan.js';
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { addSubscription, addUsage, getSubscription, listSubscriptions, listUsage, saveSubscription } from '../services/repository.js';
import { buildInsights, calculateProration, sanitizeTransactions, summarizeAnalytics, validateCancelUrl } from '../services/domain.js';
import { buildEffectiveRows, clampMultiplier, getInsightsForUser } from '../services/insights.js';

const router = Router();
router.get('/subscriptions', async (req, res, next) => { try { res.json(await listSubscriptions(req.user.id)); } catch (e) { next(e); } });
router.post('/billing/proration-preview', (req, res) => {
  try { res.json(calculateProration(req.body || {})); }
  catch (error) { res.status(400).json({ error: error.message }); }
});
router.post('/subscriptions', async (req, res, next) => {
  try {
    const { name, merchant, category = 'Other', monthlyCost, renewalDate, cancelUrl = '' } = req.body || {};
    const cost = Number(monthlyCost);
    const date = new Date(renewalDate);
    if (!name || !merchant || !Number.isFinite(cost) || cost < 0 || Number.isNaN(date.getTime())) return res.status(400).json({ error: 'name, merchant, non-negative monthlyCost, and valid renewalDate are required' });
    const created = await addSubscription({ name: String(name).slice(0, 100), merchant: String(merchant).slice(0, 100), category: String(category).slice(0, 40), monthlyCost: cost, currency: 'INR', renewalDate: date, cancelUrl: validateCancelUrl(cancelUrl) }, req.user.id);
    res.status(201).json(created);
  } catch (e) { next(e); }
});
router.get('/analytics', async (req, res, next) => {
  try { const [subs, logs] = await Promise.all([listSubscriptions(req.user.id), listUsage(req.user.id)]); const summary = summarizeAnalytics(subs, logs); res.json({ ...summary, insights: buildInsights(summary.bySubscription) }); }
  catch (e) { next(e); }
});
router.get('/usage', async (req, res, next) => { try { res.json(await listUsage(req.user.id)); } catch (e) { next(e); } });
router.post('/usage', async (req, res, next) => {
  try {
    const { subscriptionId, source = 'manual', hours, cost = 0 } = req.body || {};
    const parsedHours = Number(hours), parsedCost = Number(cost);
    if (!subscriptionId || !['manual', 'browser', 'spotify', 'demo'].includes(source) || !Number.isFinite(parsedHours) || parsedHours < 0 || parsedHours > 10000 || !Number.isFinite(parsedCost) || parsedCost < 0) return res.status(400).json({ error: 'Valid subscriptionId, source, non-negative hours, and cost are required.' });
    if (!await getSubscription(subscriptionId, req.user.id)) return res.status(404).json({ error: 'Subscription not found.' });
    res.status(201).json(await addUsage({ subscriptionId, source, hours: parsedHours, cost: parsedCost }, req.user.id));
  } catch (e) { next(e); }
});
router.post('/subscriptions/:id/cancel', async (req, res, next) => {
  try {
    const sub = await getSubscription(req.params.id, req.user.id);
    if (!sub) return res.status(404).json({ error: 'Subscription not found.' });
    if (sub.status === 'canceled') return res.json({ status: 'canceled', idempotent: true, subscription: sub });
    if(sub.provider === 'razorpay') {
      if(req.body?.confirmed!==true) return res.status(400).json({error:'Confirm cancellation first.'});
      const subscription=await cancelBilling(sub.id,req.user.id);
      return res.json({status:subscription.status,subscription,notice:'Razorpay subscription status refreshed.'});
    }
    const cancelUrl = validateCancelUrl(sub.cancelUrl);
    if (!cancelUrl) return res.status(409).json({ error: 'No verified HTTPS cancellation link is available.', status: sub.status });
    res.json({ status: 'redirect_required', cancelUrl, notice: 'Continue on the provider site to complete cancellation.' });
  } catch (e) { next(e); }
});
router.post('/subscriptions/:id/confirm-canceled', async (req, res, next) => {
  try {
    const confirmed = req.body?.confirmed === true;
    if (!confirmed) return res.status(400).json({ error: 'Set confirmed=true after the provider confirms cancellation.' });
    const sub = await getSubscription(req.params.id, req.user.id);
    if (!sub) return res.status(404).json({ error: 'Subscription not found.' });
    if(sub.provider==='razorpay') return res.status(409).json({error:'Use provider cancellation and sync for Razorpay subscriptions.'});
    sub.status = 'canceled';
    await saveSubscription(sub, req.user.id);
    res.json({ status: 'canceled', subscription: sub, notice: 'Marked canceled based on your confirmation. Verify the status with the provider.' });
  } catch (e) { next(e); }
});
router.get('/notifications/preview', async (req, res, next) => {
  try {
    const subscriptions = await listSubscriptions(req.user.id);
    const today = indiaDay(new Date());
    const horizon = new Date(today);
    horizon.setUTCDate(horizon.getUTCDate() + 3);
    const soon = subscriptions.filter((s) => {
      const renewal = indiaDay(s.renewalDate);
      return s.status === 'active' && renewal >= today && renewal <= horizon;
    });
    res.json({ count: soon.length, items: soon.map((s) => ({ id: s.id, name: s.name, renewalDate: s.renewalDate, monthlyCost: s.monthlyCost })), mode: 'preview-only', emailSent: false });
  } catch (e) { next(e); }
});
// Dev helper: runs the same scan as the daily cron, for the signed-in user only.
router.get('/notifications/run-now', async (req, res, next) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).json({ error: 'Not found.' });
  try { res.json(await runRenewalScan(new Date(), { onlyUserId: req.user.id })); } catch (e) { next(e); }
});
router.get('/analytics/ai-insights', async (req, res, next) => {
  try {
    const [subs, logs] = await Promise.all([listSubscriptions(req.user.id), listUsage(req.user.id)]);
    const summary = summarizeAnalytics(subs, logs);
    const rows = buildEffectiveRows(summary.bySubscription, subs);
    res.json({ ...(await getInsightsForUser(req.user.id, rows, { refresh: req.query.refresh === '1' })), generatedAt: new Date().toISOString() });
  } catch (e) { next(e); }
});
router.post('/subscriptions/:id/ux-multiplier', async (req, res, next) => {
  try {
    const value = Number(req.body?.multiplier);
    if (!Number.isFinite(value) || value < 1 || value > 5) return res.status(400).json({ error: 'multiplier must be a number between 1 and 5.' });
    const sub = await getSubscription(req.params.id, req.user.id);
    if (!sub) return res.status(404).json({ error: 'Subscription not found.' });
    sub.uxMultiplier = clampMultiplier(value);
    await saveSubscription(sub, req.user.id);
    res.json({ subscriptionId: sub.id, uxMultiplier: sub.uxMultiplier });
  } catch (e) { next(e); }
});
export default router;
