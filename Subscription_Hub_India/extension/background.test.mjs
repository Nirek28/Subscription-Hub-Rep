import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
const tracker=(await readFile(new URL('./tracker.js',import.meta.url),'utf8')).replaceAll('export ','');
const worker=(await readFile(new URL('./background.js',import.meta.url),'utf8')).replace(/^import .*\n/,'');
function harness(){
 let now=Date.now(),offline=false,lostAck=false;const disk={},sessionDisk={},saved=new Set();let tab={url:'https://canva.com/design/private?secret=yes'},focused=true;
 const event=()=>({addListener(){}}),area=data=>({async get(k){return {[k]:structuredClone(data[k])};},async set(v){Object.assign(data,structuredClone(v));},async setAccessLevel(){}});
 const chrome={storage:{local:area(disk),session:area(sessionDisk)},idle:{setDetectionInterval(){},async queryState(){return 'active';},onStateChanged:event()},alarms:{async get(){return {};},async create(){},onAlarm:event()},tabs:{async query(){return [tab];},onActivated:event(),onUpdated:event(),onRemoved:event()},windows:{async getLastFocused(){return {id:1,focused};},onFocusChanged:event()},permissions:{async contains(){return true;},async getAll(){return {origins:[]};},async remove(){},onRemoved:event()},runtime:{id:'test',onMessage:event(),onStartup:event(),onInstalled:event()}};
 class Clock extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
 const fetch=async(url,options)=>{
  if(offline)throw new Error('Offline');
  let data;
  if(url.endsWith('/pair'))data={token:'a'.repeat(64),deviceId:'device',expiresAt:now+86400000};
  else if(url.endsWith('/config'))data={mappings:[{key:'canva',name:'Canva',domains:['canva.com'],subscriptionId:'sub-canva'}]};
  else{const body=JSON.parse(options.body);for(const e of body.events){assert.equal('url' in e,false);assert.equal('userId' in e,false);saved.add(e.eventId);}if(lostAck){lostAck=false;throw new Error('Response lost after server saved');}data={accepted:body.events.map(e=>e.eventId),rejected:[]};}
  return {ok:true,async json(){return data;}};
 };
 let context;
 async function restart(){context=vm.createContext({chrome,crypto:webcrypto,URL,Date:Clock,fetch,AbortSignal,console});vm.runInContext(tracker+'\n'+worker,context);await vm.runInContext('chain',context);}
 const call=msg=>vm.runInContext(`serial(()=>message(${JSON.stringify(msg)}))`,context);
 return {restart,call,tick(ms){now+=ms;},checkpoint:()=>vm.runInContext('serial(checkpoint)',context),setOffline(v){offline=v;},loseAck(){lostAck=true;},blur(){focused=false;},disk,saved,sessionDisk};
}
test('worker pause, offline queue, lost acknowledgement retry and account disconnect',async()=>{
 const h=harness();await h.restart();await h.call({type:'connect',code:'test'});assert.equal(h.disk.state.enabled,false);
 await h.call({type:'toggle'});h.tick(30000);await h.checkpoint();assert.equal(h.disk.state.queue.length,1);assert.equal(h.disk.state.queue[0].activeSeconds,30);
 h.setOffline(true);await h.call({type:'sync'});assert.equal(h.disk.state.queue.length,1);assert.ok(h.disk.state.error);
 h.setOffline(false);h.loseAck();await h.call({type:'sync'});assert.equal(h.disk.state.queue.length,1);assert.equal(h.saved.size,1);
 await h.call({type:'sync'});assert.equal(h.disk.state.queue.length,0);assert.equal(h.saved.size,1);
 await h.call({type:'toggle'});h.tick(30000);await h.checkpoint();assert.equal(h.disk.state.queue.length,0);
 await h.call({type:'disconnect'});assert.equal(h.disk.state.connection,null);assert.equal(h.disk.state.queue.length,0);
});
test('worker restart persists queue, browser restart and long sleep discard uncertain time',async()=>{
 const h=harness();await h.restart();await h.call({type:'connect',code:'test'});await h.call({type:'toggle'});h.tick(30000);await h.checkpoint();
 await h.restart();assert.equal(h.disk.state.queue.length,1);h.tick(30000);await h.checkpoint();assert.equal(h.disk.state.queue.length,2);
 h.tick(3600000);await h.checkpoint();assert.equal(h.disk.state.queue.length,2);
 delete h.sessionDisk.runId;h.tick(30000);await h.restart();await h.checkpoint();assert.equal(h.disk.state.queue.length,2);
 h.blur();h.tick(10000);await h.checkpoint();const count=h.disk.state.queue.length;h.tick(30000);await h.checkpoint();assert.equal(h.disk.state.queue.length,count);
});
