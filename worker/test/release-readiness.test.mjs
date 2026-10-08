import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,network,call,deliver,formUrl,mailText,tally,notifyEdit,PREFILL} from './reliability-harness.mjs';
import {DurableStateStore} from '../durable-state.mjs';
import {buildPrefillQuery} from '../product-config.mjs';

test('payment and prebuilt gift have the same delivery and two entitlements',async t=>{
 const n=network(t),p=fixture(),g=fixture();await p.seed();assert.equal((await deliver(p)).status,200);
 assert.equal((await call(g,'/gift-delivery',{slug:'audit-synthetic',email:'audit@example.invalid',lang:'es',prefill:PREFILL})).status,200);
 assert.equal(mailText(n.mail[0]).replace(/https:\/\/tally\.so\/\S+/g,'FORM'),mailText(n.mail[1]).replace(/https:\/\/tally\.so\/\S+/g,'FORM'));
 assert.equal((await g.db.get('hmu_delivery:audit-synthetic',{type:'json'})).free_total,2);
});
test('explicit mail rejection retries the same token; it is never delivered prematurely',async t=>{
 const n=network(t,{mail:i=>new Response(null,{status:i===1?429:202})}),f=fixture();await f.seed();
 assert.equal((await deliver(f)).status,503);const pending=await f.db.get('hmu_delivery:audit-synthetic',{type:'json'});assert.equal(pending.status,'pending_email');
 assert.equal((await deliver(f)).status,200);const done=await f.db.get('hmu_delivery:audit-synthetic',{type:'json'});assert.equal(done.correction_token,pending.correction_token);assert.equal(done.status,'delivered');
 assert.equal((await deliver(f)).body.alreadyDelivered,true);assert.equal(n.mail.length,2);
});
test('uncertain mail timeout stays blocked after restart and after the reconciliation deadline',async t=>{
 const n=network(t,{mail:()=>{throw new DOMException('Synthetic timeout','TimeoutError');}}),f=fixture();await f.seed();assert.equal((await deliver(f)).status,503);
 f.reboot();assert.equal((await deliver(f)).status,503);assert.equal(n.mail.length,1);
 const key='state:hmu_outbox:delivery:audit-synthetic';const state=await f.storage.get(key);const record=JSON.parse(state.value);record.started_at='2020-01-01T00:00:00Z';state.value=JSON.stringify(record);await f.storage.put(key,state);
 assert.equal((await deliver(f)).status,503);assert.equal(n.mail.length,1);assert.equal((await f.db.get('hmu_delivery:audit-synthetic',{type:'json'})).status,'pending_email');
});
test('a crash after email acceptance never causes an automatic duplicate',async t=>{
 const n=network(t),f=fixture();await f.seed();f.storage.failWhen=records=>Object.values(records).some(r=>{try{return JSON.parse(r.value).status==='sent';}catch{return false;}});
 assert.equal((await deliver(f)).status,503);f.reboot();assert.equal((await deliver(f)).status,503);assert.equal(n.mail.length,1);
});
test('concurrent deliveries serialize around network awaits',async t=>{
 let entered,release;const entering=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const n=network(t,{mail:async()=>{entered();await gate;return new Response(null,{status:202});}}),f=fixture();await f.seed();
 const first=deliver(f);await entering;const second=deliver(f);release();const rs=await Promise.all([first,second]);assert.deepEqual(rs.map(r=>r.status),[200,200]);assert.equal(n.mail.length,1);
});
test('two prefilled edits keep data and consume only after generation confirmation',async t=>{
 const n=network(t),f=fixture();await f.seed();await deliver(f);let url=formUrl(n.mail.at(-1));
 for(let i=1;i<=2;i++){
  const body=tally(url,'edit-'+i,{short_description:'Updated '+i,opening_hours_text:''});assert.equal((await call(f,'/tally-webhook',body)).status,200);
  assert.equal((await f.db.get('hmu_delivery:audit-synthetic',{type:'json'})).free_used,i-1);
  assert.equal((await call(f,'/tally-webhook',body)).body.idempotent,true);
  assert.equal((await notifyEdit(f,'edit-'+i)).status,200);assert.equal((await f.db.get('hmu_delivery:audit-synthetic',{type:'json'})).free_used,i);
  await notifyEdit(f,'edit-'+i);assert.equal((await f.db.get('hmu_delivery:audit-synthetic',{type:'json'})).free_used,i);
  assert.equal(n.dispatch.at(-1).client_payload.slug,'audit-synthetic');url=formUrl(n.mail.at(-1));
  if(i===1){assert.equal(new URL(url).searchParams.get('short_description'),'Updated 1');assert.equal(new URL(url).searchParams.get('opening_hours_text'),PREFILL.opening_hours_text);}else assert.equal(url,'');
 }
 assert.equal(n.dispatch.length,2);assert.equal(n.mail.length,3);
});
test('concurrent duplicate form events make one dispatch',async t=>{
 let entered,release;const entering=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const n=network(t,{dispatch:async()=>{entered();await gate;return new Response(null,{status:204});}}),f=fixture();await f.seed();await deliver(f);const body=tally(formUrl(n.mail[0]),'concurrent');
 const first=call(f,'/tally-webhook',body);await entering;const second=call(f,'/tally-webhook',body);release();const rs=await Promise.all([first,second]);assert.deepEqual(rs.map(r=>r.status),[200,200]);assert.equal(n.dispatch.length,1);
});
test('dispatch rejection is retryable without consuming quota; unknown acceptance is held',async t=>{
 let mode='reject';const n=network(t,{dispatch:()=>{if(mode==='unknown')throw new DOMException('Timeout','TimeoutError');return new Response(null,{status:mode==='reject'?401:204});}}),f=fixture();await f.seed();await deliver(f);const body=tally(formUrl(n.mail[0]),'dispatch-retry');
 assert.equal((await call(f,'/tally-webhook',body)).status,503);assert.equal((await f.db.get('hmu_delivery:audit-synthetic',{type:'json'})).free_used,0);
 mode='unknown';assert.equal((await call(f,'/tally-webhook',body)).status,503);f.reboot();mode='ok';assert.equal((await call(f,'/tally-webhook',body)).status,503);assert.equal(n.dispatch.length,2);
});
test('generation failure restores the same edit and ignores stale callbacks',async t=>{
 const n=network(t),f=fixture();await f.seed();await deliver(f);const body=tally(formUrl(n.mail[0]),'failed-generation');await call(f,'/tally-webhook',body);
 const failure={failure_stage:'generation',slug:'audit-synthetic',submission_id:'failed-generation',generation_attempt:1};assert.equal((await call(f,'/alert-generation-failed',failure)).status,200);
 assert.equal((await f.db.get('hmu_delivery:audit-synthetic',{type:'json'})).free_used,0);
 assert.equal((await notifyEdit(f,'failed-generation')).status,409);
 assert.equal((await call(f,'/tally-webhook',body)).status,200);
 assert.equal(n.dispatch.at(-1).client_payload.generation_attempt,2);await call(f,'/alert-generation-failed',failure);
 assert.equal((await notifyEdit(f,'failed-generation',1)).status,409);
 assert.equal((await notifyEdit(f,'failed-generation',2)).status,200);assert.equal((await f.db.get('hmu_delivery:audit-synthetic',{type:'json'})).free_used,1);
});
test('email failure after a published edit does not consume twice',async t=>{
 let reject=false;const n=network(t,{mail:()=>new Response(null,{status:reject?429:202})}),f=fixture();await f.seed();await deliver(f);await call(f,'/tally-webhook',tally(formUrl(n.mail[0]),'published'));
 reject=true;assert.equal((await notifyEdit(f,'published')).status,503);assert.equal((await f.db.get('hmu_delivery:audit-synthetic',{type:'json'})).free_used,1);
 await call(f,'/alert-generation-failed',{failure_stage:'generation',submission_id:'published',generation_attempt:1});reject=false;assert.equal((await notifyEdit(f,'published')).status,200);assert.equal((await f.db.get('hmu_delivery:audit-synthetic',{type:'json'})).free_used,1);
});
test('missing or oversized gift prefill never sends a misleading form or creates an order',async t=>{
 const n=network(t),f=fixture();for(const prefill of [undefined,{...PREFILL,services_text:'x'.repeat(6001)}]){
  const r=await call(f,'/gift-delivery',{slug:'audit-synthetic',email:'audit@example.invalid',lang:'es',prefill});assert.equal(r.status,422);
 }
 assert.equal(n.mail.length,0);assert.equal(await f.db.get('hmu_order:gift_audit-synthetic'),null);
 assert.throws(()=>buildPrefillQuery({text:'x'.repeat(6001)},6000,{strict:true}));
});
test('gift intake rejection reuses one order and sends once after recovery',async t=>{
 const n=network(t,{mail:i=>new Response(null,{status:i===1?429:202})}),f=fixture();const body={mode:'intake',email:'audit@example.invalid',lang:'es'};
 assert.equal((await call(f,'/gift-delivery',body)).status,503);const first=formUrl(n.mail[0]);assert.equal((await call(f,'/gift-delivery',body)).status,200);assert.equal(formUrl(n.mail[1]),first);assert.equal((await call(f,'/gift-delivery',body)).body.alreadySent,true);assert.equal(n.mail.length,2);
});
test('atomic delivery write failure cannot leave an emailed orphan token',async t=>{
 const n=network(t),f=fixture();await f.seed();f.storage.failWhen=records=>Object.keys(records).includes('state:hmu_delivery:audit-synthetic');assert.equal((await deliver(f)).status,500);assert.equal(n.mail.length,0);assert.equal(await f.db.get('hmu_delivery:audit-synthetic'),null);assert.equal((await deliver(f)).status,200);
});
test('storage expiry and tombstones never resurrect legacy values',async()=>{
 const f=fixture();await f.legacy.put('key','legacy');let now=1000;const db=new DurableStateStore(f.storage,f.legacy,()=>now);assert.equal(await db.get('key'),'legacy');await db.put('key','new',{expirationTtl:1});now=3000;assert.equal(await db.get('key'),null);await db.delete('key');assert.equal(await db.get('key'),null);
});
test('missing durable binding fails closed',async()=>{
 const f=fixture();delete f.env.HMU_STATE;assert.equal((await deliver(f)).status,503);
});

