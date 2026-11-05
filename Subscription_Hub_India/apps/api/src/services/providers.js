import { createHmac, timingSafeEqual } from 'node:crypto';
export const fail = (message,status=400) => Object.assign(new Error(message),{status});
export const razorpayMode = () => process.env.RAZORPAY_KEY_ID?.startsWith('rzp_live_') ? 'live' : 'test';
export const razorpayConfigured = () => !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
export const setuMode = () => process.env.SETU_MODE || 'sandbox';
// Trim stray whitespace/CR/quotes: values pasted into Render or a CRLF .env otherwise break auth with a 403.
const envv = (k) => String(process.env[k] ?? '').trim().replace(/^["']|["']$/g, '').trim();
export const setuConfigured = () => !!(envv('SETU_BASE_URL') && envv('SETU_PRODUCT_INSTANCE_ID') && (envv('SETU_ACCESS_TOKEN') || (envv('SETU_CLIENT_ID') && envv('SETU_CLIENT_SECRET'))));
export function verifyHmac(body, signature, secret) {
  if(!secret || typeof signature!=='string' || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  return timingSafeEqual(createHmac('sha256',secret).update(body).digest(),Buffer.from(signature,'hex'));
}
async function jsonFetch(url,options,provider) {
  let response;
  try {response=await fetch(url,{...options,signal:AbortSignal.timeout(20000),redirect:'error'});} catch {throw fail(`${provider} could not be reached. Try again.`,502);}
  const raw=await response.text();
  let data={};try{data=raw?JSON.parse(raw):{};}catch{}
  if(!response.ok) {
    console.error(`[${provider}] ${options.method||'GET'} ${new URL(url).pathname} -> ${response.status}`, JSON.stringify(data));
    console.error(`[${provider}] raw body: ${raw.slice(0,500)} | content-type: ${response.headers.get('content-type')} | server: ${response.headers.get('server')}`);
    const detail=String(data?.errorMsg||data?.error?.message||data?.message||data?.error||data?.code||'').slice(0,200);
    throw fail(`${provider} rejected the request (${response.status}).${detail?` Provider says: ${detail}.`:''} Check credentials, product settings and provider dashboard.`,502);
  }
  return data;
}
export async function razorpay(path,method='GET',body) {
  if(!razorpayConfigured()) throw fail('Configure RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env.',503);
  if(razorpayMode()==='live' && process.env.ENABLE_LIVE_PAYMENTS!=='true') throw fail('Live payments are disabled. Use test keys or explicitly enable approved live payments.',503);
  return jsonFetch(`https://api.razorpay.com/v1${path}`,{method,headers:{Authorization:`Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64')}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})},'Razorpay');
}
export async function setu(path,method='GET',body) {
  if(!setuConfigured()) throw fail('Configure your Setu FIU URL, product instance and server credentials in .env. Local sample discovery works without credentials.',503);
  if(setuMode()==='live' && process.env.ENABLE_LIVE_AA!=='true') throw fail('Live AA access requires approved onboarding and ENABLE_LIVE_AA=true.',503);
  const base=new URL(envv('SETU_BASE_URL'));
  if(base.protocol!=='https:' || !(base.hostname==='setu.co' || base.hostname.endsWith('.setu.co'))) throw fail('SETU_BASE_URL must be your HTTPS Setu FIU endpoint.',503);
  const headers={'Content-Type':'application/json','Accept':'application/json','User-Agent':'Mozilla/5.0 (compatible; SubscriptionHub/1.0)','x-product-instance-id':envv('SETU_PRODUCT_INSTANCE_ID')};
  // Prefer client id/secret (Setu v2 standard). A stale/blank SETU_ACCESS_TOKEN used to override them and caused 403s.
  if(envv('SETU_CLIENT_ID') && envv('SETU_CLIENT_SECRET')) {headers['x-client-id']=envv('SETU_CLIENT_ID');headers['x-client-secret']=envv('SETU_CLIENT_SECRET');}
  else headers.Authorization=`Bearer ${envv('SETU_ACCESS_TOKEN')}`;
  return jsonFetch(base.href.replace(/\/$/,'')+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})},'Setu');
}