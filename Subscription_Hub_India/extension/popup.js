import {patterns} from './tracker.js';
const $=id=>document.getElementById(id);let busy=false;
async function send(type,extra={}){const result=await chrome.runtime.sendMessage({type,...extra});if(!result?.ok)throw new Error(result?.error||'Extension unavailable. Reload it in chrome://extensions.');return result.data;}
function render(s){
  $('pair').hidden=s.connected;$('connected').hidden=!s.connected;$('notice').textContent=s.error||'';
  $('status').textContent=s.enabled?(s.tracking?'Tracking selected website':'Tracking enabled · waiting for eligible tab'):'Tracking paused';
  $('toggle').textContent=s.enabled?'Pause tracking':'Start tracking';
  $('stats').textContent=`Pending: ${s.pendingMinutes.toFixed(2)} min (${s.pending} records). Last upload: ${s.lastSync?new Date(s.lastSync).toLocaleString():'not yet'}.`;
  $('expiry').textContent=s.expiresAt?'Connection expires '+new Date(s.expiresAt).toLocaleDateString():'';
  $('rejected').textContent=s.rejected.length?s.rejected.map(r=>r.reason).join('\n'):'None. Expired or disabled-service records are discarded with a reason here.';
  $('sites').replaceChildren();
  for(const site of s.sites){const row=document.createElement('div'),label=document.createElement('span'),button=document.createElement('button');row.className='site';label.textContent=site.name;button.textContent=site.granted?'Access granted':'Allow website';button.disabled=site.granted;
    button.onclick=()=>{ // Call directly inside the user gesture.
      chrome.permissions.request({origins:patterns(site)}).then(granted=>run(async()=>{if(!granted)throw new Error('Permission was not granted. This website will not be tracked.');return send('permissionsChanged');})).catch(e=>{$('notice').textContent=e.message;});
    };row.append(label,button);$('sites').append(row);}
  if(!s.sites.length)$('sites').textContent='No websites selected. Save your choices in website Settings, then click Sync now.';
}
async function run(fn){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{render(await fn());}catch(e){$('notice').textContent=e.message;}finally{busy=false;['connect','toggle','sync','disconnect'].forEach(id=>$(id).disabled=false);}}
$('connect').onclick=()=>run(()=>send('connect',{code:$('code').value,name:$('name').value}));
$('toggle').onclick=()=>run(()=>send('toggle'));
$('sync').onclick=()=>run(()=>send('sync'));
$('disconnect').onclick=()=>{if(confirm('Clear this browser connection and all unsent records? You can also revoke the device from website Settings.'))run(()=>send('disconnect'));};
run(()=>send('status'));
