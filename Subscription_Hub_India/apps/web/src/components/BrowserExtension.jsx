import React, { useEffect, useState } from 'react';
export default function BrowserExtension({ request }) {
  const [data,setData]=useState(null), [choices,setChoices]=useState({}), [code,setCode]=useState(null), [busy,setBusy]=useState(false), [message,setMessage]=useState('');
  async function load() {
    const value=await request('/extension/settings'); setData(value);
    setChoices(Object.fromEntries(value.mappings.map(m=>[m.key,m.subscriptionId])));
  }
  useEffect(()=>{load().catch(e=>setMessage(e.message));},[]);
  async function act(fn) { setBusy(true);setMessage('');try{await fn();}catch(e){setMessage(e.message);}finally{setBusy(false);} }
  return <article className="panel settings-card extension-settings">
    <div className="panel-heading"><div><h2>Browser extension</h2><p className="muted">Measure foreground time on websites you choose. Phone, TV and desktop apps are not included.</p></div></div>
    <p>Install the supplied extension folder using Chrome → Extensions → Developer mode → Load unpacked. Connect below, then grant access and start tracking in the extension.</p>
    <p role="status">{message}</p>
    {!data ? <button className="secondary" onClick={()=>act(load)} disabled={busy}>Load extension settings</button> : <>
      <h3>1. Choose websites</h3><p>Map each website to one active subscription. Visits do not prove paid-service use. A subscription can be selected once.</p>
      {data.catalog.map(site=><div className="settings-row" key={site.key}><label htmlFor={'track-'+site.key}>{site.name}<small>{site.domains.join(', ')}</small></label><select id={'track-'+site.key} value={choices[site.key]||''} onChange={e=>setChoices({...choices,[site.key]:e.target.value})}><option value="">Do not track</option>{data.subscriptions.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></div>)}
      <button className="secondary" disabled={busy} onClick={()=>act(async()=>{await request('/extension/settings',{method:'PUT',body:JSON.stringify({mappings:Object.entries(choices).filter(([,id])=>id).map(([key,subscriptionId])=>({key,subscriptionId}))})});await load();setMessage('Saved. Click Sync now in the extension to refresh its configuration.');})}>Save websites</button>
      <h3>2. Connect your browser</h3><p>Pairing codes expire after five minutes and work once. Device access expires after 30 days; reconnect to renew.</p>
      <button className="primary" disabled={busy} onClick={()=>act(async()=>setCode(await request('/extension/pairing-code',{method:'POST',body:'{}'})))}>Generate connection code</button>
      {code&&<div className="extension-code"><label>Paste this code into the extension<input readOnly value={code.code} onFocus={e=>e.target.select()}/></label><small>Expires {new Date(code.expiresAt).toLocaleTimeString()}</small></div>}
      <h3>3. Connected devices</h3><button className="secondary" disabled={busy} onClick={()=>act(load)}>Refresh devices</button>
      {!data.devices.length&&<p>No connected browsers yet.</p>}
      {data.devices.map(d=><div className="settings-row" key={d.id}><div><b>{d.name}</b><small>Last upload: {d.lastSync?new Date(d.lastSync).toLocaleString():'Not yet'} · {d.expiresAt<Date.now()?'Expired':'Expires '+new Date(d.expiresAt).toLocaleDateString()}</small></div><button className="secondary" disabled={busy} onClick={()=>act(async()=>{await request('/extension/devices/'+d.id,{method:'DELETE',body:'{}'});await load();})}>Disconnect</button></div>)}
      <h3>Your data</h3><p>Only selected subscription IDs, times and durations are uploaded. No page content, titles, passwords or full browsing history. Manual entries should cover other devices, not duplicate this browser time. Multiple connected computers are summed.</p>
      <button className="secondary" disabled={busy} onClick={()=>{if(window.confirm('Delete all extension-tracked history and disconnect all browsers? Manual logs remain.'))act(async()=>{await request('/extension/history',{method:'DELETE',body:'{}'});await load();setMessage('Extension history deleted. Clear pending data by disconnecting in each extension before reconnecting.');});}}>Delete extension history and disconnect</button>
    </>}
  </article>;
}
