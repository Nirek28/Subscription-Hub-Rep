import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { detectSubscriptions, demoTransactions, extractSetuTransactions, fingerprint, parseCSV } from '../services/discovery.js';
import { get, put, list, remove, locked } from '../services/integrationStore.js';
import { addSubscription, getSubscription, listSubscriptions } from '../services/repository.js';
import { fail, setu, setuDiagnose, setuConfigured, setuMode, razorpayConfigured, razorpayMode } from '../services/providers.js';
const router=Router();
const route=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){next(e);}};
async function preview(transactions,userId,source){
 if(!Array.isArray(transactions)||transactions.length>5000)throw fail('Maximum 5000 transactions.');
 const result=detectSubscriptions(transactions),batchId=randomUUID();
 await put('discovery',batchId,userId,{...result,source},new Date(Date.now()+30*60000));
 return {...result,batchId,source};
}

// Sandbox-only helper: after a successful Setu sandbox sync, add up to 3 subscriptions so the
// dashboard can be verified end to end. Detected candidates are used first; any shortfall is
// topped up with clearly labelled sandbox samples (provider "setu-sandbox"). Never runs in live mode.
const SANDBOX_SAMPLES=[['Netflix','Entertainment',649,'https://www.netflix.com/account'],['Spotify','Music',119,'https://www.spotify.com/account/'],['Google One','Storage',130,'https://one.google.com/']];
async function seedSandbox(userId,detected){
 const next=new Date();next.setUTCMonth(next.getUTCMonth()+1);
 const pool=[...detected.slice(0,3).map(c=>({...c,sample:false}))];
 for(const [merchant,category,monthlyCost,cancelUrl] of SANDBOX_SAMPLES){
  if(pool.length>=3)break;
  if(pool.some(c=>c.merchant.toLowerCase()===merchant.toLowerCase()))continue;
  pool.push({key:`sandbox-${merchant.toLowerCase()}`,name:merchant,merchant,category,cancelUrl,monthlyCost,billingCycle:'monthly',renewalDate:next.toISOString(),sample:true});
 }
 const added=[];let skipped=0;
 for(const c of pool){
  const id=`discovered-${fingerprint(userId+':'+c.key)}`;
  const existing=await listSubscriptions(userId);
  if(await getSubscription(id,userId)||existing.some(s=>s.status==='active'&&s.merchant.toLowerCase()===c.merchant.toLowerCase())){skipped++;continue;}
  try{await addSubscription({id,name:c.name,merchant:c.merchant,category:c.category,cancelUrl:c.cancelUrl,monthlyCost:c.monthlyCost,currency:'INR',renewalDate:c.renewalDate,billingCycle:c.billingCycle,provider:c.sample?'setu-sandbox':'setu-sandbox-detected',discoveryKey:c.key},userId);added.push({name:c.name,sample:c.sample});}
  catch(e){if(e.code===11000)skipped++;else throw e;}
 }
 return {added,skipped};
}
router.get('/status',route(async(req,res)=>res.json({setu:{configured:setuConfigured(),mode:setuMode()},razorpay:{configured:razorpayConfigured(),mode:razorpayMode(),key:process.env.RAZORPAY_KEY_ID||''},gemini:!!process.env.GEMINI_API_KEY,email:!!(process.env.SENDGRID_API_KEY&&process.env.ALERT_FROM_EMAIL)})));
router.get('/aa/diagnose',route(async(req,res)=>res.json(await setuDiagnose())));
router.post('/discovery/preview',route(async(req,res)=>{
 const source=req.body.demo===true?'local-demo':'csv';
 const txs=source==='local-demo'?demoTransactions():parseCSV(req.body.csv);
 res.json(await preview(txs,req.user.id,source));
}));
router.post('/discovery/confirm',route(async(req,res)=>{
 const result=await locked(`import:${req.user.id}`,async()=>{
 const batch=await get('discovery',String(req.body.batchId),req.user.id);
 if(!batch)throw fail('Preview expired. Scan again.',404);
 if(!Array.isArray(req.body.keys)||!req.body.keys.length)throw fail('Select at least one candidate.');
 const keys=new Set(req.body.keys), selected=batch.candidates.filter(c=>keys.has(c.key));
 if(selected.length!==keys.size)throw fail('Unknown candidate.');
 let imported=0,skipped=0;
 for(const c of selected){
 const id=`discovered-${fingerprint(req.user.id+':'+c.key)}`;
 const existing=await listSubscriptions(req.user.id);
 if(await getSubscription(id,req.user.id) || existing.some(s=>s.status==='active' && s.merchant.toLowerCase()===c.merchant.toLowerCase())){skipped++;continue;}
 try {await addSubscription({id,name:c.name,merchant:c.merchant,category:c.category,cancelUrl:c.cancelUrl,monthlyCost:c.monthlyCost,currency:'INR',renewalDate:c.renewalDate,billingCycle:c.billingCycle,provider:batch.source,discoveryKey:c.key},req.user.id);imported++;}
 catch(e){if(e.code===11000)skipped++;else throw e;}
 }
 return {imported,skipped};});res.json(result);
}));
router.get('/aa/consents',route(async(req,res)=>res.json(await list('consent',req.user.id))));
router.post('/aa/consents',route(async(req,res)=>{
 const vua=String(req.body.vua||'').trim();if(!/^\d{10}(@[\w.-]+)?$/.test(vua))throw fail('Enter a 10-digit mobile number or AA handle.');
 if(req.body.accepted!==true)throw fail('Confirm that you wish to request bank-data access.');
 const dataRange={from:new Date(Date.now()-180*86400000).toISOString(),to:new Date().toISOString()};
 const c=await setu('/consents','POST',{vua,consentDuration:{unit:'MONTH',value:'1'},dataRange,context:[]});
 if(!c.id || !c.url || !String(c.url).startsWith('https://'))throw fail('Invalid Setu consent response.',502);
 const record={id:c.id,url:c.url,status:c.status||'PENDING',dataRange,mode:setuMode(),createdAt:new Date().toISOString()};
 await put('consent',c.id,req.user.id,record);res.status(201).json(record);
}));
router.post('/aa/consents/:id/sync',route(async(req,res)=>{
 const result=await locked(`aa:${req.params.id}`,async()=>{
 const c=await get('consent',req.params.id,req.user.id);if(!c)throw fail('Consent not found.',404);
 if(c.status==='REVOKED')throw fail('Consent revoked.',409);
 const fresh=await setu(`/consents/${encodeURIComponent(c.id)}`);c.status=fresh.status;
 await put('consent',c.id,req.user.id,c);
 if(!['ACTIVE','APPROVED'].includes(c.status))return {pending:true,message:`Consent status: ${c.status}. Approve in Setu before syncing.`};
 if(!c.sessionId){const session=await setu('/sessions','POST',{consentId:c.id,dataRange:c.dataRange,format:'json'});if(!session.id)throw fail('Setu did not return a session ID.',502);c.sessionId=session.id;await put('consent',c.id,req.user.id,c);}
 const data=await setu(`/sessions/${encodeURIComponent(c.sessionId)}`);
 if(['FAILED','EXPIRED'].includes(data.status)){delete c.sessionId;await put('consent',c.id,req.user.id,c);throw fail(`Data session ${data.status}. Sync again to retry.`,409);}
 if(!['COMPLETED','PARTIAL'].includes(data.status))return {pending:true,message:'Bank data is being prepared. Try Sync again shortly.'};
 const result=await preview(extractSetuTransactions(data),req.user.id,`setu-${c.mode}`);
 if(req.body?.seedSandbox===true){
  if(c.mode!=='sandbox'||setuMode()!=='sandbox')throw fail('Adding sandbox subscriptions is only available in Setu sandbox mode.',403);
  return {...result,partial:data.status==='PARTIAL',seeded:await seedSandbox(req.user.id,result.candidates)};
 }
 return {...result,partial:data.status==='PARTIAL'};
 });res.json(result);
}));
router.post('/aa/consents/:id/revoke',route(async(req,res)=>{
 const c=await get('consent',req.params.id,req.user.id);if(!c)throw fail('Consent not found.',404);
 if(c.status!=='REVOKED'){await setu(`/consents/${encodeURIComponent(c.id)}/revoke`,'POST');c.status='REVOKED';delete c.sessionId;await put('consent',c.id,req.user.id,c);}
 res.json({status:'REVOKED',notice:'Bank-data consent revoked. This does not cancel any payment mandate or delete confirmed subscriptions.'});
}));
router.delete('/discovery/:id',route(async(req,res)=>{await remove('discovery',req.params.id,req.user.id);res.json({deleted:true});}));
export default router;