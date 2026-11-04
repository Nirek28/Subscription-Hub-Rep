import React, { useEffect, useState } from 'react';
import { call } from './SubscriptionManager.jsx';

let checkoutLoading;
function loadCheckout() {
  if (window.Razorpay) return Promise.resolve();
  if (!checkoutLoading) {
    checkoutLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.onload = resolve;
      s.onerror = () => {
        checkoutLoading = null;
        reject(new Error('Unable to load Razorpay Checkout.'));
      };
      document.body.appendChild(s);
    });
  }
  return checkoutLoading;
}

export default function IndiaBilling({ onChanged }) {
  const [status, setStatus] = useState(null);
  const [plans, setPlans] = useState([]);
  const [plan, setPlan] = useState('');
  const [subs, setSubs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState(null);

  const load = async () => {
    const st = await call('/india/status');
    setStatus(st);
    const fetchedSubs = await call('/razorpay/subscriptions');
    setSubs(Array.isArray(fetchedSubs) ? fetchedSubs : []);
    if (st?.razorpay?.configured) {
      const ps = await call('/razorpay/plans');
      const planList = Array.isArray(ps) ? ps : [];
      setPlans(planList);
      setPlan((p) => p || planList[0]?.id || '');
    }
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

  const refresh = async () => {
    await load();
    await onChanged?.();
  };

  const checkout = async (sub) => {
    await loadCheckout();
    new window.Razorpay({
      key: sub.key || status?.razorpay?.key,
      subscription_id: sub.id,
      name: 'Subscription Hub',
      description: 'Authorize merchant subscription',
      handler: (response) =>
        run(async () => {
          const r = await call('/razorpay/verify', response);
          await refresh();
          setMessage(`Signature verified. Provider status: ${r.subscription.providerStatus}.`);
        }),
      modal: {
        ondismiss: () =>
          setMessage('Checkout closed. No payment success assumed; sync to check status.'),
      },
    }).open();
  };

  return (
    <article className="panel india-panel">
      <h2>Merchant subscriptions · Razorpay</h2>
      <p>
        Subscribe to this merchant’s plans through UPI AutoPay or other methods enabled in Razorpay. This cannot take over Netflix or other external subscriptions.
      </p>
      <b>
        Mode: {status?.razorpay?.mode || 'test'} ·{' '}
        {status?.razorpay?.configured ? 'credentials configured' : 'not configured'}
      </b>

      {status?.razorpay?.mode === 'live' && (
        <p className="india-notice">LIVE PAYMENTS: authorizing a plan may debit real money.</p>
      )}

      <div className="india-actions">
        <select aria-label="Merchant plan" value={plan} onChange={(e) => setPlan(e.target.value)}>
          <option value="">Select a plan</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · Rs.{p.amount / 100} every {p.interval}{' '}
              {p.period === 'yearly' ? 'year(s)' : 'month(s)'}
            </option>
          ))}
        </select>
        <button
          className="primary"
          disabled={busy || !plan}
          onClick={() =>
            run(async () => {
              await loadCheckout();
              const sub = await call('/razorpay/subscriptions', {
                planId: plan,
                requestId: crypto.randomUUID(),
              });
              await refresh();
              await checkout(sub);
            })
          }
        >
          Subscribe and authorize
        </button>
      </div>

      {!plans.length && (
        <p>
          Set RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_PLAN_IDS in .env. Create an INR monthly or yearly plan in the same Razorpay account/mode first.
        </p>
      )}

      {subs.map((s) => (
        <div className="india-record" key={s.id}>
          <b>
            {s.id} · {s.status} · {s.mode}
          </b>
          <small>
            {s.lastSyncedAt
              ? `Updated ${new Date(s.lastSyncedAt).toLocaleString('en-IN')}`
              : 'Waiting for authorization'}
          </small>
          <div className="india-actions">
            {s.status === 'created' && (
              <button disabled={busy} onClick={() => run(() => checkout(s))}>
                Resume authorization
              </button>
            )}
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await call(`/razorpay/subscriptions/${s.id}/sync`, {});
                  await refresh();
                  setMessage('Status synchronized with Razorpay.');
                })
              }
            >
              Sync status
            </button>
            <button
              disabled={busy}
              onClick={() =>
                run(async () =>
                  setHistory({
                    id: s.id,
                    ...(await call(`/razorpay/subscriptions/${s.id}/payments`)),
                  })
                )
              }
            >
              Payment history
            </button>
            {!['cancelled', 'completed', 'expired'].includes(s.status) && (
              <button
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      'Cancel this Razorpay subscription immediately? This does not issue a refund.'
                    )
                  ) {
                    run(async () => {
                      await call(`/razorpay/subscriptions/${s.id}/cancel`, { confirmed: true });
                      await refresh();
                      setMessage('Cancellation status synchronized.');
                    });
                  }
                }}
              >
                Cancel subscription
              </button>
            )}
          </div>
        </div>
      ))}

      {history && (
        <div className="india-record">
          <h3>Payment history · {history.id}</h3>
          {history.items?.length ? (
            history.items.map((p) => (
              <p key={p.id}>
                {p.paymentId || p.id} · {p.status} · Rs.{p.amount / 100}
                {p.paidAt ? ` · ${new Date(p.paidAt * 1000).toLocaleString('en-IN')}` : ''}
              </p>
            ))
          ) : (
            <p>No invoices yet.</p>
          )}
          {history.nextSkip !== null && (
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const next = await call(
                    `/razorpay/subscriptions/${history.id}/payments?skip=${history.nextSkip}`
                  );
                  setHistory({
                    ...history,
                    ...next,
                    items: [...history.items, ...next.items],
                  });
                })
              }
            >
              Load more
            </button>
          )}
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