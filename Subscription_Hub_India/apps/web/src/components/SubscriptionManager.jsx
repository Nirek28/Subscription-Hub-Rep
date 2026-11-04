import React, { useEffect, useState } from 'react';

import { apiFetch } from '../api.js';

export async function call(path, body, method) {
  return apiFetch(path, {
    method: method || (body ? 'POST' : 'GET'),
    ...(body ? { body: JSON.stringify(body) } : {})
  });
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
  const [fileName, setFileName] = useState('');
  const [seedSandbox, setSeedSandbox] = useState(false);

  const load = async () => {
    setStatus(await call('/india/status'));
    setConsents(await call('/india/aa/consents'));
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
    setKeys(result.candidates.map((c) => c.key));
    setMessage(
      `${result.analyzedTransactions} transactions checked; ${result.candidates.length} possible subscriptions. ${result.rejected} invalid, credit or non-INR rows skipped.${result.partial ? ' Partial bank data; other accounts may still be pending.' : ''}`
    );
  };

  const discard = async () => {
    if (batch) {
      try {
        await call(`/india/discovery/${batch.batchId}`, undefined, 'DELETE');
      } catch {
        // Safe discard: ignore if batch already deleted or expired
      }
    }
    setBatch(null);
    setKeys([]);
  };

  const handleFileChange = (e) => {
    run(async () => {
      const f = e.target.files?.[0];
      if (!f) return;
      if (f.size > 1000000) throw new Error('File must be under 1 MB.');
      setFileName(f.name);
      setCsv(await f.text());
    });
  };

  return (
    <article className="panel india-panel">
      <h2>Discover Indian subscriptions</h2>
      <p>Scan recurring debits, review the matches, then add them to your dashboard. Discovery does not authorize or cancel payments.</p>

      <div className="india-actions">
        <button
          className="secondary"
          type="button"
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
        <a className="button-link secondary-link" href="/sample-transactions.csv" download>
          Download CSV template ↓
        </a>
      </div>

      <div className="file-upload-wrapper">
        <label className="file-upload-box">
          <span className="file-browse-btn">Choose CSV file</span>
          <span className="file-name-display">{fileName || 'No statement selected (max 1 MB)'}</span>
          <input type="file" accept=".csv,text/csv" disabled={busy} onChange={handleFileChange} />
        </label>
      </div>

      <small style={{ color: '#828694', margin: '6px 0 12px', display: 'block' }}>
        Expected columns: date, merchant/narration, amount/debit, type, currency. Use positive debit amounts. Dates: YYYY-MM-DD or DD/MM/YYYY.
      </small>

      <div className="india-actions">
        <button
          className="primary"
          type="button"
          disabled={!csv || busy}
          onClick={() =>
            run(async () => {
              await discard();
              await preview(await call('/india/discovery/preview', { csv }));
              setCsv('');
              setFileName('');
            })
          }
        >
          Scan uploaded statement ↗
        </button>
      </div>

      <hr />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h3>Connect through Setu AA</h3>
        <span className="settings-badge">{status?.setu?.mode || 'sandbox'}</span>
      </div>

      <p>
        {status?.setu?.configured
          ? 'Approve data access on Setu’s secure screen, then return here and sync.'
          : 'Setu credentials are not configured. CSV and local sample discovery are available now.'}{' '}
        Sandbox uses provider test data. Live bank access requires approved onboarding.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 440 }}>
        <input
          type="text"
          value={vua}
          onChange={(e) => setVua(e.target.value)}
          placeholder="10-digit mobile or mobile@handle"
          autoComplete="off"
        />

        <label className="india-check">
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
          <span>Request access to the last 180 days of transactions to identify recurring payments. Review the final consent terms on Setu.</span>
        </label>

        <button
          className="secondary"
          type="button"
          style={{ width: 'fit-content' }}
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
      </div>

      {status?.setu?.mode === 'sandbox' && status?.setu?.configured && (
        <label className="india-check" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={seedSandbox} onChange={(e) => setSeedSandbox(e.target.checked)} />
          <span>Sandbox test: after Sync &amp; scan, automatically add a few subscriptions (detected ones first; labelled samples if the Setu test data has none).</span>
        </label>
      )}

      {consents.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8', margin: '0 0 12px', letterSpacing: '0.3px', textTransform: 'uppercase' }}>
            Active & Pending Consents
          </h4>
          {consents.map((c) => {
            const isActive = (c.status || '').toUpperCase() === 'ACTIVE' || (c.status || '').toUpperCase() === 'APPROVED';
            const isRevoked = (c.status || '').toUpperCase() === 'REVOKED';

            return (
              <div
                key={c.id}
                style={{
                  background: '#16181e',
                  border: '1px solid #272a36',
                  borderRadius: 10,
                  padding: '16px 18px',
                  marginBottom: 14,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
                }}
              >
                {/* Header Row: Title/Provider on left, Badges on right */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 8,
                        background: '#1f232d',
                        border: '1px solid #2d3240',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 16,
                      }}
                    >
                      🏦
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#f1f5f9' }}>
                        Setu Account Aggregator
                      </div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>
                        Automated Bank Statement Sync
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: '0.5px',
                        padding: '4px 10px',
                        borderRadius: 20,
                        textTransform: 'uppercase',
                        background: isActive ? '#143322' : isRevoked ? '#33191d' : '#332914',
                        color: isActive ? '#86efac' : isRevoked ? '#fca5a5' : '#fde047',
                        border: `1px solid ${isActive ? '#225438' : isRevoked ? '#542229' : '#594419'}`,
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: isActive ? '#4ade80' : isRevoked ? '#f87171' : '#facc15',
                          boxShadow: isActive ? '0 0 6px #4ade80' : 'none',
                        }}
                      />
                      {c.status}
                    </span>

                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#94a3b8',
                        background: '#1e222b',
                        border: '1px solid #2e3442',
                        padding: '4px 8px',
                        borderRadius: 6,
                        textTransform: 'uppercase',
                      }}
                    >
                      {c.mode || 'sandbox'}
                    </span>
                  </div>
                </div>

                {/* Identifier Row */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    background: '#101116',
                    border: '1px solid #20232c',
                    borderRadius: 6,
                    padding: '8px 12px',
                    fontSize: 12,
                    color: '#94a3b8',
                    overflow: 'hidden',
                  }}
                >
                  <span style={{ color: '#64748b', fontSize: 11, fontWeight: 500 }}>Consent ID:</span>
                  <span
                    style={{
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                      color: '#cbd5e1',
                      fontSize: 11,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={c.id}
                  >
                    {c.id}
                  </span>
                </div>

                {/* Actions Toolbar */}
                {!isRevoked && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 10,
                      paddingTop: 8,
                      borderTop: '1px solid #222530',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        disabled={busy}
                        style={{
                          background: '#d9f99d',
                          color: '#14200c',
                          fontWeight: 600,
                          fontSize: 13,
                          padding: '8px 16px',
                          borderRadius: 6,
                          border: 'none',
                          cursor: busy ? 'not-allowed' : 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          transition: 'opacity 0.15s ease',
                          opacity: busy ? 0.6 : 1,
                        }}
                        onClick={() =>
                          run(async () => {
                            const res = await call(`/india/aa/consents/${c.id}/sync`, { seedSandbox: seedSandbox && status?.setu?.mode === 'sandbox' });
                            if (res.seeded) {
                              setBatch(null);
                              setKeys([]);
                              await onImported?.();
                              setMessage(`Sandbox test: added ${res.seeded.added.length} subscription(s) (${res.seeded.added.map((a) => a.name + (a.sample ? ' [sample]' : '')).join(', ') || 'none'}); ${res.seeded.skipped} already existed.`);
                            } else {
                              await preview(res);
                            }
                            await load();
                          })
                        }
                      >
                        🔄 Sync & scan transactions
                      </button>

                      {c.url && (
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            background: '#20232c',
                            color: '#cbd5e1',
                            fontSize: 13,
                            fontWeight: 500,
                            padding: '8px 14px',
                            borderRadius: 6,
                            border: '1px solid #313644',
                            textDecoration: 'none',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            transition: 'all 0.15s ease',
                          }}
                        >
                          Open consent portal ↗
                        </a>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={busy}
                      style={{
                        background: 'transparent',
                        color: '#f87171',
                        fontSize: 12,
                        fontWeight: 500,
                        padding: '7px 12px',
                        borderRadius: 6,
                        border: '1px solid #4a1d24',
                        cursor: busy ? 'not-allowed' : 'pointer',
                        transition: 'background 0.15s ease',
                        opacity: busy ? 0.6 : 1,
                      }}
                      onClick={() =>
                        run(async () => {
                          await call(`/india/aa/consents/${c.id}/revoke`, {});
                          await discard();
                          await load();
                          setMessage('Bank-data consent revoked. Payment mandates are unchanged.');
                        })
                      }
                    >
                      Revoke consent
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {batch && (
        <div className="india-results" style={{ marginTop: 20 }}>
          <h3>Review possible subscriptions · {batch.source}</h3>
          <p>Confirm the merchant, price and estimated renewal. Repeated payments can be rent or instalments rather than subscriptions.</p>
          {batch.candidates.map((c) => (
            <label className="india-record india-check" key={c.key} style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={keys.includes(c.key)}
                onChange={(e) => setKeys(e.target.checked ? [...keys, c.key] : keys.filter((k) => k !== c.key))}
              />
              <span>
                <b style={{ color: '#f3f4f6', fontSize: 12 }}>
                  {c.name} · ₹{c.billedAmount} / {c.billingCycle}
                </b>
                <small style={{ color: '#898d98', display: 'block', marginTop: 3 }}>
                  {c.occurrences} payments · {c.confidence} confidence · estimated renewal{' '}
                  {new Date(c.renewalDate).toLocaleDateString('en-IN')}
                  {c.stale ? ' · historical / overdue: verify manually' : ''}
                </small>
              </span>
            </label>
          ))}
          <div className="india-actions" style={{ marginTop: 14 }}>
            <button
              className="primary"
              type="button"
              disabled={busy || !keys.length}
              onClick={() =>
                run(async () => {
                  const r = await call('/india/discovery/confirm', { batchId: batch.batchId, keys });
                  await discard();
                  await onImported?.();
                  setMessage(`Added ${r.imported}; ${r.skipped} already tracked.`);
                })
              }
            >
              Confirm selected subscriptions
            </button>
            <button className="secondary" type="button" disabled={busy} onClick={() => run(discard)}>
              Discard preview
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