import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,network,call,deliver,formUrl} from './reliability-harness.mjs';

test('legacy text correction reserves first, consumes only after publication, rejects reuse',async t=>{
 const n=network(t),f=fixture();await f.seed();await deliver(f);
 const token=new URL(formUrl(n.mail[0])).searchParams.get('correction_token');
 const body={token,changes:'Cambiar el teléfono público a +52 322 123 4567.'};
 const r=await call(f,'/correct',body);assert.equal(r.status,200);
 const pending=await f.db.get('hmu_correction:'+token,{type:'json'});assert.equal(pending.used_at,null);assert.ok(pending.pending_correction);
 assert.equal((await f.db.get('hmu_delivery:audit-synthetic',{type:'json'})).free_used,0);
 assert.equal((await call(f,'/correct',body)).body.idempotent,true);assert.equal(n.dispatch.length,1);
 const event=n.dispatch[0].client_payload;assert.equal(event.is_correction,true);assert.equal(event.slug,'audit-synthetic');assert.equal('token' in event,false);assert.equal('order_id' in event,false);
 assert.equal((await call(f,'/notify',{slug:'audit-synthetic',correction_id:r.body.correction_id,correction_status:'applied',generation_attempt:1})).status,200);
 assert.ok((await f.db.get('hmu_correction:'+token,{type:'json'})).used_at);const d=await f.db.get('hmu_delivery:audit-synthetic',{type:'json'});assert.equal(d.free_used,1);assert.notEqual(d.correction_token,token);
 assert.equal((await call(f,'/correct',body)).status,403);assert.equal(n.dispatch.length,1);
});
