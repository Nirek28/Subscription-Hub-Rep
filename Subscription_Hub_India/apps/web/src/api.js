// Single place that decides where API requests go.
//
// Default (recommended): same-origin. Requests go to "/api/..." on whatever host
// served the page.
//   - Local dev : Vite proxies /api -> http://localhost:4000 (see vite.config.js)
//   - Production: Vercel rewrites /api/* -> your Render service (see vercel.json)
// Same-origin keeps the SameSite=Strict session cookie working and avoids CORS.
//
// Optional: set VITE_API_URL to a full origin (e.g. https://my-api.onrender.com)
// to call the API directly. Only do this if you also relax the cookie settings,
// because a Vercel -> Render call is cross-site.
const ORIGIN = '';

// Every server route lives under /api. Callers may pass '/india/status' or
// '/api/auth/me'; both resolve to '/api/...'.
export function apiUrl(path) {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${ORIGIN}${p === '/api' || p.startsWith('/api/') ? p : `/api${p}`}`;
}

// fetch + JSON with errors that make sense to a human. A cold-starting or
// misrouted backend often returns HTML, which would otherwise surface as the
// cryptic "Unexpected token '<' ... is not valid JSON".
export async function apiFetch(path, options = {}) {
  let response;
  try {
    response = await fetch(apiUrl(path), {
      credentials: 'include',
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
  } catch {
    throw new Error('Cannot reach the API. If it just woke up on Render, wait ~30s and retry.');
  }
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  if (!response.ok) {
    if (data?.error) throw new Error(data.error);
    if (response.status === 404) throw new Error(`API route not found (${path}). Check the /api rewrite in vercel.json.`);
    if ([502, 503, 504].includes(response.status)) throw new Error('The API is waking up or unavailable. Retry in a few seconds.');
    throw new Error(`Request failed (${response.status}).`);
  }
  if (data === null) throw new Error('The API returned an unexpected (non-JSON) response.');
  return data;
}