test('authoritative matching callback resolves an accepted-but-timed-out dispatch',async t=>{
 const n=network(t,{dispatch:()=>{throw new DOMException('Timeout','TimeoutError');}}),f=fixture();await f.seed();await deliver(f);
 assert.equal((await call(f,'/tally-webhook',tally(formUrl(n.mail[0]),'accepted-timeout'))).status,503);
 assert.equal((await notifyEdit(f,'accepted-timeout')).status,200);assert.equal((await f.db.get('hmu_delivery:audit-synthetic',{type:'json'})).free_used,1);
});
test('initial generation failure becomes retryable with a new correlated attempt',async t=>{
 const n=network(t),f=fixture();await f.seed();const order=await f.legacy.get('hmu_order:synthetic-order',{type:'json'});order.status='paid';delete order.submission_id;await f.legacy.put('hmu_order:synthetic-order',JSON.stringify(order));
 const url='https://tally.so/r/MeyDpk?order_id=synthetic-order&customer_email=audit%40example.invalid&'+new URLSearchParams(PREFILL);const body=tally(url,'initial-fails');
 assert.equal((await call(f,'/tally-webhook',body)).status,200);await call(f,'/alert-generation-failed',{failure_stage:'generation',submission_id:'initial-fails',generation_attempt:1});assert.equal((await f.db.get('hmu_order:synthetic-order',{type:'json'})).status,'paid');
 assert.equal((await call(f,'/tally-webhook',body)).status,200);assert.equal(n.dispatch.length,2);assert.equal(n.dispatch[1].client_payload.generation_attempt,2);
});
test('free and paid tokens cannot overlap edits of the same page',async t=>{
 const n=network(t),f=fixture();await f.seed();await deliver(f);const freeUrl=formUrl(n.mail[0]);const paidToken='synthetic-paid-token';await f.db.put('hmu_correction:'+paidToken,JSON.stringify({correction_token:paidToken,order_id:'synthetic-order',slug:'audit-synthetic',lang:'es',paid:true,used_at:null}));
 const paidUrl=new URL(freeUrl);paidUrl.searchParams.set('correction_token',paidToken);
 assert.equal((await call(f,'/tally-webhook',tally(freeUrl,'edit-A',{short_description:'A'}))).status,200);
 assert.equal((await call(f,'/tally-webhook',tally(paidUrl,'edit-B',{short_description:'B'}))).status,409);
 await call(f,'/alert-generation-failed',{failure_stage:'generation',submission_id:'edit-A',generation_attempt:1});
 assert.equal((await call(f,'/tally-webhook',tally(paidUrl,'edit-B',{short_description:'B'}))).status,200);
 await call(f,'/alert-generation-failed',{failure_stage:'generation',submission_id:'edit-A',generation_attempt:1});
 assert.equal((await notifyEdit(f,'edit-B')).status,200);assert.equal((await f.db.get('hmu_order:synthetic-order',{type:'json'})).submission_id,'edit-B');assert.equal(new URL(formUrl(n.mail.at(-1))).searchParams.get('short_description'),'B');
 assert.equal((await f.db.get('hmu_delivery:audit-synthetic',{type:'json'})).free_used,0);
});
test('explicit delete marker is not shown as the next default answer',()=>{
 const q=buildPrefillQuery({business_name:'Example',policies_text:'[BORRAR]'},6000,{strict:true});assert.equal(new URLSearchParams(q).has('policies_text'),false);
});

