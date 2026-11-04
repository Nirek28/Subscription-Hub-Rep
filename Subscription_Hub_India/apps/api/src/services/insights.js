const TYPES = ['redundancy', 'tier', 'low-usage'];
const money = (value) => `₹${Number(value || 0).toFixed(2)}`;
const median = (values) => { const s = [...values].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };
export const clampMultiplier = (value) => { const n = Number(value); return Number.isFinite(n) ? Math.min(5, Math.max(1, Number(n.toFixed(2)))) : 1; };

// Effective cost per hour = monthly cost / (tracked hours x mobile/TV multiplier).
export function buildEffectiveRows(bySubscription, subscriptions) {
  const byId = new Map((subscriptions || []).map((sub) => [sub.id, sub]));
  return (bySubscription || []).map((row) => {
    const sub = byId.get(row.subscriptionId) || {};
    const multiplier = clampMultiplier(sub.uxMultiplier || 1);
    const tracked = Number(row.hoursThisMonth || 0);
    const effectiveHours = Number((tracked * multiplier).toFixed(1));
    const cost = Number(row.monthlyCost || 0);
    return {
      subscriptionId: row.subscriptionId,
      name: row.name,
      category: sub.category || 'Other',
      monthlyCost: cost,
      trackedHours: Number(tracked.toFixed(1)),
      uxMultiplier: multiplier,
      effectiveHours,
      effectiveCostPerHour: effectiveHours > 0 ? Number((cost / effectiveHours).toFixed(2)) : null
    };
  });
}

// Rule-based insights, used when Gemini is unavailable.
export function localInsights(rows) {
  const out = [];
  const byCategory = new Map();
  for (const row of rows) {
    if (!row.category || row.category === 'Other') continue;
    if (!byCategory.has(row.category)) byCategory.set(row.category, []);
    byCategory.get(row.category).push(row);
  }
  for (const [category, group] of byCategory) {
    if (group.length < 2) continue;
    const keep = [...group].sort((a, b) => b.effectiveHours - a.effectiveHours || b.monthlyCost - a.monthlyCost)[0];
    const saving = group.filter((row) => row !== keep).reduce((sum, row) => sum + row.monthlyCost, 0);
    out.push({
      type: 'redundancy',
      title: `Overlapping ${category} services`,
      detail: `You pay for ${group.map((row) => row.name).join(' and ')}, which overlap in ${category}. ${keep.name} gets the most use, so cancelling the others could save up to ${money(saving)} per month.`,
      services: group.map((row) => row.name),
      estimatedMonthlySaving: Number(saving.toFixed(2))
    });
  }
  const withData = rows.filter((row) => row.effectiveCostPerHour != null).map((row) => row.effectiveCostPerHour);
  const med = withData.length >= 3 ? median(withData) : null;
  for (const row of rows) {
    if (row.effectiveHours < 5) {
      out.push({
        type: 'low-usage',
        title: `${row.name} is barely used`,
        detail: `${row.effectiveHours} estimated hours this month for ${money(row.monthlyCost)}. Consider a cheaper plan or cancelling before the next renewal.`,
        services: [row.name],
        estimatedMonthlySaving: Number(row.monthlyCost.toFixed(2))
      });
    } else if (med && row.effectiveCostPerHour > med * 2) {
      out.push({
        type: 'tier',
        title: `${row.name} costs more per hour than your other services`,
        detail: `${money(row.effectiveCostPerHour)} per hour against a typical ${money(med)}. A cheaper tier or an ad-supported plan may fit your usage.`,
        services: [row.name],
        estimatedMonthlySaving: null
      });
    }
  }
  return out.sort((a, b) => (b.estimatedMonthlySaving || 0) - (a.estimatedMonthlySaving || 0)).slice(0, 5);
}

