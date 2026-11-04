import { razorpay, fail } from './providers.js';
import { get, put, locked } from './integrationStore.js';
import { getSubscription, saveSubscription } from './repository.js';
export async function reconcile(id,userId){
 return locked(`billing:${id}`,async()=>{
 const binding=await get('billing',id,userId);if(!binding)throw fail('Subscription not found.',404);
 const remote=await razorpay(`/subscriptions/${encodeURIComponent(id)}`);
 const local=await getSubscription(id,binding.userId);if(!local)throw fail('Local subscription missing.',409);
 local.providerStatus=remote.status;
 local.status=({active:'active',authenticated:'pending',created:'pending',pending:'pending',halted:'halted',paused:'paused',cancelled:'canceled',completed:'completed',expired:'canceled'})[remote.status]||'pending';
 if(remote.charge_at || remote.current_end)local.renewalDate=new Date((remote.charge_at||remote.current_end)*1000);
 await saveSubscription(local,binding.userId);
 await put('billing',id,binding.userId,{...binding,status:remote.status,lastSyncedAt:new Date().toISOString()});
 return local;
 });
}
export async function cancelBilling(id,userId){
 if(!await get('billing',id,userId))throw fail('Subscription not found.',404);
 const current=await razorpay(`/subscriptions/${encodeURIComponent(id)}`);
 if(!['cancelled','completed','expired'].includes(current.status))await razorpay(`/subscriptions/${encodeURIComponent(id)}/cancel`,'POST',{cancel_at_cycle_end:0});
 return reconcile(id,userId);
}
