import { razorpay, razorpayMode, fail } from './providers.js';
import { get, put, list, locked } from './integrationStore.js';
import { addSubscription, getSubscription } from './repository.js';
import { reconcile } from './billing.js';
const lockKey = userId => `checkout-user:${userId}`;
export const validRequestId = id => typeof id === 'string' && /^[a-zA-Z0-9-]{16,80}$/.test(id);
export async function pendingCheckouts(userId) {
  return (await list('checkout', userId, true)).filter(x => x.pending).map(x => ({ requestId: x.requestId || x.recordId.slice(userId.length + 1), planId: x.planId, createdAt: x.createdAt || null }));
}
function checkMode(prior) {
  if (prior.mode && prior.mode !== razorpayMode()) throw fail('Switch back to the Razorpay mode used for this request before recovering it.',409);
}
function matches(remote, userId, requestId, planId) {
  return remote?.id && remote.plan_id === planId && remote.notes?.hub_user_id === userId && remote.notes?.hub_request_id === requestId;
}
async function finish(userId, requestId, prior, remote, plan) {
  const key = `${userId}:${requestId}`;
  // Save the provider id before local writes, so partial failures are repairable.
  await put('checkout', key, userId, {...prior, pending:true, requestId, remoteId:remote.id});
  const binding = await get('billing', remote.id);
  if (binding && binding.userId !== userId) throw fail('Subscription ownership conflict. Contact support.',409);
  const existing = await getSubscription(remote.id, userId);
  if (!existing) {
    const monthlyCost = plan.item.amount / 100 / (plan.interval * (plan.period === 'yearly' ? 12 : 1));
    await addSubscription({id:remote.id,name:plan.item.name,merchant:process.env.MERCHANT_NAME||'Subscription Hub Merchant',monthlyCost:Math.round(monthlyCost*100)/100,currency:'INR',renewalDate:new Date((remote.charge_at||Math.floor(Date.now()/1000))*1000),status:'pending',provider:'razorpay',providerId:remote.id,providerStatus:remote.status,billingCycle:plan.period,cancelUrl:''},userId);
  }
  await put('billing',remote.id,userId,{...binding,id:remote.id,userId,planId:prior.planId,status:remote.status,mode:razorpayMode()});
  // Fetch authoritative status, including authorization that happened during a timeout.
  await reconcile(remote.id,userId);
  const out={id:remote.id,key:process.env.RAZORPAY_KEY_ID,planId:prior.planId,mode:razorpayMode(),requestId};
  await put('checkout',key,userId,out);
  return out;
}
function validatePlan(plan) {
  if (plan.item?.currency !== 'INR' || !['monthly','yearly'].includes(plan.period) || !(plan.interval > 0) || !(plan.item.amount > 0)) throw fail('This project supports INR monthly or yearly merchant plans.');
}
async function recoverUnlocked(userId,requestId) {
  const prior=await get('checkout',`${userId}:${requestId}`,userId);
  if (!prior) throw fail('Checkout request not found.',404);
  checkMode(prior);
  if (!prior.pending) return {...prior,key:process.env.RAZORPAY_KEY_ID};
  let remote;
  if (prior.remoteId) {
    remote=await razorpay(`/subscriptions/${encodeURIComponent(prior.remoteId)}`);
    if (!matches(remote,userId,requestId,prior.planId)) throw fail('Provider subscription does not match this request. Contact support.',409);
  } else {
    // Bounded read-only search. No match is NOT proof that the POST failed.
    const matchesById=new Map(); let complete=false;
    for (let skip=0;skip<1000;skip+=100) {
      const query=new URLSearchParams({plan_id:prior.planId,count:'100',skip:String(skip)});
      const page=await razorpay(`/subscriptions?${query}`);
      if (!Array.isArray(page.items)) throw fail('Razorpay returned an invalid recovery response. Try checking again.',502);
      for (const item of page.items) if(matches(item,userId,requestId,prior.planId)) matchesById.set(item.id,item);
      if (page.items.length<100) {complete=true;break;}
    }
    if (matchesById.size>1) throw fail('Multiple provider subscriptions match this request. Contact support before authorizing any of them.',409);
    if (!complete) throw fail('Recovery search limit reached. The request remains pending; contact support with the request ID.',409);
    remote=[...matchesById.values()][0];
    if (!remote) return {pending:true,requestId,planId:prior.planId,message:'No matching subscription is visible yet. Check again later or contact support with this request ID. No new subscription was created.'};
    remote=await razorpay(`/subscriptions/${encodeURIComponent(remote.id)}`);
    if (!matches(remote,userId,requestId,prior.planId)) throw fail('Provider subscription does not match this request.',409);
  }
  const plan=prior.plan || await razorpay(`/plans/${encodeURIComponent(prior.planId)}`);
  validatePlan(plan);
  return finish(userId,requestId,prior,remote,plan);
}
export async function recoverCheckout(userId,requestId) {
  if(!validRequestId(requestId)) throw fail('A valid requestId is required.');
  return locked(lockKey(userId),()=>recoverUnlocked(userId,requestId));
}
export async function createCheckout(userId,planId,requestId) {
  return locked(lockKey(userId),async()=>{
    const key=`${userId}:${requestId}`,prior=await get('checkout',key,userId);
    if(prior){if(prior.planId!==planId)throw fail('Request already used for another plan.',409);return recoverUnlocked(userId,requestId);}
    if((await pendingCheckouts(userId)).some(p=>p.planId===planId)) throw fail('An earlier request for this plan is still pending. Use Check pending request before subscribing again.',409);
    const plan=await razorpay(`/plans/${encodeURIComponent(planId)}`);validatePlan(plan);
    const pending={pending:true,requestId,planId,plan,mode:razorpayMode(),createdAt:new Date().toISOString()};
    await put('checkout',key,userId,pending);
    let remote;
    try {
      // Never automatically retry this external POST.
      remote=await razorpay('/subscriptions','POST',{plan_id:planId,total_count:Math.min(120,Number(process.env.RAZORPAY_TOTAL_COUNT)||12),quantity:1,customer_notify:1,notes:{hub_user_id:userId,hub_request_id:requestId}});
      if(!remote.id) throw fail('Invalid Razorpay response.',502);
    } catch {
      throw fail('Razorpay creation could not be confirmed. Use Check pending request; do not create another request for this plan.',502);
    }
    return finish(userId,requestId,pending,remote,plan);
  });
}
