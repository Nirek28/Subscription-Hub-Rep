export const matches = (host, domain) => host === domain || host.endsWith('.' + domain);
export const patterns = mapping => mapping.domains.map(d => `https://${d === 'open.spotify.com' ? '' : '*.'}${d}/*`);
export function trackedSubscription(tab, focused, idle, mappings) {
  if (!focused || idle !== 'active' || !tab || tab.incognito || !tab.url) return null;
  let url; try { url = new URL(tab.url); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  return mappings.find(m => m.domains.some(d => matches(url.hostname, d)))?.subscriptionId || null;
}
export function interval(anchor, now, session, eventId) {
  const elapsed = now - (anchor?.at || now);
  // Long or backwards gaps are unobserved (sleep, restart, delayed alarm).
  if (!anchor?.subscriptionId || anchor.session !== session || elapsed <= 0 || elapsed > 60000) return null;
  return { eventId, subscriptionId:anchor.subscriptionId, startedAt:new Date(anchor.at).toISOString(), endedAt:new Date(now).toISOString(), activeSeconds:elapsed / 1000 };
}
