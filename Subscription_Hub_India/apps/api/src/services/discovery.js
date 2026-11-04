import { createHash } from 'node:crypto';
const catalog = [
 ['netflix','Netflix','Entertainment','https://www.netflix.com/account'],
 ['spotify','Spotify','Music','https://www.spotify.com/account/'],
 ['amazon prime','Amazon Prime','Entertainment','https://www.amazon.in/prime'],
 ['jiohotstar','JioHotstar','Entertainment','https://www.hotstar.com/in'],
 ['youtube','YouTube','Entertainment','https://www.youtube.com/paid_memberships'],
 ['google one','Google One','Storage','https://one.google.com/'],
 ['apple','Apple','Entertainment','https://account.apple.com/']
];
export const fingerprint = value => createHash('sha256').update(value).digest('hex').slice(0,24);
export function parseCSV(text) {
  if(typeof text!=='string' || text.length>1000000) throw new Error('CSV must be under 1 MB.');
  const rows=[]; let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"') { if(quoted && text[i+1]==='"'){field+='"';i++;} else quoted=!quoted; }
    else if(!quoted && (c===',' || c==='\n')) { row.push(field.trim());field='';if(c==='\n'){rows.push(row);row=[];} }
    else if(c!=='\r') field+=c;
  }
  if(quoted) throw new Error('CSV has an unclosed quoted field.');
  if(field || row.length){row.push(field.trim());rows.push(row);}
  const headers=(rows.shift()||[]).map(x=>x.replace(/^\uFEFF/,'').toLowerCase().replace(/[^a-z]/g,''));
  const aliases={date:['date','transactiondate','valuedate'],merchant:['merchant','description','narration','particulars'],amount:['amount','debit','withdrawal','withdrawalamt'],type:['type','transactiontype'],currency:['currency']};
  const indexes=Object.fromEntries(Object.entries(aliases).map(([key,names])=>[key,headers.findIndex(h=>names.includes(h))]));
  if(['date','merchant','amount'].some(k=>indexes[k]<0)) throw new Error('Use columns date, merchant (or narration), amount (or debit), type, currency. Dates: YYYY-MM-DD or DD/MM/YYYY.');
  if(rows.length>5000) throw new Error('Maximum 5000 transactions per scan.');
  return rows.filter(r=>r.some(Boolean)).map(r=>Object.fromEntries(Object.entries(indexes).map(([k,i])=>[k,i<0?'':r[i]])));
}
function dateOf(value) {
  let s=String(value||'').trim();
  if(/^\d{2}\/\d{2}\/\d{4}$/.test(s)){const [d,m,y]=s.split('/');s=`${y}-${m}-${d}`;}
  const day=s.slice(0,10);const dt=new Date(day+'T00:00:00Z');
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(+dt) && dt.toISOString().slice(0,10)===day ? dt : null;
}
export function extractSetuTransactions(payload) {
  const out=[];
  function walk(v,depth=0){if(!v || depth>20)return;if(Array.isArray(v)){v.forEach(x=>walk(x,depth+1));return;}if(typeof v!=='object')return;
    if(v.amount!==undefined && (v.transactionTimestamp || v.valueDate || v.date) && (v.narration || v.merchant)) out.push({date:v.transactionTimestamp||v.valueDate||v.date,merchant:v.narration||v.merchant,amount:v.amount,type:v.type||v.transactionType,currency:v.currency||'INR'});
    else Object.values(v).forEach(x=>walk(x,depth+1));
  } walk(payload);return out;
}
export function detectSubscriptions(transactions, now=new Date()) {
  const groups=new Map(),seen=new Set();let rejected=0;
  for(const t of transactions){
    const date=dateOf(t.date);const amount=Number(String(t.amount??'').replace(/[₹,\s]/g,''));
    const raw=String(t.merchant||'').trim().slice(0,200), type=String(t.type||'DEBIT').toUpperCase();
    if(!date || date>now || !raw || !Number.isFinite(amount) || amount<=0 || (t.currency && t.currency.toUpperCase()!=='INR') || !['DEBIT','DR','D'].includes(type)){rejected++;continue;}
    const known=catalog.find(([match])=>raw.toLowerCase().includes(match));
    const merchant=known?.[1] || raw.replace(/\b(UPI|ACH|NACH|ECS|POS|SI|DEBIT|AUTOPAY)\b/gi,' ').replace(/\d{5,}/g,'').replace(/[\/@:_-]+/g,' ').replace(/\s+/g,' ').trim();
    if(!merchant){rejected++;continue;}
    const key=merchant.toLowerCase(), unique=`${key}|${date.toISOString()}|${amount}`;
    if(seen.has(unique))continue;seen.add(unique);
    const g=groups.get(key)||{merchant,known,txs:[]};g.txs.push({date,amount});groups.set(key,g);
  }
  const candidates=[];
  for(const [key,g] of groups){
    const txs=g.txs.sort((a,b)=>a.date-b.date);if(txs.length<2)continue;
    const gaps=txs.slice(1).map((t,i)=>(t.date-txs[i].date)/86400000);
    const cycles=[['monthly',30.44,5,1],['quarterly',91.31,10,3],['yearly',365.25,15,12]];
    const cycle=cycles.find(([,days,tolerance])=>gaps.every(gap=>Math.abs(gap-days)<=tolerance));if(!cycle)continue;
    const amounts=txs.map(t=>t.amount),average=amounts.reduce((a,b)=>a+b,0)/amounts.length;
    if(amounts.some(a=>Math.abs(a-average)>average*.2))continue;
    const last=txs.at(-1),renewal=new Date(last.date);const day=renewal.getUTCDate();renewal.setUTCDate(1);renewal.setUTCMonth(renewal.getUTCMonth()+cycle[3]);renewal.setUTCDate(Math.min(day,new Date(Date.UTC(renewal.getUTCFullYear(),renewal.getUTCMonth()+1,0)).getUTCDate()));
    candidates.push({key:fingerprint(key),merchant:g.merchant,name:g.merchant,category:g.known?.[2]||'Other',cancelUrl:g.known?.[3]||'',monthlyCost:Math.round(last.amount/cycle[3]*100)/100,billedAmount:last.amount,billingCycle:cycle[0],currency:'INR',renewalDate:renewal.toISOString(),confidence:txs.length>=3?'high':'medium',occurrences:txs.length,stale:renewal<now});
  }
  return {candidates,analyzedTransactions:transactions.length,rejected};
}
export function demoTransactions(){
 const now=new Date();return [0,1,2].flatMap(offset=>['Netflix','Spotify','Cloud Storage'].map((merchant,i)=>({merchant,date:new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-offset,1)).toISOString().slice(0,10),amount:[649,119,130][i],type:'DEBIT',currency:'INR'})));
}
