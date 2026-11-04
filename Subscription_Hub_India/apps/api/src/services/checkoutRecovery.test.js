import test from 'node:test';
import assert from 'node:assert/strict';
import {createCheckout,recoverCheckout,pendingCheckouts} from './checkoutRecovery.js';
import {get,put} from './integrationStore.js';
import {listSubscriptions} from './repository.js';

test('Razorpay interrupted creation recovery and duplicate protection',async t=>{
 Object.assign(process.env,{RAZORPAY_KEY_ID:'rzp_test_recovery',RAZORPAY_KEY_SECRET:'test-only'});
 const realFetch=global.fetch;
 let posts=0, loseResponse=true, hide=false, failRead=false, badPage=false, paginated=false;
 const remotes=[];
 const plan={id:'plan_recovery',period:'monthly',interval:1,item:{name:'Recovery Test',amount:1000,currency:'INR'}};
 global.fetch=async(url,options={})=>{
  const u=new URL(url);let data;
  if(u.pathname==='/v1/plans/plan_recovery')data=plan;
  else if(u.pathname==='/v1/subscriptions'&&options.method==='POST'){
   posts++;const body=JSON.parse(options.body);
   data={id:`sub_recovery_${posts}`,plan_id:body.plan_id,notes:body.notes,status:'created'};remotes.push(data);
   if(loseResponse)throw new Error('Response lost after provider creation');
  }else if(u.pathname==='/v1/subscriptions'){
   if(failRead)throw new Error('offline');
   if(badPage)data={};
   else if(hide)data={items:[]};
   else if(paginated&&u.searchParams.get('skip')==='0')data={items:Array.from({length:100},(_,i)=>({id:`other_${i}`,plan_id:plan.id,notes:{hub_user_id:'other',hub_request_id:'other'}}))};
   else data={items:remotes};
  }else if(u.pathname.startsWith('/v1/subscriptions/'))data=remotes.find(x=>x.id===u.pathname.split('/').at(-1));
  else throw new Error('Unexpected provider request');
  return new Response(JSON.stringify(data),{status:200});
 };
 t.after(()=>{global.fetch=realFetch;});
 const id='request-recovery-0001', user='recovery-user-1';
 await t.test('lost response preserves pending and blocks a fresh request id',async()=>{
  await assert.rejects(()=>createCheckout(user,plan.id,id),/could not be confirmed/);
  assert.equal(posts,1);assert.equal((await pendingCheckouts(user)).length,1);
  await assert.rejects(()=>createCheckout(user,plan.id,'request-recovery-0002'),/earlier request/);
  assert.equal(posts,1);
 });
 await t.test('wrong user, malformed id and changed plan rejected',async()=>{
  await assert.rejects(()=>recoverCheckout('attacker',id),/not found/);
  await assert.rejects(()=>recoverCheckout(user,'bad'),/valid requestId/);
  await assert.rejects(()=>createCheckout(user,'different',id),/another plan/);
 });
 await t.test('not found, provider outage and invalid page never retry POST',async()=>{
  hide=true;assert.equal((await recoverCheckout(user,id)).pending,true);hide=false;
  failRead=true;await assert.rejects(()=>recoverCheckout(user,id),/could not be reached/);failRead=false;
  badPage=true;await assert.rejects(()=>recoverCheckout(user,id),/invalid recovery response/);badPage=false;
  assert.equal(posts,1);
 });
 await t.test('pagination and concurrent recovery produce one dashboard record',async()=>{
  paginated=true;
  const results=await Promise.all([recoverCheckout(user,id),recoverCheckout(user,id),createCheckout(user,plan.id,id)]);
  assert.ok(results.every(r=>r.id==='sub_recovery_1'));
  assert.equal(posts,1);assert.equal((await listSubscriptions(user)).length,1);assert.equal((await pendingCheckouts(user)).length,0);
  paginated=false;
 });
 await t.test('legacy pending record can recover without timestamps or stored plan',async()=>{
  const legacyId='request-legacy-0001';
  await put('checkout',`${user}:${legacyId}`,user,{pending:true,planId:plan.id});
  remotes.push({id:'sub_legacy',plan_id:plan.id,status:'active',notes:{hub_user_id:user,hub_request_id:legacyId}});
  assert.equal((await pendingCheckouts(user))[0].requestId,legacyId);
  assert.equal((await recoverCheckout(user,legacyId)).id,'sub_legacy');
  assert.equal((await listSubscriptions(user)).find(x=>x.id==='sub_legacy').status,'active');
 });
 await t.test('partial local completion repairs without adding a second local record',async()=>{
  await put('checkout',`${user}:${id}`,user,{pending:true,planId:plan.id,remoteId:'sub_recovery_1',mode:'test'});
  await recoverCheckout(user,id);assert.equal((await listSubscriptions(user)).filter(x=>x.id==='sub_recovery_1').length,1);
 });
 await t.test('multiple provider matches stay unresolved',async()=>{
  const duplicate='request-duplicate-001';await put('checkout',`${user}:${duplicate}`,user,{pending:true,planId:plan.id});
  for(const suffix of ['a','b'])remotes.push({id:`sub_duplicate_${suffix}`,plan_id:plan.id,status:'created',notes:{hub_user_id:user,hub_request_id:duplicate}});
  await assert.rejects(()=>recoverCheckout(user,duplicate),/Multiple provider/);
  assert.equal((await get('checkout',`${user}:${duplicate}`,user)).pending,true);
 });
 await t.test('mode changes cannot silently recover against another mode',async()=>{
  process.env.RAZORPAY_KEY_ID='rzp_live_recovery';
  await assert.rejects(()=>recoverCheckout(user,id),/Switch back/);
  process.env.RAZORPAY_KEY_ID='rzp_test_recovery';
 });
 await t.test('concurrent successful creates with same id make one provider POST',async()=>{
  loseResponse=false;const before=posts;
  const outcomes=await Promise.all([1,2,3].map(()=>createCheckout('another-user',plan.id,'request-concurrent-001')));
  assert.equal(posts,before+1);assert.ok(outcomes.every(x=>x.id===outcomes[0].id));
 });
});