test('orphan free tokens cannot publish a third free edit',async t=>{
 const n=network(t),f=fixture();await f.seed();await deliver(f);const url=formUrl(n.mail[0]);const d=await f.db.get('hmu_delivery:audit-synthetic',{type:'json'});d.free_used=2;await f.db.put('hmu_delivery:audit-synthetic',JSON.stringify(d));
 assert.equal((await call(f,'/tally-webhook',tally(url,'orphan'))).status,403);assert.equal((await call(f,'/correct',{token:new URL(url).searchParams.get('correction_token'),changes:'Change public description'})).status,403);assert.equal(n.dispatch.length,0);
});
test('form credential tampering and missing signature cannot mutate another page',async t=>{
 const n=network(t),f=fixture();await f.seed();await deliver(f);const url=new URL(formUrl(n.mail[0]));url.searchParams.set('client_slug','someone-else');assert.equal((await call(f,'/tally-webhook',tally(url,'tampered'))).status,403);
 url.searchParams.set('client_slug','audit-synthetic');url.searchParams.delete('correction_token');assert.equal((await call(f,'/tally-webhook',tally(url,'missing-token'))).status,403);assert.equal(n.dispatch.length,0);
 const {default:worker}=await import('../worker.js');const response=await worker.fetch(new Request('https://audit.invalid/tally-webhook',{method:'POST',body:'{}'}),f.env,{});assert.equal(response.status,401);
});
test('all explicit deletion syntaxes have identical form projection',async()=>{
 const {isPrefillDeleteToken}=await import('../product-config.mjs');for(const value of ['BORRAR','[ BORRAR ]','(BORRAR)','{delete}','bórralo','-','N/A']){assert.equal(isPrefillDeleteToken(value),true,value);assert.equal(new URLSearchParams(buildPrefillQuery({policies_text:value},6000,{strict:true})).has('policies_text'),false);}
});
test('expiry cleanup removes private payloads and obsolete limiter rows',async()=>{
 const f=fixture();let now=1000;const db=new DurableStateStore(f.storage,f.legacy,()=>now);await f.legacy.put('hmu_submission:old','legacy');await db.put('hmu_submission:old','private payload',{expirationTtl:1});await db.put('hmu_rl:tally:ip:0','counter',{expirationTtl:1});now=3000;await db.cleanupExpired();assert.deepEqual(await f.storage.get('state:hmu_submission:old'),{deleted:true});assert.equal(await db.get('hmu_submission:old'),null);assert.equal(await f.storage.get('state:hmu_rl:tally:ip:0'),undefined);assert.equal((await f.storage.list({prefix:'expires:'})).size,0);
});
test('oversized and stalled request bodies are rejected before entering the state queue',async()=>{
 const {boundedRequest}=await import('../durable-state.mjs');await assert.rejects(()=>boundedRequest(new Request('https://audit.invalid',{method:'POST',body:'12345'}),{maxBytes:4}),/request_body_too_large/);
 const stream=new ReadableStream({start(){}});await assert.rejects(()=>boundedRequest(new Request('https://audit.invalid',{method:'POST',body:stream,duplex:'half'}),{timeoutMs:5}),/request_body_timeout/);
});