export function buildInsightsPrompt(rows) {
  const data = rows.map(({ name, category, monthlyCost, trackedHours, uxMultiplier, effectiveHours, effectiveCostPerHour }) => ({ name, category, monthlyCostINR: monthlyCost, trackedHours, uxMultiplier, effectiveHours, effectiveCostPerHourINR: effectiveCostPerHour }));
  return [
    'You review a person\'s subscriptions and find waste. Use ONLY the data below; never invent services, prices or hours.',
    'Find: (1) "redundancy": services that overlap in purpose; (2) "tier": a service whose cost per hour is high so a cheaper tier or plan may suit them; (3) "low-usage": services barely used.',
    'Return ONLY a JSON array (no markdown), at most 5 items, each with exactly these keys:',
    '"type" (redundancy | tier | low-usage), "title" (max 80 chars), "detail" (max 250 chars, plain text, practical advice), "services" (array of exact service names from the data), "estimatedMonthlySaving" (number in INR, not more than the total monthlyCostINR of the named services, or null if unsure).',
    'If everything looks reasonable, return [].',
    '',
    'Subscriptions: ' + JSON.stringify(data)
  ].join('\n');
}

// Validates model output: only known services, capped savings, allowed types.
export function normalizeInsights(raw, rows) {
  const byName = new Map(rows.map((row) => [row.name.toLowerCase(), row]));
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!TYPES.includes(item?.type)) continue;
    const title = String(item.title || '').trim().slice(0, 100);
    const detail = String(item.detail || '').trim().slice(0, 300);
    if (!title || !detail || seen.has(title.toLowerCase())) continue;
    const named = (Array.isArray(item.services) ? item.services : []).map((s) => byName.get(String(s).toLowerCase())).filter(Boolean);
    const cap = named.reduce((sum, row) => sum + row.monthlyCost, 0);
    const saving = Number(item.estimatedMonthlySaving);
    seen.add(title.toLowerCase());
    out.push({
      type: item.type,
      title,
      detail,
      services: named.map((row) => row.name),
      estimatedMonthlySaving: named.length && Number.isFinite(saving) && saving >= 0 ? Number(Math.min(saving, cap).toFixed(2)) : null
    });
    if (out.length === 5) break;
  }
  return out;
}

async function callGemini(rows, { apiKey, model }) {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const generative = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model, generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } });
  const result = await generative.generateContent(buildInsightsPrompt(rows));
  const text = result.response.text().replace(/```json/gi, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : parsed?.insights;
}

let quotaPausedUntil = 0;

export async function generateInsights(rows, { apiKey = process.env.GEMINI_API_KEY, model = process.env.GEMINI_MODEL || 'gemini-3.8-flash', llm = callGemini } = {}) {
  if (!rows.length) return { insights: [], source: 'none', warning: null };
  let warning = null;
  if (apiKey && Date.now() >= quotaPausedUntil) {
    try { return { insights: normalizeInsights(await llm(rows, { apiKey, model }), rows), source: 'gemini', warning: null }; }
    catch (error) {
      if (/429|quota/i.test(error.message)) { quotaPausedUntil = Date.now() + 60 * 60 * 1000; warning = 'Gemini quota reached, so rule-based insights are shown.'; console.warn('[insights] Gemini quota reached; pausing AI calls for an hour.'); }
      else { warning = 'AI analysis failed, so rule-based insights are shown.'; console.warn('[insights] Gemini failed:', error.message.slice(0, 200)); }
    }
  } else if (apiKey) warning = 'Gemini quota reached, so rule-based insights are shown.';
  return { insights: localInsights(rows), source: 'local-rules', warning };
}

// Cache so page loads and multiplier tweaks don't burn the free Gemini quota.
const cache = new Map();
const cacheKey = (rows) => JSON.stringify([...rows].map((r) => [r.name, r.category, Math.round(r.monthlyCost), Math.floor(r.effectiveHours / 5)]).sort());

export async function getInsightsForUser(userId, rows, { refresh = false, ...options } = {}) {
  const key = cacheKey(rows);
  const hit = cache.get(userId);
  if (!refresh && hit && hit.key === key && Date.now() < hit.expires) return { ...hit.result, rows, cached: true };
  const result = await generateInsights(rows, options);
  cache.set(userId, { key, result, expires: Date.now() + (result.source === 'gemini' ? 6 * 3600_000 : 10 * 60_000) });
  return { ...result, rows, cached: false };
}