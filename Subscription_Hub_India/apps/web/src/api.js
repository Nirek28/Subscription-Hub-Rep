
// All website API requests use the current website origin.
// Vercel forwards /api requests to the backend through Cloudflare Tunnel.
// Local Vite development forwards /api requests to localhost:4000.

export function apiUrl(path) {
  const normalized = path.startsWith('/') ? path : `/${path}`;

  return normalized === '/api' || normalized.startsWith('/api/')
    ? normalized
    : `/api${normalized}`;
}

export async function apiFetch(path, options = {}) {
  let response;

  try {
    response = await fetch(apiUrl(path), {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
  } catch {
    throw new Error(
      'Cannot reach the API. Check your internet connection, backend, and Cloudflare Tunnel.'
    );
  }

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // A stopped tunnel or incorrect rewrite can return HTML instead of JSON.
  }

  if (!response.ok) {
    if (data?.error) {
      throw new Error(data.error);
    }

    if (response.status === 404) {
      throw new Error(
        `API route not found (${path}). Check the /api rewrite in vercel.json.`
      );
    }

    if ([502, 503, 504, 530].includes(response.status)) {
      throw new Error(
        'The backend is unavailable. Make sure the backend and Cloudflare Tunnel are running and Vercel uses the current tunnel URL.'
      );
    }

    throw new Error(`Request failed (${response.status}).`);
  }

  if (data === null) {
    throw new Error(
      'The API returned an unexpected response. Check the Cloudflare Tunnel URL and Vercel API rewrite.'
    );
  }

  return data;
}