// Optional real workerd/SQLite integration. Every provider is intercepted locally.
// See worker/RELEASE_READINESS.md for the pinned temporary dependencies.
import {createRequire} from 'node:module';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
const deps=process.env.HMU_RUNTIME_DEPS_DIR;
if(!deps)throw Error('Set HMU_RUNTIME_DEPS_DIR to the directory containing pinned Miniflare/esbuild dependencies');
const require=createRequire(join(resolve(deps),'package.json'));
const {Miniflare}=require('miniflare');
const {build}=require('esbuild');
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const output=resolve(process.env.HMU_RUNTIME_OUTPUT || mkdtempSync(join(tmpdir(),'hmu-runtime-')));
mkdirSync(output,{recursive:true});
const toml=readFileSync(root+'/worker/wrangler.toml','utf8');
assert.match(toml,/class_name = "HmuState"/);assert.match(toml,/new_sqlite_classes = \["HmuState"\]/);
const vars=Object.fromEntries([...toml.matchAll(/^([A-Z_]+)\s*=\s*"([^"]*)"/gm)].map(m=>[m[1],m[2]]));
const entry=(toml.match(/^main\s*=\s*"([^"]+)"/m)||[])[1];
assert.equal(entry,'worker-entry.mjs');
const compiled=await build({entryPoints:[root+'/worker/'+entry],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',logLevel:'silent'});
writeFileSync(join(output,'worker-bundled.mjs'),compiled.outputFiles[0].text);
const mail=[],dispatches=[],checks=[];let rejectMail=false,holdDispatch=false;
const options={name:'hmu-runtime-proof',script:compiled.outputFiles[0].text,modules:true,compatibilityDate:'2024-01-01',host:'127.0.0.1',port:0,
 bindings:{...vars,NOTIFY_SECRET:'local-runtime-fixture',TALLY_SIGNING_SECRET_ES:'local-runtime-fixture',STRIPE_WEBHOOK_SECRET:'local-runtime-fixture',SENDGRID_API_KEY:'local-runtime-fixture',GITHUB_TOKEN:'local-runtime-fixture',ALERT_EMAIL:'',REPLY_TO_EMAIL:''},
 kvNamespaces:['SERVICE_MENU_KV'],kvPersist:join(output,'state/kv'),durableObjects:{HMU_STATE:{className:'HmuState',useSQLite:true}},durableObjectsPersist:join(output,'state/do'),
 outboundService:async req=>{const u=new URL(req.url);if(u.hostname==='api.sendgrid.com'&&u.pathname==='/v3/mail/send'){mail.push(await req.json());return new Response(null,{status:rejectMail?429:202});}if(u.hostname==='api.github.com'&&u.pathname==='/repos/yuyitov/service-menu-app/dispatches'){dispatches.push(await req.json());if(holdDispatch)await new Promise(r=>setTimeout(r,20));return new Response(null,{status:204});}throw Error('Blocked unexpected external request');}
};
let mf;
async function call(path,body){let init={};if(body!==undefined){const raw=JSON.stringify(body);const h={'content-type':'application/json',authorization:'Bearer local-runtime-fixture','cf-connecting-ip':'offline-'+Math.random()};if(path==='/tally-webhook')h['tally-signature']=createHmac('sha256','local-runtime-fixture').update(raw).digest('base64');if(path==='/stripe/webhook'){const ts=String(Math.floor(Date.now()/1000));h['stripe-signature']='t='+ts+',v1='+createHmac('sha256','local-runtime-fixture').update(ts+'.'+raw).digest('hex');}init={method:'POST',headers:h,body:raw};}const r=await mf.dispatchFetch('https://runtime.invalid'+path,init);return{status:r.status,body:await r.json()};}
const text=m=>m.content.find(x=>x.type==='text/plain').value;
const form=m=>(text(m).match(/https:\/\/tally\.so\/\S+/g)||[])[0]||'';
const fields={business_name:'Runtime business',short_description:'Original runtime profile',whatsapp:'+15555550100',services_text:'Consultation - $10',pick_your_style:'Charcoal Clean — clean and modern',default_language:'Español primero'};
function tally(url,id,patch={}){const u=new URL(url);for(const[k,v]of Object.entries(patch))u.searchParams.set(k,v);return{eventType:'FORM_RESPONSE',data:{responseId:id,formId:'MeyDpk',fields:[...u.searchParams].map(([name,value])=>({name,label:name,type:['order_id','customer_email','client_slug','correction_token'].includes(name)?'HIDDEN_FIELDS':'INPUT_TEXT',value}))}};}
const note=(name,details={})=>{checks.push({name,passed:true,...details});console.log('PASS',name,JSON.stringify(details));};
try{
 mf=new Miniflare(options);await mf.ready;assert.equal((await call('/health')).status,200);note('real workerd startup with SQLite HmuState binding');
 const gift={slug:'runtime-gift',email:'runtime@example.invalid',lang:'es',prefill:fields};assert.equal((await call('/gift-delivery',gift)).status,200);const originalGiftUrl=form(mail.at(-1));assert.ok(originalGiftUrl);const count=mail.length;
 await mf.dispose();mf=new Miniflare(options);await mf.ready;const duplicate=await call('/gift-delivery',gift);assert.equal(duplicate.body.alreadyDelivered,true);assert.equal(mail.length,count);note('SQLite persistence across complete workerd restart');
 const body=tally(originalGiftUrl,'runtime-gift-edit-one',{short_description:'Updated runtime profile'});holdDispatch=true;const duplicates=await Promise.all([call('/tally-webhook',body),call('/tally-webhook',body)]);holdDispatch=false;assert.deepEqual(duplicates.map(r=>r.status),[200,200]);assert.equal(dispatches.length,1);note('concurrent duplicate Tally event dispatches once');
 assert.equal((await call('/notify',{slug:'runtime-gift',submission_id:'runtime-gift-edit-one',generation_attempt:1})).status,200);const secondUrl=form(mail.at(-1));assert.equal(new URL(secondUrl).searchParams.get('short_description'),'Updated runtime profile');
 assert.equal((await call('/tally-webhook',tally(secondUrl,'runtime-gift-edit-two',{short_description:'Second runtime profile'}))).status,200);assert.equal((await call('/notify',{slug:'runtime-gift',submission_id:'runtime-gift-edit-two',generation_attempt:1})).status,200);assert.equal(form(mail.at(-1)),'');assert.equal((await call('/tally-webhook',tally(secondUrl,'runtime-gift-third'))).status,403);note('gift two-edit lifecycle and no third free change',{dispatches:dispatches.length});
 rejectMail=true;const retryGift={...gift,slug:'runtime-mail-retry'};assert.equal((await call('/gift-delivery',retryGift)).status,503);const failedUrl=form(mail.at(-1));rejectMail=false;assert.equal((await call('/gift-delivery',retryGift)).status,200);assert.equal(form(mail.at(-1)),failedUrl);note('explicit rejected email retries stable token on SQLite');
 const event={type:'checkout.session.completed',data:{object:{id:'runtime-checkout',payment_intent:'runtime-paid-order',payment_link:vars.STRIPE_PAYMENT_LINK_ID.split(',')[0],customer_email:'runtime-paid@example.invalid',currency:'mxn',amount_total:79900}}};assert.equal((await call('/stripe/webhook',event)).status,200);const initial=tally(form(mail.at(-1)),'runtime-paid-initial',fields);const intake=await call('/tally-webhook',initial);assert.equal(intake.status,200);const paidSlug=intake.body.slug;assert.equal((await call('/notify',{slug:paidSlug,submission_id:'runtime-paid-initial',generation_attempt:1})).status,200);assert.ok(form(mail.at(-1)));note('signed synthetic paid intake and delivery use real runtime',{slugPreserved:true});
 const before=dispatches.length;const edit=tally(form(mail.at(-1)),'runtime-paid-failed',{short_description:'Retry profile'});assert.equal((await call('/tally-webhook',edit)).status,200);assert.equal((await call('/alert-generation-failed',{slug:paidSlug,submission_id:'runtime-paid-failed',generation_attempt:1,failure_stage:'generation'})).status,200);assert.equal((await call('/tally-webhook',edit)).status,200);assert.equal(dispatches.at(-1).client_payload.generation_attempt,2);assert.equal((await call('/notify',{slug:paidSlug,submission_id:'runtime-paid-failed',generation_attempt:1})).status,409);assert.equal((await call('/notify',{slug:paidSlug,submission_id:'runtime-paid-failed',generation_attempt:2})).status,200);assert.equal(dispatches.length,before+2);note('generation failure releases reservation and stale callback rejected');
 await mf.dispose();mf=null;writeFileSync(join(output,'results.json'),JSON.stringify({runtime:'miniflare 4.20260730.0 / workerd',compatibilityDate:'2024-01-01',sqlite:true,providers:'All outbound requests intercepted locally; no real email, GitHub dispatch or payment',checks},null,2));console.log('ALL',checks.length,'RUNTIME CHECKS PASSED');
}catch(error){console.error(error);writeFileSync(join(output,'results.json'),JSON.stringify({passed:false,error:String(error),checks},null,2));process.exitCode=1;}finally{if(mf)await mf.dispose().catch(()=>{});}