test('paid intake mail retries without resetting a delivered order',async t=>{
 const n=network(t,{mail:i=>new Response(null,{status:i===1?429:202})}),f=fixture();
 const event={type:'checkout.session.completed',data:{object:{id:'synthetic-session',payment_intent:'synthetic-paid-order',payment_link:f.env.STRIPE_PAYMENT_LINK_ID.split(',')[0],customer_email:'audit@example.invalid',currency:'mxn',amount_total:79900}}};
 assert.equal((await call(f,'/stripe/webhook',event)).status,500);let order=await f.db.get('hmu_order:synthetic-paid-order',{type:'json'});order.status='delivered';await f.db.put('hmu_order:synthetic-paid-order',JSON.stringify(order));assert.equal((await call(f,'/stripe/webhook',event)).status,200);assert.equal((await f.db.get('hmu_order:synthetic-paid-order',{type:'json'})).status,'delivered');assert.equal(n.mail.length,2);await call(f,'/stripe/webhook',event);assert.equal(n.mail.length,2);
});
test('additional paid edit retains one token and sends a prefilled questionnaire only to its owner',async t=>{
 let reject=false;const n=network(t,{mail:()=>new Response(null,{status:reject?429:202})}),f=fixture();await f.seed();await deliver(f);reject=true;
 const event={type:'checkout.session.completed',data:{object:{id:'extra-session',payment_intent:'extra-paid-order',customer_email:'someone-else@example.invalid',currency:'mxn',metadata:{hmu_correction:'1',slug:'audit-synthetic'}}}};
 assert.equal((await call(f,'/stripe/webhook',event)).status,500);const first=formUrl(n.mail.at(-1));reject=false;assert.equal((await call(f,'/stripe/webhook',event)).status,200);assert.equal(formUrl(n.mail.at(-1)),first);assert.equal(n.mail.at(-1).personalizations[0].to[0].email,'audit@example.invalid');assert.equal(new URL(first).searchParams.get('short_description'),PREFILL.short_description);
});
test('operator reconciliation requires authentication and a verified reference; never sends by itself',async t=>{
 let uncertain=true;const n=network(t,{mail:()=>{if(uncertain)throw new DOMException('Timeout','TimeoutError');return new Response(null,{status:202});}}),f=fixture();await f.seed();await deliver(f);
 const attempt=await call(f,'/reconcile-operation',{kind:'email',action:'inspect',outbox_key:'delivery:audit-synthetic'});
 const body={attempt_id:attempt.body.attempt_id,kind:'email',outcome:'accepted',outbox_key:'delivery:audit-synthetic',reason:'Verified provider acceptance in message activity',provider_reference:'synthetic-message-reference'};
 const {default:worker}=await import('../worker.js');assert.equal((await worker.fetch(new Request('https://audit.invalid/reconcile-operation',{method:'POST',body:JSON.stringify(body)}),f.env,{})).status,401);
 assert.equal((await call(f,'/reconcile-operation',{...body,provider_reference:''})).status,400);
 assert.equal((await call(f,'/reconcile-operation',body)).status,200);assert.equal(n.mail.length,1);uncertain=false;assert.equal((await deliver(f)).status,200);assert.equal(n.mail.length,1);
});
test('verified dispatch rejection releases an uncertain reservation and permits a bounded retry',async t=>{
 let uncertain=true;const n=network(t,{dispatch:()=>{if(uncertain)throw new DOMException('Timeout','TimeoutError');return new Response(null,{status:204});}}),f=fixture();await f.seed();await deliver(f);const body=tally(formUrl(n.mail[0]),'reconcile-dispatch');assert.equal((await call(f,'/tally-webhook',body)).status,503);
 const decision={kind:'generation',record_kind:'submission',id:'reconcile-dispatch',generation_attempt:1,outcome:'rejected',reason:'Provider confirmed the dispatch was not accepted',provider_reference:'synthetic-confirmation'};
 assert.equal((await call(f,'/reconcile-operation',{...decision,generation_attempt:9})).status,409);assert.equal((await call(f,'/reconcile-operation',decision)).status,200);assert.equal(n.dispatch.length,1);uncertain=false;assert.equal((await call(f,'/tally-webhook',body)).status,200);assert.equal((await notifyEdit(f,'reconcile-dispatch',2)).status,200);
 assert.equal((await call(f,'/reconcile-operation',{...decision,generation_attempt:2})).status,409);assert.equal((await f.db.get('hmu_delivery:audit-synthetic',{type:'json'})).free_used,1);
});

