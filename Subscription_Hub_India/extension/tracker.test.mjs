import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('./tracker.js',import.meta.url),'utf8');
const {matches,trackedSubscription,interval}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const mappings=[{subscriptionId:'canva',domains:['canva.com']}];
test('only matching foreground HTTPS tab counts',()=>{
 assert.equal(matches('www.canva.com','canva.com'),true);assert.equal(matches('canva.com.evil.test','canva.com'),false);
 assert.equal(trackedSubscription({url:'https://www.canva.com/design'},true,'active',mappings),'canva');
 for(const [tab,focus,idle] of [[{url:'https://canva.com'},false,'active'],[{url:'https://canva.com'},true,'idle'],[{url:'https://canva.com',incognito:true},true,'active'],[{url:'https://canva.com.evil.test'},true,'active'],[{url:'chrome://settings'},true,'active'],[{},true,'active']])assert.equal(trackedSubscription(tab,focus,idle,mappings),null);
});
test('restart, sleep and backwards clocks do not create long usage',()=>{
 const anchor={at:100000,session:'a',subscriptionId:'canva'};assert.equal(interval(anchor,130000,'a','id').activeSeconds,30);assert.equal(interval(anchor,130000,'b','id'),null);assert.equal(interval(anchor,200000,'a','id'),null);assert.equal(interval(anchor,90000,'a','id'),null);
});
