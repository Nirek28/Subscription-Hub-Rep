import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import SubscriptionManager from './components/SubscriptionManager.jsx';
import IndiaBilling from './components/IndiaBilling.jsx';
import { BrowserRouter, useLocation, useNavigate } from 'react-router-dom';
import './styles.css';

const API = import.meta.env.VITE_API_URL || "https://subscription-hub-rep.onrender.com";
const emptyAnalytics = { monthlySpend: 0, activeCount: 0, canceledCount: 0, bySubscription: [], insights: [] };
const money = (value) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value || 0));
const daysUntil = (date) => Math.ceil((new Date(date) - Date.now()) / 86400000);
const todayLabel = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date()).toUpperCase();
const iconFor = (name = '') => ({ Netflix: 'N', Spotify: '◖', CloudBox: '☁', 'Studio Fitness': '✳' }[name] || name.slice(0, 1).toUpperCase());
const routeTabs = { '/': 'Overview', '/analytics': 'Analytics', '/subscriptions': 'Subscriptions', '/settings': 'Settings' };
const tabRoutes = { Overview: '/', Analytics: '/analytics', Subscriptions: '/subscriptions', Settings: '/settings' };

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...options });
  if (!response.ok) throw new Error((await response.json()).error || 'Request failed');
  return response.json();
}

function AuthScreen({ onAuthenticated }) {
  const navigate = useNavigate();
  const [mode, setMode] = useState(() => window.location.pathname === '/reset-password' ? 'reset-password' : window.location.pathname === '/verify-email' ? 'verify-email' : 'login');
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') || '');
  useEffect(() => { if (window.location.hash) window.history.replaceState(null, '', window.location.pathname); }, []);
  const titles = { register: 'Create your account', login: 'Sign in to Subscription Hub', 'forgot-password': 'Reset your password', 'reset-password': 'Choose a new password', 'verify-email': 'Verify your email', 'resend-verification': 'Resend verification' };
  const emailOnly = ['forgot-password', 'resend-verification'].includes(mode);
  const passwordMode = ['register', 'login', 'reset-password'].includes(mode);
  const newPassword = ['register', 'reset-password'].includes(mode);
  const switchMode = next => { setMode(next); setPassword(''); setConfirmPassword(''); setError(''); setNotice(''); navigate('/', { replace: true }); };
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault(); setError(''); setNotice('');
    if (newPassword && password !== confirmPassword) { setError('The passwords do not match.'); return; }
    setBusy(true);
    try {
      const payload = { name, email, password, token };
      const result = await request(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify(payload) });
      if (mode === 'login') onAuthenticated(result.user);
      else {
        if (!emailOnly) { setMode('login'); setPassword(''); setConfirmPassword(''); navigate('/', { replace: true }); }
        setNotice(result.message);
      }
    } catch (e) {
      setError(e.message === 'Failed to fetch' ? 'Cannot reach the API. Start the project with npm run dev and try again.' : e.message);
    } finally { setBusy(false); }
  };

  return <main className="auth-shell">
    <section className="auth-visual"><div className="brand auth-brand"><span className="brand-mark">S</span><span>subscription<span className="brand-light">hub</span></span></div><div className="auth-visual-copy"><span className="eyebrow">YOUR SUBSCRIPTIONS, IN CONTROL</span><h1>One clear view<br/>of recurring spend.</h1><p>Track renewals, understand usage, and review your subscriptions from one private workspace.</p><div className="auth-feature"><span>✓</span> Renewal dates in one place</div><div className="auth-feature"><span>✓</span> Usage and cost insights</div><div className="auth-feature"><span>✓</span> Safer cancellation pathways</div></div><div className="auth-visual-foot">Built for India · INR subscriptions and consent-based discovery</div></section>
    <section className="auth-form-side"><div className="auth-card"><div className="auth-mobile-brand"><span className="brand-mark">S</span> subscriptionhub</div><span className="eyebrow">{mode === 'register' ? 'GET STARTED' : 'WELCOME BACK'}</span><h2>{titles[mode]}</h2><p className="auth-subtitle">{emailOnly ? 'Enter your account email to request a secure link.' : mode === 'verify-email' ? 'Click below to confirm your email. Links expire after 24 hours.' : mode === 'reset-password' ? 'Choose a password of 8–128 characters. Reset links expire after 30 minutes.' : 'Manage your subscriptions with your personal account.'}</p>
      {notice && <div className="auth-notice" role="status">{notice}</div>}{error && <div className="auth-error" role="alert">{error}</div>}
      <form onSubmit={submit}>
        {mode === 'register' && <label className="auth-field">Full name<input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" required minLength={2} maxLength={100}/></label>}
        {!['reset-password', 'verify-email'].includes(mode) && <label className="auth-field">Email address<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required/></label>}
        {passwordMode && <label className="auth-field">Password<input type="password" autoComplete={newPassword ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'register' ? 'At least 8 characters' : 'Your password'} required minLength={newPassword ? 8 : undefined} maxLength={128}/></label>}
        {newPassword && <label className="auth-field">Confirm password<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Enter your password again" required minLength={8} maxLength={128}/></label>}
        <button className="primary auth-submit" type="submit" disabled={busy}>{busy ? 'Please wait…' : emailOnly ? 'Send email link' : mode === 'reset-password' ? 'Save new password' : mode === 'verify-email' ? 'Verify email' : mode === 'register' ? 'Create account' : 'Sign in'} <span>→</span></button>
      </form>
      <div className="auth-switch"><button type="button" disabled={busy} onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'Create an account' : 'Back to sign in'}</button></div>
      <div className="auth-switch"><button type="button" disabled={busy} onClick={() => switchMode('forgot-password')}>Forgot password?</button> · <button type="button" disabled={busy} onClick={() => switchMode('resend-verification')}>Resend verification</button></div>
      <div className="auth-security">🔒 Passwords are hashed by the API; they are not saved in browser storage. Demo accounts use in-memory storage unless MongoDB is configured.</div>
    </div></section>
  </main>;
}