test('an old email reconciliation cannot release a newer uncertain attempt',async t=>{
 const n=network(t,{mail:()=>new Response(null,{status:500})}),f=fixture();await f.seed();await deliver(f);
 const inspect=()=>call(f,'/reconcile-operation',{kind:'email',action:'inspect',outbox_key:'delivery:audit-synthetic'});
 const first=(await inspect()).body.attempt_id;
 const decision={kind:'email',outbox_key:'delivery:audit-synthetic',attempt_id:first,outcome:'rejected',reason:'Provider confirmed this exact attempt was not accepted',provider_reference:'synthetic-provider-record-A'};
 assert.equal((await call(f,'/reconcile-operation',decision)).status,200);await deliver(f);const second=(await inspect()).body.attempt_id;assert.notEqual(second,first);
 assert.equal((await call(f,'/reconcile-operation',decision)).status,409);await deliver(f);assert.equal(n.mail.length,2);assert.equal((await inspect()).body.attempt_id,second);
});
test('generation reconciliation cannot modify an orphan or newer page reservation',async t=>{
 const n=network(t,{dispatch:()=>{throw new Error('Synthetic network uncertainty');}}),f=fixture();await f.seed();await deliver(f);await call(f,'/tally-webhook',tally(formUrl(n.mail[0]),'orphan-operation'));
 const order=await f.db.get('hmu_order:synthetic-order',{type:'json'});order.active_generation={kind:'submission',id:'newer',attempt:2};await f.db.put('hmu_order:synthetic-order',JSON.stringify(order));
 const decision={kind:'generation',record_kind:'submission',id:'orphan-operation',generation_attempt:1,outcome:'accepted',reason:'Synthetic old provider result for regression test',provider_reference:'synthetic-old-run'};
 assert.equal((await call(f,'/reconcile-operation',decision)).status,409);assert.equal((await call(f,'/reconcile-operation',{...decision,outcome:'rejected'})).status,409);assert.deepEqual((await f.db.get('hmu_order:synthetic-order',{type:'json'})).active_generation,order.active_generation);
});

