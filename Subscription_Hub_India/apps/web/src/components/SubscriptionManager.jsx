import React, { useEffect, useState } from 'react';

const RAW_API = (import.meta.env.VITE_API_URL || 'http://localhost:4000/api').trim().replace(/\/+$/, '');
export const API = RAW_API.endsWith('/api') ? RAW_API : `${RAW_API}/api`;

export async function call(path, body, method) {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const finalPath = cleanPath.startsWith('/api/') ? cleanPath.slice(4) : cleanPath;

  const token =
    localStorage.getItem('subhub_token') ||
    localStorage.getItem('token') ||
    localStorage.getItem('authToken') ||
    '';

  const r = await fetch(`${API}${finalPath}`, {
    credentials: 'include',
    method: method || (body ? 'POST' : 'GET'),
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const contentType = r.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await r.json()
    : { error: r.status === 401 ? 'Please sign in to access this feature.' : `Server error (${r.status})` };

  if (!r.ok) {
    throw new Error(data.error || data.message || `Request failed (${r.status})`);
  }
  return data;
}

export default function SubscriptionManager({ onImported }) {
  const [status, setStatus] = useState(null);
  const [consents, setConsents] = useState([]);
  const [vua, setVua] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [batch, setBatch] = useState(null);
  const [keys, setKeys] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [csv, setCsv] = useState('');

  const load = async () => {
    const st = await call('/india/status');
    setStatus(st);
    const cs = await call('/india/aa/consents');
    setConsents(Array.isArray(cs) ? cs : []);
  };

  useEffect(() => {
    load().catch((e) => setMessage(e.message));
  }, []);

  const run = async (fn) => {
    setBusy(true);
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  };

  const preview = async (result) => {
    if (result.pending) {
      setMessage(result.message);
      return;
    }
    setBatch(result);
    setKeys((result.candidates || []).map((c) => c.key));
    setMessage(`${result.analyzedTransactions} transactions checked; ${(result.candidates || []).length} possible subscriptions.`);
  };

  const discard = async () => {
    if (batch) {
      await call(`/india/discovery/${batch.batchId}`, undefined, 'DELETE');
    }
    setBatch(null);
    setKeys([]);
  };

  return (
    <article className="panel india-panel">
      <h2>Discover Indian subscriptions</h2>
      <p>Scan recurring debits, review the matches, then add them to your dashboard. Discovery does not authorize or cancel payments.</p>

      <div className="india-actions">
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await discard();
              await preview(await call('/india/discovery/preview', { demo: true }));
            })
          }
        >
          Try local sample data
        </button>
        <a href="/sample-transactions.csv" download>
          Download CSV template
        </a>
      </div>

      <label>
        Upload bank CSV
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={(e) =>
            run(async () => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > 1000000) throw new Error('File must be under 1 MB.');
              setCsv(await f.text());
            })
          }
        />
      </label>

      <small>
        Columns: date, merchant/narration, amount/debit, type, currency. Use positive debit amounts. Dates: YYYY-MM-DD or DD/MM/YYYY. CSV contents are processed on the server; only candidate summaries are temporarily stored.
      </small>

      <button
        className="primary"
        disabled={!csv || busy}
        onClick={() =>
          run(async () => {
            await discard();
            await preview(await call('/india/discovery/preview', { csv }));
            setCsv('');
          })
        }
      >
        Scan uploaded statement
      </button>

      <hr />

      <h3>
        Connect through Setu AA <span className="settings-badge">{status?.setu?.mode || 'sandbox'}</span>
      </h3>
      <p>
        {status?.setu?.configured
          ? 'Approve data access on Setu’s secure screen, then return here and sync.'
          : 'Setu credentials are not configured. CSV and local sample discovery are available now.'}{' '}
        Sandbox uses provider test data. Live bank access requires approved onboarding.
      </p>

      <label>
        Mobile number or AA handle
        <input
          value={vua}
          onChange={(e) => setVua(e.target.value)}
          placeholder="10-digit mobile or mobile@handle"
          autoComplete="off"
        />
      </label>

      <label className="india-check">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
        />
        Request access to the last 180 days of transactions to identify recurring payments. Review the final consent terms on Setu.
      </label>

      <button
        className="secondary"
        disabled={busy || !accepted || !status?.setu?.configured}
        onClick={() =>
          run(async () => {
            await call('/india/aa/consents', { vua, accepted });
            setVua('');
            await load();
            setMessage('Consent created. Use Open consent to approve on Setu.');
          })
        }
      >
        Create bank-data consent
      </button>

      {consents.map((c) => (
        <div className="india-record" key={c.id}>
          <b>
            {c.mode} · {c.status}
          </b>
          <small>{c.id}</small>
          <div className="india-actions">
            {c.status !== 'REVOKED' && (
              <>
                <a href={c.url} target="_blank" rel="noreferrer">
                  Open consent
                </a>
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await preview(await call(`/india/aa/consents/${c.id}/sync`, {}));
                      await load();
                    })
                  }
                >
                  Sync and scan
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await call(`/india/aa/consents/${c.id}/revoke`, {});
                      await discard();
                      await load();
                      setMessage('Bank-data consent revoked. Payment mandates are unchanged.');
                    })
                  }
                >
                  Revoke data consent
                </button>
              </>
            )}
          </div>
        </div>
      ))}

      {batch && (
        <div className="india-results">
          <h3>Review possible subscriptions · {batch.source}</h3>
          <p>Confirm the merchant, price and estimated renewal. Repeated payments can be rent or instalments rather than subscriptions.</p>
          {(batch.candidates || []).map((c) => (
            <label className="india-record india-check" key={c.key}>
              <input
                type="checkbox"
                checked={keys.includes(c.key)}
                onChange={(e) =>
                  setKeys(e.target.checked ? [...keys, c.key] : keys.filter((k) => k !== c.key))
                }
              />
              <span>
                <b>
                  {c.name} · Rs.{c.billedAmount} / {c.billingCycle}
                </b>
                <small>
                  {c.occurrences} payments · {c.confidence} confidence · estimated renewal{' '}
                  {new Date(c.renewalDate).toLocaleDateString('en-IN')}
                </small>
              </span>
            </label>
          ))}
          <div className="india-actions">
            <button
              className="primary"
              disabled={busy || !keys.length}
              onClick={() =>
                run(async () => {
                  const r = await call('/india/discovery/confirm', {
                    batchId: batch.batchId,
                    keys,
                  });
                  await discard();
                  await onImported?.();
                  setMessage(`Added ${r.imported}; ${r.skipped} already tracked.`);
                })
              }
            >
              Confirm selected subscriptions
            </button>
            <button className="secondary" disabled={busy} onClick={() => run(discard)}>
              Discard scan
            </button>
          </div>
        </div>
      )}

      {message && (
        <p role="status" className="india-notice">
          {message}
        </p>
      )}
    </article>
  );
}