function SubscriptionForm({ onClose, onSave }) {
  const [form, setForm] = useState({ name: '', merchant: '', category: 'Other', monthlyCost: '', renewalDate: '', cancelUrl: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const change = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await onSave({ ...form, monthlyCost: Number(form.monthlyCost), currency: 'INR' }); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className="modal entry-modal"><button className="modal-close" onClick={onClose}>×</button><div className="modal-symbol">＋</div><div className="eyebrow">YOUR SUBSCRIPTION</div><h2>Add a subscription</h2><p>Enter the details from your own plan. Amounts are recorded in INR.</p>
    {error && <div className="auth-error" role="alert">{error}</div>}
    <form className="entry-form" onSubmit={submit}>
      <label>Subscription name<input value={form.name} onChange={change('name')} placeholder="e.g. Premium plan" maxLength={100} required/></label>
      <label>Merchant / provider<input value={form.merchant} onChange={change('merchant')} placeholder="e.g. Service provider" maxLength={100} required/></label>
      <label>Category<select value={form.category} onChange={change('category')}><option>Other</option><option>Entertainment</option><option>Music</option><option>Productivity</option><option>Lifestyle</option><option>Utilities</option></select></label>
      <label>Monthly cost (₹)<input type="number" min="0" step="0.01" value={form.monthlyCost} onChange={change('monthlyCost')} placeholder="0.00" required/></label>
      <label>Next renewal date<input type="date" value={form.renewalDate} onChange={change('renewalDate')} required/></label>
      <label>Cancellation link (optional)<input type="url" value={form.cancelUrl} onChange={change('cancelUrl')} placeholder="https://provider.com/account"/></label>
      <div className="entry-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save subscription'}</button></div>
    </form>
  </div></div>;
}

function UsageForm({ subscriptions, onClose, onSave }) {
  const firstActive = subscriptions.find((sub) => sub.status === 'active') || subscriptions[0];
  const [subscriptionId, setSubscriptionId] = useState(firstActive?.id || '');
  const [hours, setHours] = useState('');
  const [cost, setCost] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await onSave({ subscriptionId, source: 'manual', hours: Number(hours), cost: Number(cost) }); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className="modal entry-modal"><button className="modal-close" onClick={onClose}>×</button><div className="modal-symbol">↗</div><div className="eyebrow">MANUAL TRACKING</div><h2>Log subscription usage</h2><p>Record hours used and the amount incurred for that usage period.</p>
    {error && <div className="auth-error" role="alert">{error}</div>}
    {!subscriptions.length ? <div className="empty">Add a subscription before logging usage.</div> : <form className="entry-form" onSubmit={submit}>
      <label>Subscription<select value={subscriptionId} onChange={(e) => setSubscriptionId(e.target.value)} required>{subscriptions.map((sub) => <option key={sub.id} value={sub.id}>{sub.name}</option>)}</select></label>
      <label>Hours used<input type="number" min="0" step="0.1" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="e.g. 5" required/></label>
      <label>Cost incurred (₹)<input type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="e.g. 199" required/></label>
      <div className="entry-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save usage'}</button></div>
    </form>}
  </div></div>;
}

function SubscriptionsPage({ subs, onCancel, onProtect, onAdd, onDiscover, onImported }) {
  const [query, setQuery] = useState('');
  const filtered = subs.filter((sub) => `${sub.name} ${sub.merchant} ${sub.category} ${sub.status}`.toLowerCase().includes(query.toLowerCase()));
  const active = subs.filter((sub) => sub.status === 'active').length;
  const canceled = subs.filter(s=>s.status==='canceled').length;
  const monthly = subs.filter((sub) => sub.status === 'active').reduce((sum, sub) => sum + Number(sub.monthlyCost || 0), 0);
  return <>
    <div className="page-summary-grid">
      <article className="panel summary-tile"><span>All subscriptions</span><b>{subs.length}</b><small>Tracked services</small></article>
      <article className="panel summary-tile"><span>Active</span><b>{active}</b><small>Currently monitored</small></article>
      <article className="panel summary-tile"><span>Canceled</span><b>{canceled}</b><small>In this workspace</small></article>
      <article className="panel summary-tile"><span>Monthly total</span><b>{money(monthly)}</b><small>Active subscriptions</small></article>
    </div>

    <div style={{ marginBottom: '20px' }}>
      <SubscriptionManager onImported={onImported} /><IndiaBilling onChanged={onImported} />
    </div>

    <article className="panel full-list-panel">
      <div className="panel-heading">
        <div><h2>All subscriptions</h2><p className="muted">Review billing dates, costs, and available actions.</p></div>
        <div className="list-actions">
          <button className="primary" onClick={onAdd}>＋ Add subscription</button>
        </div>
      </div>
      <div className="list-toolbar"><label className="search-box"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search subscriptions" aria-label="Search subscriptions" /></label><span className="result-count">{filtered.length} result{filtered.length === 1 ? '' : 's'}</span></div>
      <div className="table-head"><span>SUBSCRIPTION</span><span>MONTHLY COST</span><span>NEXT BILLING</span><span>STATUS</span><span>ACTIONS</span></div>
      {filtered.map((sub) => <div className="sub-row" key={sub.id}>
        <div className="service"><div className={`service-icon ${sub.merchant.toLowerCase().replaceAll(' ','-')}`}>{iconFor(sub.merchant)}</div><div><b>{sub.name}</b><small>{sub.category} · {sub.merchant} · {sub.provider || 'manual'}</small></div></div>
        <div className="cost">{money(sub.monthlyCost)}<small>/month</small></div>
        <div className="billing"><b>{new Date(sub.renewalDate).toLocaleDateString('en-IN',{month:'short',day:'numeric',year:'numeric'})}</b><small>{sub.status === 'active' ? `in ${Math.max(0, daysUntil(sub.renewalDate))} days` : 'No upcoming charge'}</small></div>
        <div><span className={`status ${sub.status}`}>{`● ${sub.status}`}</span></div>
        <div className="row-actions">{sub.status === 'active' && <><button className="cancel-link" onClick={() => onCancel(sub)}>Cancel</button><button className="more-button" onClick={() => onProtect(sub)} title="Subscription details">•••</button></>}</div>
      </div>)}
      {!filtered.length && <div className="empty">{subs.length ? 'No subscriptions match that search.' : 'No subscriptions yet. Add your first subscription to get started.'}</div>}
    </article>
  </>;
}
function AiInsightsPanel({ subscriptions, onChanged }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = async (refresh = false) => {
    setBusy(true); setError('');
    try { setData(await request(`/analytics/ai-insights${refresh ? '?refresh=1' : ''}`)); }
    catch (e) { setError(e.message || 'Could not load insights.'); }
    finally { setBusy(false); }
  };
  useEffect(() => { load(false); }, [subscriptions.length]);
  const setMultiplier = async (id, value) => {
    try {
      await request(`/subscriptions/${id}/ux-multiplier`, { method: 'POST', body: JSON.stringify({ multiplier: Number(value) }) });
      if (onChanged) await onChanged();
      await load(false);
    } catch (e) { setError(e.message || 'Could not save the estimate.'); }
  };
  const rows = data?.rows || [];
  const insights = data?.insights || [];
  const cell = { display: 'grid', gridTemplateColumns: 'minmax(110px,1.4fr) .7fr 1.1fr 1fr', gap: 8, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #292a30', fontSize: 11 };
  return <article className="panel" style={{ marginTop: 14 }}>
    <div className="panel-heading">
      <div><h2>AI insights</h2><p className="muted">Redundant services and plans that cost too much for how you use them{data ? ` · ${data.source === 'gemini' ? 'written by Gemini' : 'rule-based'}` : ''}</p></div>
      <button className="secondary" onClick={() => load(true)} disabled={busy}>{busy ? 'Analysing...' : '↻ Refresh'}</button>
    </div>
    {error && <div className="empty">{error}</div>}
    {data?.warning && <div className="insight-disclaimer">{data.warning}</div>}
    {insights.map((item, i) => <div className="review-item" key={i}><div><b>{item.title}</b><p>{item.detail}</p></div><strong>{item.estimatedMonthlySaving ? `Save up to ${money(item.estimatedMonthlySaving)}` : item.type}</strong></div>)}
    {data && !insights.length && !error && <div className="empty">{rows.length ? 'No redundant or inefficient subscriptions found in your current data.' : 'Add subscriptions and log usage to see insights.'}</div>}
    {rows.length > 0 && <div style={{ marginTop: 16 }}>
      <p className="muted" style={{ marginBottom: 6 }}>Effective cost per hour = monthly cost ÷ (tracked hours × your mobile/TV estimate). The browser tracker only sees desktop time, so raise the estimate if you also watch on a phone or TV.</p>
      {rows.map((row) => <div key={row.subscriptionId} style={cell}>
        <b>{row.name}</b>
        <span>{Number(row.trackedHours).toFixed(1)} h</span>
        <select value={row.uxMultiplier} onChange={(e) => setMultiplier(row.subscriptionId, e.target.value)} style={{ height: 30, background: '#202126', color: '#eee', border: '1px solid #34363d', borderRadius: 5 }}>
          {[1, 1.25, 1.5, 2, 3].map((v) => <option key={v} value={v}>{v === 1 ? '×1 (desktop only)' : `×${v}`}</option>)}
        </select>
        <span>{row.effectiveCostPerHour == null ? 'No usage yet' : `${money(row.effectiveCostPerHour)} / hr`}</span>
      </div>)}
    </div>}
  </article>;
}

function AnalyticsPage({ analytics, subscriptions, onLogUsage, onChanged }) {
  const rows = analytics.bySubscription || [];
  const trackedHours = rows.reduce((sum, row) => sum + Number(row.hoursThisMonth || 0), 0);
  const costPerHour = trackedHours ? Number(analytics.monthlySpend || 0) / trackedHours : 0;
  const maxCost = Math.max(1, ...rows.map((row) => Number(row.monthlyCost || 0)));
  const insights = rows.filter((row) => Number(row.hoursThisMonth || 0) < 5).sort((a, b) => Number(b.monthlyCost || 0) - Number(a.monthlyCost || 0));
  return <>
    <div className="page-summary-grid analytics-summary">
      <article className="panel summary-tile"><span>Monthly recurring spend</span><b>{money(analytics.monthlySpend)}</b><small>Active services only</small></article>
      <article className="panel summary-tile"><span>Tracked usage</span><b>{trackedHours.toFixed(1)} hrs</b><small>Across listed services</small></article>
      <article className="panel summary-tile"><span>Average cost / tracked hour</span><b>{costPerHour ? money(costPerHour) : '—'}</b><small>Spend divided by tracked hours</small></article>
      <article className="panel summary-tile"><span>Subscriptions</span><b>{analytics.activeCount || 0}</b><small>Active right now</small></article>
    </div>
    <div className="dashboard-grid analytics-dashboard">
      <article className="panel analytics-chart-panel"><div className="panel-heading"><div><h2>Cost and usage by subscription</h2><p className="muted">Compare your monthly costs with the usage you enter.</p></div><button className="secondary" onClick={onLogUsage} disabled={!subscriptions.length}>＋ Log usage</button></div>
        <div className="chart-legend"><span><i className="legend-cost"/>Monthly cost</span><span><i className="legend-usage"/>Usage (hrs)</span></div>
        <div className="analytics-bars">{rows.map((row) => <div className="analytics-bar-row" key={row.subscriptionId}><div className="analytics-bar-label"><b>{row.name}</b><small>{Number(row.hoursThisMonth || 0).toFixed(1)} tracked hrs · {row.costPerHour == null ? 'No usage data' : `${money(row.costPerHour)} / hr`}</small></div><div className="analytics-bar-track"><i className="analytics-cost-fill" style={{width:`${Math.max(3, Number(row.monthlyCost || 0) / maxCost * 100)}%`}}/></div><b className="analytics-value">{money(row.monthlyCost)}</b></div>)}{!rows.length && <div className="empty">Usage and cost details will appear when data is available.</div>}</div>
      </article>
      <article className="panel insights-panel"><div className="panel-heading"><div><h2>Usage review</h2><p className="muted">Services with under five tracked hours.</p></div><span className="insight-spark">✦</span></div>
        {insights.length ? insights.map((row) => <div className="review-item" key={row.subscriptionId}><div><b>{row.name}</b><p>{Number(row.hoursThisMonth || 0).toFixed(1)} hours tracked against {money(row.monthlyCost)} per month.</p></div><strong>{row.hoursThisMonth === 0 ? 'No use' : 'Low use'}</strong></div>) : <div className="empty">{rows.length ? 'No low-usage services found in the current data.' : 'Add a subscription and usage entry to see low-usage insights.'}</div>}
        <div className="insight-disclaimer">Insights use only the usage details you enter; they are not financial advice.</div>
      </article>
    </div>
    <div className="analytics-extra"><AiInsightsPanel subscriptions={subscriptions} onChanged={onChanged} /></div>
  </>;
}

function SettingsPage() {
  const [status, setStatus] = useState(null);
  useEffect(() => { request('/india/status').then(setStatus).catch(() => {}); }, []);
  const integrations = [
    ['Setu AA', 'Consented bank-data discovery', status?.setu.configured ? status.setu.mode + ' configured' : 'Not configured'],
    ['Razorpay', 'UPI AutoPay / recurring billing', status?.razorpay.configured ? status.razorpay.mode + ' configured' : 'Not configured'],
    ['CSV import', 'Indian debit transaction detection', 'Available'],
    ['Gemini', 'Optional usage insights', status?.gemini ? 'Configured' : 'Local rules'],
    ['SendGrid', 'Renewal email', status?.email ? 'Configured' : 'Preview only']
  ];
  return <div className="settings-page">
    <article className="panel settings-card"><div className="panel-heading"><div><h2>Workspace preferences</h2><p className="muted">Current local prototype configuration.</p></div></div>
      <div className="settings-row"><div><b>Display currency</b><small>Amounts are formatted in Indian Rupees.</small></div><span className="settings-badge">INR · ₹</span></div>
      <div className="settings-row"><div><b>Data mode</b><small>Without MongoDB, account data is temporary and resets when the API restarts.</small></div><span className="settings-badge">Demo / local</span></div>
      <div className="settings-row"><div><b>Privacy</b><small>Bank authentication and payment authorization happen on provider screens.</small></div><span className="settings-badge safe">Provider-hosted</span></div>
    </article>
    <article className="panel settings-card"><div className="panel-heading"><div><h2>Integrations</h2><p className="muted">Provider connections.</p></div></div>
      {integrations.map(([name, purpose, status]) => <div className="settings-row integration-row" key={name}><div><b>{name}</b><small>{purpose}</small></div><span className="integration-status"><i/>{status}</span></div>)}
    </article>
    <div className="settings-warning"><b>Before using real customer data:</b> add email verification and account recovery, review CSRF/session protections, collect consent, add secure provider-token storage, retention/deletion controls, and complete a privacy/security review.</div>
  </div>;
}

function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [subs, setSubs] = useState([]);
  const [analytics, setAnalytics] = useState(emptyAnalytics);
  const [activeTab, setActiveTab] = useState(routeTabs[location.pathname] || 'Overview');
  const [modal, setModal] = useState(false);
  const [usageModal, setUsageModal] = useState(false);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState(false);
  const [selected, setSelected] = useState(null);
  const [discoverModal, setDiscoverModal] = useState(false);
  const [protectionTarget, setProtectionTarget] = useState(null);
  const [notificationModal, setNotificationModal] = useState(false);
  const [notificationItems, setNotificationItems] = useState([]);
  const [notificationError, setNotificationError] = useState('');
  const [notificationBusy, setNotificationBusy] = useState(false);
  const handledCancelRoute = useRef('');
  const [user, setUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);

  const refresh = async () => {
    try {
      const [s, a] = await Promise.all([request('/subscriptions'), request('/analytics')]);
      setSubs(s); setAnalytics(a); setLive(true);
    } catch { setLive(false); }
  };
  useEffect(() => {
    let active = true;
    request('/api/auth/me').then((result) => { if (active) setUser(result.user); }).catch(() => {}).finally(() => { if (active) setAuthChecking(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    setActiveTab(routeTabs[location.pathname] || 'Overview');
  }, [location.pathname]);
  useEffect(() => { if (user) refresh(); }, [user]);
  const activeSubs = useMemo(() => subs.filter((s) => s.status === 'active'), [subs]);
  const pageCopy = { Overview: [`Good morning, ${user?.name?.split(' ')[0] || 'there'}`, 'Your recurring spend, all in one place.'], Analytics: ['Analytics', 'Understand what your subscriptions cost and how much you use them.'], Subscriptions: ['Subscriptions', 'Review every recurring service, renewal date, and available action.'], Settings: ['Settings', 'Review local preferences and prototype integration status.'] };

  const addSubscription = async (record) => {
    await request('/subscriptions', { method: 'POST', body: JSON.stringify(record) });
    setNotice('Subscription saved to your account.'); setModal(false); await refresh();
  };
  const addUsage = async (record) => {
    await request('/usage', { method: 'POST', body: JSON.stringify(record) });
    setNotice('Usage entry saved.'); setUsageModal(false); await refresh();
  };
  const cancel = async (sub) => {
    if(sub.provider==='razorpay' && !window.confirm('Cancel this Razorpay subscription immediately? No refund is issued.')) return;
    try {
      const result = await request(`/subscriptions/${sub.id}/cancel`, { method: 'POST', body: JSON.stringify({confirmed:sub.provider==='razorpay'}) });
      if (result.status === 'redirect_required') { setSelected({ sub, cancelUrl: result.cancelUrl, opened: false }); return; }
      setNotice(result.notice || 'Subscription status updated.'); await refresh();
    } catch (e) { setNotice(e.message || 'Unable to load the cancellation action.'); }
  };
  const openCancel = (sub) => navigate(`/cancel/${encodeURIComponent(sub.id)}`);
  const confirmRedirect = () => {
    if (selected?.cancelUrl) window.open(selected.cancelUrl, '_blank', 'noopener,noreferrer');
    setSelected((current) => current ? { ...current, opened: true } : null);
    setNotice('Provider page opened. Complete and confirm the cancellation with the provider.');
  };
  const confirmCanceled = async () => {
    if (!selected?.sub?.id) return;
    try {
      const result = await request(`/subscriptions/${selected.sub.id}/confirm-canceled`, { method: 'POST', body: JSON.stringify({ confirmed: true }) });
      setNotice(result.notice); setSelected(null); await refresh();
    } catch (e) { setNotice(e.message); }
  };
  const openNotifications = async () => {
    setNotificationModal(true); setNotificationBusy(true); setNotificationError('');
    try { const result = await request('/notifications/preview'); setNotificationItems(result.items || []); }
    catch (e) { setNotificationError(e.message); }
    finally { setNotificationBusy(false); }
  };
  useEffect(() => {
    const match = location.pathname.match(/^\/cancel\/([^/]+)\/?$/);
    if (!match) { handledCancelRoute.current = ''; return; }
    if (!user || !live || handledCancelRoute.current === match[1]) return;
    handledCancelRoute.current = match[1];
    const sub = subs.find((item) => item.id === decodeURIComponent(match[1]));
    if (sub) void cancel(sub);
    else setNotice('That subscription is not available in this account.');
    navigate('/subscriptions', { replace: true });
  }, [location.pathname, user, live, subs, navigate]);
  const logout = async () => {
    try { await request('/api/auth/logout', { method: 'POST', body: '{}' }); } catch {}
    setUser(null); setSubs([]); setAnalytics(emptyAnalytics); navigate('/'); setLive(false);
  };
  const initials = user?.name?.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'U';
  if (authChecking) return <div className="auth-loading"><span className="brand-mark">S</span><p>Checking your session…</p></div>;
  if (!user || ['/reset-password', '/verify-email'].includes(location.pathname)) return <AuthScreen onAuthenticated={setUser} />;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">S</span><span>subscription<span className="brand-light">hub</span></span></div>
      <div className="workspace-label">WORKSPACE</div>
      <nav>{[['◫','Overview'],['▥','Analytics'],['↻','Subscriptions'],['◉','Settings']].map(([icon, label]) => <button key={label} className={`nav-item ${activeTab === label ? 'active' : ''}`} onClick={() => navigate(tabRoutes[label])}><span>{icon}</span>{label}{label === 'Subscriptions' && <i>{activeSubs.length}</i>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="secure-dot"/>Your private subscription workspace<div className="profile"><div className="avatar">{initials}</div><div className="profile-name"><b>{user.name}</b><small>{user.emailVerified ? 'Email verified' : 'Email not verified'}</small></div><button className="logout-button" onClick={logout}>Sign out</button></div></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="crumb">Workspace <span>/</span> <b>{activeTab}</b></div><div className="top-actions"><span className={`api-status ${live ? 'connected' : ''}`}><i/> {live ? 'API connected' : 'Demo mode'}</span><button className="icon-button" aria-label="Renewal reminders" title="Renewal reminders (preview only)" onClick={openNotifications}>♧</button><div className="avatar small">{initials}</div></div></header>
      <div className="content">
        {notice && <div className="toast"><span>✓</span>{notice}<button onClick={() => setNotice('')}>×</button></div>}
        
        <section className="welcome-row">
          <div><div className="eyebrow">{todayLabel}</div><h1>{pageCopy[activeTab][0]}</h1><p className="muted">{pageCopy[activeTab][1]}</p></div>
          <div className="welcome-actions">
            <button className="secondary" onClick={() => navigate('/subscriptions')}>Discover subscriptions</button>
            <button className="primary" onClick={() => setModal(true)}><span>＋</span> Add subscription</button>
          </div>
        </section>

        {activeTab === 'Overview' ? <>
        {!subs.length && <section className="empty-start panel"><div className="modal-symbol">＋</div><div><h2>Start with your own subscriptions</h2><p>Add a service, monthly cost, and renewal date. Your dashboard and analytics will use only the details you enter.</p><button className="primary" onClick={() => setModal(true)}>Add your first subscription <span>→</span></button></div></section>}
        <section className="metric-grid">
          <article className="metric-card"><div className="metric-label">Monthly recurring spend <span className="metric-icon">↗</span></div><div className="metric-value">{money(analytics.monthlySpend)}</div><div className="metric-foot"><span className="neutral">Based on your saved subscriptions</span></div></article>
          <article className="metric-card"><div className="metric-label">Active subscriptions <span className="metric-icon">▤</span></div><div className="metric-value">{analytics.activeCount}<small> services</small></div><div className="metric-foot"><span className="neutral">{analytics.canceledCount} canceled</span><span> · tracked</span></div><div className="stacked-avatars">{activeSubs.slice(0, 3).map((sub) => <span className="logo dynamic" key={sub.id}>{iconFor(sub.merchant)}</span>)}{activeSubs.length > 3 && <span className="logo more">+{activeSubs.length - 3}</span>}</div></article>
          <article className="metric-card renewal-card"><div className="metric-label">Next renewal <span className="metric-icon">◷</span></div><div className="metric-value">{activeSubs.length ? daysUntil([...activeSubs].sort((a,b) => new Date(a.renewalDate)-new Date(b.renewalDate))[0].renewalDate) : '—'}<small> days</small></div><div className="metric-foot"><span>{activeSubs.length ? [...activeSubs].sort((a,b) => new Date(a.renewalDate)-new Date(b.renewalDate))[0].name : 'No upcoming renewals'}</span></div>{activeSubs.length > 0 && <div className="renewal-line"><span/><span/><span/><span/><span/><span/><span/><span/><span/><b>Today</b></div>}</article>
        </section>
        <section className="dashboard-grid">
          <article className="panel subscriptions-panel"><div className="panel-heading"><div><h2>Your subscriptions</h2><p className="muted">Manage and monitor your recurring services</p></div><button className="text-button" onClick={() => navigate('/subscriptions')}>View all <span>→</span></button></div>
            <div className="table-head"><span>SUBSCRIPTION</span><span>MONTHLY COST</span><span>NEXT BILLING</span><span>STATUS</span><span/></div>
            {subs.slice(0,4).map((sub) => <div className="sub-row" key={sub.id}><div className="service"><div className={`service-icon ${sub.merchant.toLowerCase().replaceAll(' ','-')}`}>{iconFor(sub.merchant)}</div><div><b>{sub.name}</b><small>{sub.category}</small></div></div><div className="cost">{money(sub.monthlyCost)}<small>/month</small></div><div className="billing"><b>{new Date(sub.renewalDate).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</b><small>in {Math.max(0,daysUntil(sub.renewalDate))} days</small></div><div><span className={`status ${sub.status}`}>{`● ${sub.status}`}</span></div><div className="row-actions">{sub.status === 'active' && <button className="cancel-link" onClick={() => openCancel(sub)}>Cancel</button>}<button className="more-button" onClick={() => setProtectionTarget(sub)} title="Subscription details">•••</button></div></div>)}
            {!subs.length && <div className="empty">No subscriptions yet. Add your first subscription to get started.</div>}
            <div className="panel-footer"><span>Showing {Math.min(subs.length,4)} of {subs.length} subscriptions</span><button onClick={() => navigate('/subscriptions')}>Open list →</button></div>
          </article>
          <article className="panel spend-panel"><div className="panel-heading"><div><h2>Usage vs. cost</h2><p className="muted">Effective cost per tracked hour</p></div><button className="period-button">This month⌄</button></div><div className="chart-legend"><span><i className="legend-cost"/>Monthly cost</span><span><i className="legend-usage"/>Usage (hrs)</span></div>
            <div className="chart-area">{analytics.bySubscription?.length ? <><div className="y-labels"><span>{money(40)}</span><span>{money(30)}</span><span>{money(20)}</span><span>{money(10)}</span><span>{money(0)}</span></div><div className="chart-bars">{analytics.bySubscription.slice(0,4).map((row) => <div className="bar-group" key={row.name}><div className="bars"><span className="bar cost-bar" style={{height:`${Math.min((row.monthlyCost || 0) / 40 * 100,100)}%`}}/><span className="bar usage-bar" style={{height:`${Math.min((row.hoursThisMonth || 0) / 45 * 100,100)}%`}}/></div><small>{row.name.split(' ')[0]}</small></div>)}</div></> : <div className="chart-empty">Add subscriptions to see your cost and usage chart.</div>}</div>
            <div className="insight-box"><span className="insight-spark">✦</span><div><b>{subs.length ? 'Your insights' : 'Insights will appear here'}</b><p>{subs.length ? 'Add usage entries to compare each subscription’s cost with how much you use it.' : 'Add your own subscription details to start building insights.'}</p></div><button onClick={() => navigate('/analytics')}>→</button></div>
          </article>
        </section>
        <section className="bottom-grid"><article className="panel upcoming-panel"><div className="panel-heading"><div><h2>Upcoming renewals</h2><p className="muted">The next charges on your calendar</p></div><button className="text-button" onClick={() => navigate('/subscriptions')}>Calendar <span>→</span></button></div>{[...activeSubs].sort((a,b) => new Date(a.renewalDate)-new Date(b.renewalDate)).slice(0,3).map((sub) => <div className="renewal-row" key={sub.id}><div className="date-tile"><b>{new Date(sub.renewalDate).getDate()}</b><small>{new Date(sub.renewalDate).toLocaleDateString('en-US',{month:'short'}).toUpperCase()}</small></div><div className={`service-icon compact ${sub.merchant.toLowerCase().replaceAll(' ','-')}`}>{iconFor(sub.merchant)}</div><div className="renewal-name"><b>{sub.name}</b><small>{daysUntil(sub.renewalDate) <= 3 ? 'Coming up soon' : 'Auto-renewal'}</small></div><b className="renewal-cost">{money(sub.monthlyCost)}</b></div>)}{!activeSubs.length && <div className="empty">Nothing scheduled.</div>}</article>
          <article className="panel protection-panel"><div className="protection-art"><span>◈</span><i>✓</i></div><div><span className="eyebrow">SMART PROTECTION</span><h2>Take control of renewals</h2><p>Review UPI AutoPay subscriptions, renewal reminders and merchant cancellation links.</p><button className="secondary" onClick={() => navigate('/subscriptions')}>Review subscriptions <span>→</span></button></div></article></section>
        </> : activeTab === 'Subscriptions' ? <SubscriptionsPage subs={subs} onCancel={openCancel} onProtect={(sub) => setProtectionTarget(sub)} onAdd={() => setModal(true)} onDiscover={() => setDiscoverModal(true)} onImported={refresh} /> : activeTab === 'Analytics' ? <AnalyticsPage analytics={analytics} subscriptions={activeSubs} onLogUsage={() => setUsageModal(true)} onChanged={refresh} /> : activeTab === 'Settings' ? <SettingsPage /> : <div className="empty">Unknown tab</div>}
        <footer className="footer-note">India edition · Bank-data consent and payment mandates are separate. Provider credentials determine available integrations.</footer>
      </div>
    </main>
    {modal && <SubscriptionForm onClose={() => setModal(false)} onSave={addSubscription} />}
    {usageModal && <UsageForm subscriptions={activeSubs} onClose={() => setUsageModal(false)} onSave={addUsage} />}

    {protectionTarget && <div className="overlay"><div className="modal confirm-modal"><button className="modal-close" onClick={() => setProtectionTarget(null)}>×</button><h2>{protectionTarget.name}</h2><p>Source: {protectionTarget.provider || 'manual'} · Status: {protectionTarget.providerStatus || protectionTarget.status}</p><p>{protectionTarget.provider==='razorpay'?'Manage authorization, payment history and cancellation in the merchant subscriptions panel.':'This is an externally tracked subscription. Use its merchant page or your UPI app to manage the service and payment mandate.'}</p><button className="primary" onClick={() => { setProtectionTarget(null); navigate('/subscriptions'); }}>View subscriptions</button></div></div>}
    {selected && <div className="overlay"><div className="modal confirm-modal"><button className="modal-close" onClick={() => setSelected(null)}>×</button><div className="modal-symbol warning">↗</div><h2>{selected.opened ? 'Did the provider confirm cancellation?' : `Continue to ${selected.sub.merchant}?`}</h2><p>{selected.opened ? 'Only mark this service canceled after the provider confirms it. Opening a cancellation page alone does not cancel the subscription.' : 'Cancellation is completed on the provider’s website. You may need to sign in and confirm there.'}</p><div className="modal-actions"><button className="secondary" onClick={() => setSelected(null)}>{selected.opened ? 'Not yet' : 'Stay here'}</button>{selected.opened ? <button className="primary" onClick={confirmCanceled}>Provider confirmed · mark canceled</button> : <button className="primary" onClick={confirmRedirect}>Open cancellation page ↗</button>}</div></div></div>}
    {notificationModal && <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setNotificationModal(false)}><div className="modal confirm-modal"><button className="modal-close" onClick={() => setNotificationModal(false)}>×</button><div className="modal-symbol">◷</div><div className="eyebrow">THREE-DAY RENEWAL WINDOW</div><h2>Renewal reminders</h2><p>Preview only. No email or external notification is sent.</p>{notificationBusy ? <div className="empty">Loading reminders…</div> : notificationError ? <div className="auth-error" role="alert">{notificationError}</div> : notificationItems.length ? notificationItems.map((item) => <div className="review-item" key={item.id}><div><b>{item.name}</b><p>{new Date(item.renewalDate).toLocaleDateString('en-IN')} · {money(item.monthlyCost)}</p></div><strong>Review</strong></div>) : <div className="empty">No active renewals due in the next three days.</div>}<div className="modal-foot">AI and email dispatch are not connected in this prototype.</div></div></div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><BrowserRouter><App/></BrowserRouter></React.StrictMode>);