test('notify commit failures after Pages success retain the claim and recover without a free extra edit',async t=>{
 const n=network(t),f=fixture();await f.seed();await deliver(f);await call(f,'/tally-webhook',tally(formUrl(n.mail[0]),'published-storage-failure',{short_description:'Published version'}));
 for(let i=0;i<4;i++){
  f.storage.failWhen=records=>Object.entries(records).some(([key,r])=>key==='state:hmu_delivery:audit-synthetic'&&JSON.parse(r.value).free_used===1);
  assert.equal((await notifyEdit(f,'published-storage-failure')).status,500);
 }
 const alert={submission_id:'published-storage-failure',generation_attempt:1,failure_stage:'notification',publication_confirmed:true};assert.equal((await call(f,'/alert-generation-failed',alert)).status,200);
 assert.equal((await f.db.get('hmu_order:synthetic-order',{type:'json'})).active_generation.id,'published-storage-failure');assert.equal((await f.db.get('hmu_delivery:audit-synthetic',{type:'json'})).free_used,0);
 assert.equal((await call(f,'/reconcile-operation',{kind:'generation',record_kind:'submission',id:'published-storage-failure',generation_attempt:1,outcome:'rejected',reason:'A mistaken old rejection must be blocked',provider_reference:'synthetic-old-evidence'})).status,409);
 assert.equal((await notifyEdit(f,'published-storage-failure')).status,200);assert.equal((await f.db.get('hmu_delivery:audit-synthetic',{type:'json'})).free_used,1);assert.equal(n.dispatch.length,1);
});

