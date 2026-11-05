import { patterns, trackedSubscription, interval } from './tracker.js';
const API='https://subscription-hub-rep.onrender.com/api/extension';
const DEFAULT={ connection:null, enabled:false, mappings:[], queue:[], anchor:null, lastSync:null, lastConfig:0, error:'', rejected:[], nextSync:0, failures:0 };
let chain=Promise.resolve();
const serial = fn => { const next=chain.then(fn); chain=next.catch(()=>{}); return next; };
async function read(){return {...DEFAULT,...(await chrome.storage.local.get('state')).state};}
async function save(state){await chrome.storage.local.set({state});}
async function session(){let {runId}=await chrome.storage.session.get('runId');if(!runId){runId=crypto.randomUUID();await chrome.storage.session.set({runId});}return runId;}
async function setup(){
  await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  chrome.idle.setDetectionInterval(120);
  if(!await chrome.alarms.get('checkpoint'))await chrome.alarms.create('checkpoint',{periodInMinutes:0.5});
  if(!await chrome.alarms.get('sync'))await chrome.alarms.create('sync',{periodInMinutes:1});
}
async function checkpoint(){
  const s=await read(), now=Date.now(), runId=await session();
  if(s.enabled&&s.connection){
    const event=interval(s.anchor,now,runId,crypto.randomUUID());
    if(event&&s.queue.length<20000)s.queue.push(event);
    if(s.queue.length>=20000){s.enabled=false;s.error='Pending queue is full. Sync or disconnect to clear it, then resume.';}
  }
  s.anchor=null;
  if(s.enabled&&s.connection&&s.connection.expiresAt>now){
    try {
      const window=await chrome.windows.getLastFocused();
      const [tab]=await chrome.tabs.query({active:true,windowId:window.id});
      const idle=await chrome.idle.queryState(120);
      const subscriptionId=trackedSubscription(tab,window.focused,idle,s.mappings);
      if(subscriptionId)s.anchor={subscriptionId,at:now,session:runId};
    } catch { /* No accessible browser window: preserve queue and stop timing. */ }
  }
  await save(s);
}
async function api(path, token, body){
  const response=await fetch(API+path,{method:body?'POST':'GET',credentials:'omit',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(12000)});
  let data;try{data=await response.json();}catch{throw new Error('Backend is starting or unavailable. Pending usage is saved; retry shortly.');}
  if(!response.ok){const error=new Error(data.error||'Upload failed.');error.status=response.status;throw error;}
  return data;
}
async function sync(force=false){
  let s=await read(); if(!s.connection||(!force&&Date.now()<s.nextSync))return;
  try{
    if(force||Date.now()-s.lastConfig>5*60000){
      const config=await api('/config',s.connection.token);
      await checkpoint(); s=await read();s.mappings=config.mappings;s.lastConfig=Date.now();await save(s);
    }
    // At most five batches per attempt; later alarms drain larger offline queues.
    for(let i=0;i<5;i++){
      s=await read();if(!s.queue.length)break;
      const result=await api('/usage/batch',s.connection.token,{events:s.queue.slice(0,100)});
      const ids=new Set([...result.accepted,...result.rejected.map(e=>e.eventId)]);
      s.queue=s.queue.filter(e=>!ids.has(e.eventId));
      if(result.rejected.length)s.rejected=[...s.rejected,...result.rejected].slice(-20);
      s.lastSync=Date.now();await save(s);
    }
    s=await read();s.error='';s.failures=0;s.nextSync=Date.now()+5*60000;await save(s);
  }catch(e){
    s=await read();s.error=e.message;s.failures++;s.nextSync=Date.now()+Math.min(30*60000,60000*2**Math.min(s.failures,5));
    if(e.status===401){s.enabled=false;s.anchor=null;}
    await save(s);
  }
}
async function status(){
  const s=await read(), sites=[];
  for(const m of s.mappings)sites.push({...m,granted:await chrome.permissions.contains({origins:patterns(m)})});
  return {connected:!!s.connection,expiresAt:s.connection?.expiresAt,enabled:s.enabled,sites,pending:s.queue.length,pendingMinutes:s.queue.reduce((n,e)=>n+e.activeSeconds,0)/60,lastSync:s.lastSync,error:s.error,rejected:s.rejected,tracking:!!s.anchor};
}
async function message(msg){
  if(msg.type==='status')return status();
  if(msg.type==='connect'){
    const old=await read();if(old.connection)throw new Error('Disconnect the previous account before pairing again.');
    const connection=await api('/pair',null,{code:String(msg.code||'').trim(),name:String(msg.name||'Chrome browser').slice(0,60)});
    await save({...DEFAULT,connection});await sync(true);
  }else if(msg.type==='toggle'){
    await checkpoint();const s=await read();if(!s.connection)throw new Error('Connect your account first.');
    if(s.connection.expiresAt<=Date.now())throw new Error('Access expired. Disconnect and pair again.');
    s.enabled=!s.enabled;s.anchor=null;await save(s);await checkpoint();
  }else if(msg.type==='sync'){
    await checkpoint();await sync(true);await checkpoint();
  }else if(msg.type==='disconnect'){
    // Local disconnect clears pending data to prevent cross-account uploads.
    await save({...DEFAULT});const granted=await chrome.permissions.getAll();
    const origins=granted.origins.filter(o=>!o.includes('subscription-hub-rep.onrender.com'));
    if(origins.length)await chrome.permissions.remove({origins});
  }else if(msg.type==='permissionsChanged'){await checkpoint();}
  return status();
}
chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
  if(sender.id!==chrome.runtime.id)return false;
  serial(()=>message(msg)).then(data=>reply({ok:true,data}),e=>reply({ok:false,error:e.message}));return true;
});
const changed=()=>{serial(checkpoint).catch(()=>{});};
chrome.tabs.onActivated.addListener(changed);
chrome.tabs.onUpdated.addListener((_id,info)=>{if(info.url||info.status==='complete')changed();});
chrome.tabs.onRemoved.addListener(changed);
chrome.windows.onFocusChanged.addListener(changed);
chrome.idle.onStateChanged.addListener(changed);
chrome.permissions.onRemoved.addListener(changed);
chrome.alarms.onAlarm.addListener(alarm=>{serial(async()=>{await checkpoint();if(alarm.name==='sync')await sync();}).catch(()=>{});});
chrome.runtime.onStartup.addListener(()=>{serial(async()=>{const s=await read();s.anchor=null;await save(s);await setup();await checkpoint();}).catch(()=>{});});
chrome.runtime.onInstalled.addListener(()=>{serial(async()=>{const s=await read();s.anchor=null;await save(s);await setup();}).catch(()=>{});});
serial(setup).catch(()=>{});
