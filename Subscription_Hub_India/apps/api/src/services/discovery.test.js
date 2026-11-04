import test from 'node:test';
import assert from 'node:assert/strict';
import {detectSubscriptions,parseCSV,extractSetuTransactions} from './discovery.js';
const now=new Date('2026-11-04');
const rows=['2026-08-01','2026-09-01','2026-10-01'].map(date=>({date,merchant:'UPI/NETFLIX/12345678',amount:649,type:'DEBIT',currency:'INR'}));
test('finds monthly debits, ignores credits and isolated purchases',()=>{
 const result=detectSubscriptions([...rows,{...rows[0],type:'CREDIT',merchant:'Salary'},{...rows[0],merchant:'Groceries'}],now);
 assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].merchant,'Netflix');assert.equal(result.candidates[0].monthlyCost,649);assert.equal(result.rejected,1);
});
test('duplicate rows do not inflate recurrence; irregular payments do not qualify',()=>{
 assert.equal(detectSubscriptions([rows[0],rows[0]],now).candidates.length,0);
 assert.equal(detectSubscriptions([rows[0],{...rows[1],date:'2026-08-03'}],now).candidates.length,0);
});
test('normalizes annual costs and rejects non-INR, impossible dates and negative debits',()=>{
 const annual=[{...rows[0],date:'2024-10-01',amount:1200},{...rows[0],date:'2025-10-01',amount:1200}];
 assert.equal(detectSubscriptions(annual,now).candidates[0].monthlyCost,100);
 assert.equal(detectSubscriptions(rows.map(r=>({...r,currency:'USD'})),now).candidates.length,0);
 assert.equal(detectSubscriptions([{...rows[0],date:'2026-02-30'},{...rows[1],amount:-100}],now).rejected,2);
});
test('CSV quoted commas, Indian date format, BOM and debit aliases',()=>{
 const csv='\uFEFFDate,Narration,Debit,Type\n01/08/2026,"NETFLIX, India","1,299",DR\n01/09/2026,NETFLIX,1299,DR';
 const result=detectSubscriptions(parseCSV(csv),now);assert.equal(result.candidates[0].monthlyCost,1299);
 assert.throws(()=>parseCSV('date,merchant,amount\n"oops'),/unclosed/);
 assert.throws(()=>parseCSV('hello,world'),/columns/);
});
test('Setu extractor ignores profile and only extracts transaction objects',()=>{
 const tx={narration:'Netflix',amount:'649',type:'DEBIT',transactionTimestamp:'2026-09-01T00:00:00Z'};
 assert.equal(extractSetuTransactions({fips:[{accounts:[{data:{account:{profile:{name:'Private'},transactions:{transaction:[tx]}}}}]}]}).length,1);
});
