import { Router } from 'express';
import { createHash } from 'node:crypto';
import { razorpay, razorpayMode, verifyHmac, fail } from '../services/providers.js';
import { put, get, list, locked } from '../services/integrationStore.js';
import { createCheckout, recoverCheckout, pendingCheckouts } from '../services/checkoutRecovery.js';
import { reconcile, cancelBilling } from '../services/billing.js';
const router=Router();
const route=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){next(e);}};
const planIds=()=> (process.env.RAZORPAY_PLAN_IDS||'').split(',').map(x=>x.trim()).filter(Boolean);
router.get('/plans',route(async(req,res)=>{
 const plans=await Promise.all(planIds().map(id=>razorpay(`/plans/${encodeURIComponent(id)}`)));
 res.json(plans.filter(p=>p.item?.currency==='INR').map(p=>({id:p.id,name:p.item.name,amount:p.item.amount,period:p.period,interval:p.interval})));
}));
router.post('/subscriptions',route(async(req,res)=>{
 const planId=String(req.body.planId||''),requestId=String(req.body.requestId||'');
 if(!planIds().includes(planId))throw fail('Choose a configured merchant plan.');
 if(!/^[a-zA-Z0-9-]{16,80}$/.test(requestId))throw fail('A valid requestId is required.');
 const result=await createCheckout(req.user.id,planId,requestId);
 res.status(result.pending?202:201).json(result);
}));
router.get('/pending-checkouts',route(async(req,res)=>res.json(await pendingCheckouts(req.user.id))));
router.post('/checkout-requests/:requestId/recover',route(async(req,res)=>{
 const result=await recoverCheckout(req.user.id,req.params.requestId);
 res.status(result.pending?202:200).json(result);
}));
router.get('/subscriptions',route(async(req,res)=>res.json(await list('billing',req.user.id))));
router.post('/subscriptions/:id/sync',route(async(req,res)=>res.json(await reconcile(req.params.id,req.user.id))));
router.post('/subscriptions/:id/cancel',route(async(req,res)=>{
 if(req.body.confirmed!==true)throw fail('Confirm cancellation first.');
 res.json(await cancelBilling(req.params.id,req.user.id));
}));
router.post('/verify',route(async(req,res)=>{
 const {razorpay_subscription_id:id,razorpay_payment_id:paymentId,razorpay_signature:signature}=req.body;
 if(typeof id!=='string'||typeof paymentId!=='string'||!await get('billing',id,req.user.id))throw fail('Subscription not found.',404);
 if(!verifyHmac(`${paymentId}|${id}`,signature,process.env.RAZORPAY_KEY_SECRET))throw fail('Invalid payment signature.',400);
 const subscription=await reconcile(id,req.user.id);
 res.json({verified:true,subscription});
}));
router.get('/subscriptions/:id/payments',route(async(req,res)=>{
 if(!await get('billing',req.params.id,req.user.id))throw fail('Subscription not found.',404);
 const skip=Math.max(0,Math.min(100000,Number(req.query.skip)||0));
 const result=await razorpay(`/invoices?subscription_id=${encodeURIComponent(req.params.id)}&count=100&skip=${skip}`);
 const items=(result.items||[]).map(i=>({id:i.id,paymentId:i.payment_id,amount:i.amount_paid||0,currency:i.currency,status:i.status,paidAt:i.paid_at}));
 for(const p of items)await put('invoice',p.id,req.user.id,{...p,subscriptionId:req.params.id});
 res.json({items,nextSkip:items.length===100?skip+100:null});
}));
export const webhook=route(async(req,res)=>{
 if(!verifyHmac(req.body,req.get('x-razorpay-signature'),process.env.RAZORPAY_WEBHOOK_SECRET))throw fail('Invalid webhook signature.',400);
 let event;try{event=JSON.parse(req.body.toString());}catch{throw fail('Invalid JSON.');}
 const eventId=createHash('sha256').update(req.body).digest('hex');
 await locked(`event:${eventId}`,async()=>{
 if(await get('webhook',eventId))return;
 const id=event.payload?.subscription?.entity?.id;
 const entity=event.payload?.subscription?.entity;
 const userId=entity?.notes?.hub_user_id, requestId=entity?.notes?.hub_request_id;
 const checkout = userId && requestId ? await get('checkout',`${userId}:${requestId}`,userId) : null;
 if(id && checkout?.pending) {
   const recovered=await recoverCheckout(userId,requestId);
   if(recovered.pending) throw fail('Subscription recovery is still pending. Retry webhook later.',503);
 }
 if(id && await get('billing',id))await reconcile(id);
 // Persist only event metadata, not customer payment payloads.
 await put('webhook',eventId,'system',{event:event.event,subscriptionId:id,processedAt:new Date().toISOString()});
 });res.json({received:true});
});
export default router;
