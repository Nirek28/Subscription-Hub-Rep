import { createHash } from 'node:crypto';
export const hash = value => createHash('sha256').update(value).digest('hex');
export const catalog = [
  { key: 'netflix', name: 'Netflix', domains: ['netflix.com'] },
  { key: 'spotify', name: 'Spotify web player', domains: ['open.spotify.com'] },
  { key: 'canva', name: 'Canva', domains: ['canva.com'] },
  { key: 'youtube', name: 'YouTube', domains: ['youtube.com'] },
  { key: 'prime', name: 'Prime Video', domains: ['primevideo.com'] },
  { key: 'chatgpt', name: 'ChatGPT', domains: ['chatgpt.com'] }
];
export function validateEvent(e, now = Date.now()) {
  if (!e || typeof e.eventId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(e.eventId) || typeof e.subscriptionId !== 'string') throw new Error('Invalid event identity.');
  const start = Date.parse(e.startedAt), end = Date.parse(e.endedAt), seconds = e.activeSeconds;
  if (!Number.isFinite(start) || !Number.isFinite(end) || typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0 || end <= start || end - start > 90000 || seconds * 1000 > end - start + 1 || start < now - 14 * 86400000 || end > now + 60000) throw new Error('Invalid interval; maximum 90 seconds, retained for 14 days.');
  return { start, end, seconds };
}
// Split at India midnight, so late uploads remain in their original month.
export function splitInterval({ start, end, seconds }) {
  const parts = [], offset = 330 * 60000, duration = end - start;
  for (let t = start; t < end;) {
    const boundary = (Math.floor((t + offset) / 86400000) + 1) * 86400000 - offset;
    const stop = Math.min(end, boundary);
    parts.push({ recordedAt: new Date(t), hours: seconds * (stop - t) / duration / 3600 }); t = stop;
  }
  return parts;
}