test('rejected generation and its operator evidence commit atomically',async t=>{
 const n=network(t,{dispatch:()=>{throw new Error('Synthetic uncertainty');}}),f=fixture();await f.seed();await deliver(f);await call(f,'/tally-webhook',tally(formUrl(n.mail[0]),'atomic-reconcile'));
 const decision={kind:'generation',record_kind:'submission',id:'atomic-reconcile',generation_attempt:1,outcome:'rejected',reason:'Provider confirmed no accepted dispatch for this attempt',provider_reference:'synthetic-provider-reference'};
 f.storage.failWhen=records=>Object.values(records).some(r=>{try{return JSON.parse(r.value).reconciliation?.operation==='submission:atomic-reconcile';}catch{return false;}});
 assert.equal((await call(f,'/reconcile-operation',decision)).status,500);assert.equal((await f.db.get('hmu_order:synthetic-order',{type:'json'})).active_generation.id,'atomic-reconcile');assert.equal((await f.db.get('hmu_submission:atomic-reconcile',{type:'json'})).status,'dispatching');
 assert.equal((await call(f,'/reconcile-operation',decision)).status,200);const saved=await f.db.get('hmu_submission:atomic-reconcile',{type:'json'});assert.equal(saved.status,'failed_generation');assert.equal(saved.reconciliation.provider_reference,decision.provider_reference);
});

test('operator alerts distinguish published notification failures from uncertain deployment',async t=>{
 const n=network(t),f=fixture();f.env.ALERT_EMAIL='admin@example.invalid';f.reboot();
 await call(f,'/alert-generation-failed',{submission_id:'copy-published',generation_attempt:1,failure_stage:'notification',publication_confirmed:true});const published=mailText(n.mail.at(-1));assert.match(published,/reintentar \/notify/);assert.doesNotMatch(published,/su página no se generó|re-disparar la generación/);
 await call(f,'/alert-generation-failed',{submission_id:'copy-uncertain',generation_attempt:1,failure_stage:'deployment',publication_confirmed:false});assert.match(mailText(n.mail.at(-1)),/Conciliar el resultado antes/);
});
