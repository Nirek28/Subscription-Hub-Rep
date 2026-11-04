import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createHmac} from 'node:crypto';
import auth from './auth.js';
import india from './india.js';
import billing,{webhook} from './razorpay.js';
import api from './api.js';
import {requireAuth} from '../services/auth.js';
import {put} from '../services/integrationStore.js';
import {verifyHmac,razorpay} from '../services/providers.js';

test('India API flows with mocked providers: ownership, consent, payment signatures, webhook replay and cancellation',async(t)=>{
 Object.assign(process.env,{SESSION_SECRET:'test-only',RAZORPAY_KEY_ID:'rzp_test_fake',RAZORPAY_KEY_SECRET:'test-secret',RAZORPAY_WEBHOOK_SECRET:'hook-secret',RAZORPAY_PLAN_IDS:'plan_test',SETU_BASE_URL:'https://fiu-sandbox.setu.co/v2',SETU_PRODUCT_INSTANCE_ID:'product-test',SETU_CLIENT_ID:'client-test',SETU_CLIENT_SECRET:'secret-test'});
 let creationNotes={};
 let paymentState='created',consentState='PENDING',creates=0,fetches=0;
 const realFetch=globalThis.fetch;
 globalThis.fetch=async(url,opts={})=>{
 const u=new URL(url),body=opts.body?JSON.parse(opts.body):{};
 let data;
 if(u.hostname==='api.razorpay.com'){
 if(u.pathname==='/v1/plans/plan_test')data={id:'plan_test',period:'monthly',interval:1,item:{name:'Demo service',amount:9900,currency:'INR'}};
 else if(u.pathname==='/v1/subscriptions'&&opts.method==='POST'){creates++;creationNotes=body.notes;data={id:'sub_test',status:paymentState};}
 else if(u.pathname==='/v1/subscriptions/sub_test/cancel'){paymentState='cancelled';data={id:'sub_test',status:paymentState};}
 else if(u.pathname==='/v1/subscriptions/sub_test'){fetches++;data={id:'sub_test',status:paymentState,charge_at:1800000000,plan_id:'plan_test',notes:creationNotes};}
 else if(u.pathname==='/v1/invoices')data={items:[{id:'inv_1',payment_id:'pay_test',amount_paid:9900,status:'paid',currency:'INR'}]};
 else throw new Error('Unexpected Razorpay call '+u.pathname);
 }else if(u.hostname==='fiu-sandbox.setu.co'){
 assert.equal(opts.headers['x-product-instance-id'],'product-test');
 if(u.pathname==='/v2/consents'&&opts.method==='POST'){assert.equal(body.vua,'9999999999');data={id:'consent_test',url:'https://fiu-sandbox.setu.co/consent',status:consentState};}
 else if(u.pathname.endsWith('/revoke')){consentState='REVOKED';data={status:consentState};}
 else if(u.pathname==='/v2/consents/consent_test')data={status:consentState};
 else if(u.pathname==='/v2/sessions'){assert.equal(body.consentId,'consent_test');data={id:'session_test'};}
 else if(u.pathname==='/v2/sessions/session_test')data={status:'COMPLETED',fips:[{accounts:[{data:{transactions:{transaction:['2026-07-01','2026-08-01','2026-09-01'].map(date=>({narration:'Netflix',amount:649,type:'DEBIT',transactionTimestamp:date}))}}}]}]};
 else throw new Error('Unexpected Setu call '+u.pathname);
 }else return realFetch(url,opts);
 return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
 };
 const app=express();app.post('/api/webhooks/razorpay',express.raw({type:'application/json'}),webhook);app.use(express.json());app.use('/api/auth',auth);app.use('/api/india',requireAuth,india);app.use('/api/razorpay',requireAuth,billing);app.use('/api',requireAuth,api);app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));
 const server=app.listen(0);await new Promise(resolve=>server.once('listening',resolve));
 t.after(()=>{globalThis.fetch=realFetch;server.close();server.closeAllConnections();});
 const base=`http://localhost:${server.address().port}/api`;
 async function request(path,body,cookie='',extra={}){const r=await realFetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',cookie,...extra},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 async function user(email){assert.equal((await request('/api/auth/register',{name:'Tester',email,password:'password123'})).status,201);return (await request('/api/auth/login',{email,password:'password123'})).cookie;}
 const a=await user('a@example.test'),b=await user('b@example.test');
 await t.test('unauthenticated discovery rejected',async()=>assert.equal((await request('/india/discovery/preview',{demo:true})).status,401));
 let batch;
 await t.test('preview and confirm are isolated and deduplicated',async()=>{
 batch=(await request('/india/discovery/preview',{demo:true},a)).data;assert.equal(batch.candidates.length,3);
 const body={batchId:batch.batchId,keys:batch.candidates.map(c=>c.key)};
 assert.equal((await request('/india/discovery/confirm',body,b)).status,404);
 assert.equal((await request('/india/discovery/confirm',body,a)).data.imported,3);
 assert.equal((await request('/india/discovery/confirm',body,a)).data.skipped,3);
 });
 await t.test('Setu pending, approved data scan, ownership and revocation',async()=>{
 assert.equal((await request('/india/aa/consents',{vua:'9999999999'},a)).status,400);
 assert.equal((await request('/india/aa/consents',{vua:'9999999999',accepted:true},a)).status,201);
 assert.equal((await request('/india/aa/consents/consent_test/sync',{},b)).status,404);
 assert.equal((await request('/india/aa/consents/consent_test/sync',{},a)).data.pending,true);
 consentState='ACTIVE';assert.equal((await request('/india/aa/consents/consent_test/sync',{},a)).data.candidates.length,1);
 assert.equal((await request('/india/aa/consents/consent_test/revoke',{},a)).data.status,'REVOKED');
 assert.equal((await request('/india/aa/consents/consent_test/sync',{},a)).status,409);
 });
 await t.test('Setu sandbox sync can add a few subscriptions (sandbox only, deduplicated, labelled)',async()=>{
 const c=await user('c@example.test');consentState='ACTIVE';
 assert.equal((await request('/india/aa/consents',{vua:'9999999999',accepted:true},c)).status,201);
 const first=await request('/india/aa/consents/consent_test/sync',{seedSandbox:true},c);
 assert.equal(first.status,200);assert.equal(first.data.seeded.added.length,3);
 assert.equal(first.data.seeded.added.filter(x=>x.sample).length,2);
 const subs=(await request('/subscriptions',undefined,c)).data;
 assert.ok(['Netflix','Spotify','Google One'].every(n=>subs.some(x=>x.merchant===n)));
 const again=await request('/india/aa/consents/consent_test/sync',{seedSandbox:true},c);
 assert.equal(again.data.seeded.added.length,0);assert.equal(again.data.seeded.skipped,3);
 process.env.SETU_MODE='live';
 assert.equal((await request('/india/aa/consents/consent_test/sync',{seedSandbox:true},c)).status,503);
 process.env.SETU_MODE='sandbox';
 });
 await t.test('checkout allowlist and duplicate request guard',async()=>{
 assert.equal((await request('/razorpay/subscriptions',{planId:'bad'},a)).status,400);
 const body={planId:'plan_test',requestId:'12345678-1234-1234-1234-123456789abc'};
 assert.equal((await request('/razorpay/subscriptions',body,a)).data.id,'sub_test');
 assert.equal((await request('/razorpay/subscriptions',body,a)).data.id,'sub_test');assert.equal(creates,1);
 assert.equal((await request('/razorpay/subscriptions/sub_test/sync',{},b)).status,404);
 });
 await t.test('pending API ownership and recovery, including signed webhook repair',async()=>{
 const requestId='12345678-1234-1234-1234-123456789abc';
 const uid=(await request('/api/auth/me',undefined,a)).data.user.id;
 const makePending=()=>put('checkout',`${uid}:${requestId}`,uid,{pending:true,planId:'plan_test',remoteId:'sub_test',mode:'test'});
 await makePending();
 assert.equal((await request('/razorpay/pending-checkouts',undefined,a)).data[0].requestId,requestId);
 assert.equal((await request('/razorpay/pending-checkouts',undefined,b)).data.length,0);
 assert.equal((await request(`/razorpay/checkout-requests/${requestId}/recover`,{},b)).status,404);
 assert.equal((await request(`/razorpay/checkout-requests/${requestId}/recover`,{},a)).data.id,'sub_test');
 await makePending();
 const event={event:'subscription.updated',payload:{subscription:{entity:{id:'sub_test',notes:creationNotes}}}};
 const signature=createHmac('sha256','hook-secret').update(JSON.stringify(event)).digest('hex');
 assert.equal((await request('/webhooks/razorpay',event,'',{'x-razorpay-signature':signature})).status,200);
 assert.equal((await request('/razorpay/pending-checkouts',undefined,a)).data.length,0);
 assert.equal(creates,1);
 });
 await t.test('checkout signature verification uses subscription binding',async()=>{
 const body={razorpay_subscription_id:'sub_test',razorpay_payment_id:'pay_test',razorpay_signature:'bad'};
 assert.equal((await request('/razorpay/verify',body,a)).status,400);
 paymentState='active';body.razorpay_signature=createHmac('sha256','test-secret').update('pay_test|sub_test').digest('hex');
 assert.equal((await request('/razorpay/verify',body,a)).data.subscription.status,'active');
 assert.equal((await request('/razorpay/subscriptions/sub_test/payments',undefined,a)).data.items[0].amount,9900);
 });
 await t.test('webhook rejects invalid signatures; duplicate delivery is harmless',async()=>{
 const event={event:'subscription.activated',payload:{subscription:{entity:{id:'sub_test'}}}};
 assert.equal((await request('/webhooks/razorpay',event)).status,400);
 const signature=createHmac('sha256','hook-secret').update(JSON.stringify(event)).digest('hex');
 const before=fetches;
 assert.equal((await request('/webhooks/razorpay',event,'',{'x-razorpay-signature':signature})).status,200);
 assert.equal((await request('/webhooks/razorpay',event,'',{'x-razorpay-signature':signature})).status,200);assert.equal(fetches,before+1);
 });
 await t.test('cancellation requires confirmation and cannot be forged locally',async()=>{
 assert.equal((await request('/subscriptions/sub_test/confirm-canceled',{confirmed:true},a)).status,409);
 assert.equal((await request('/razorpay/subscriptions/sub_test/cancel',{},a)).status,400);
 assert.equal((await request('/razorpay/subscriptions/sub_test/cancel',{confirmed:true},a)).data.status,'canceled');
 assert.equal((await request('/subscriptions',undefined,b)).data.length,0);
 });
 await t.test('live payment gate and malformed signatures',async()=>{
 assert.equal(verifyHmac('body','xx','secret'),false);process.env.RAZORPAY_KEY_ID='rzp_live_fake';process.env.ENABLE_LIVE_PAYMENTS='false';await assert.rejects(()=>razorpay('/plans'),/disabled/);
 });
});