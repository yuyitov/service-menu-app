import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import worker, { HmuState } from '../worker.js';
import { DurableStateStore } from '../durable-state.mjs';
export class MemoryKV {
  constructor(){this.values=new Map();}
  async get(k,o={}){const v=this.values.get(k);return v==null?null:o.type==='json'?JSON.parse(v):v;}
  async put(k,v){this.values.set(k,String(v));}
  async delete(k){this.values.delete(k);}
}
export class AtomicStorage {
  constructor(){this.values=new Map();this.failWhen=null;}
  async get(k){return structuredClone(this.values.get(k));}
  async getAlarm(){return this.alarm ?? null;}
  async setAlarm(t){this.alarm=t;}
  async deleteAlarm(){this.alarm=null;}
  async delete(k){this.values.delete(k);}
  async list({prefix='',end,limit=1000}={}){return new Map([...this.values.entries()].filter(([k])=>k.startsWith(prefix)&&(!end||k<end)).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit));}
  async put(key,value){
    const entries=typeof key==='string'?{[key]:value}:key;
    if(this.failWhen?.(entries)){this.failWhen=null;throw Error('Synthetic atomic storage failure');}
    const next=new Map(this.values);
    for(const[k,v]of Object.entries(entries))next.set(k,structuredClone(v));
    this.values=next;
  }
}
export const PREFILL={business_name:'Synthetic business',short_description:'Original description',whatsapp:'+15555550100',services_text:'Consultation - $10',opening_hours_text:'Monday 10:00-17:00',pick_your_style:'Charcoal Clean — clean and modern',default_language:'Español primero'};
export function fixture(){
  const toml=readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8');
  const vars=Object.fromEntries([...toml.matchAll(/^([A-Z_]+)\s*=\s*"([^"]*)"/gm)].map(m=>[m[1],m[2]]));
  const legacy=new MemoryKV(),storage=new AtomicStorage();
  const env={...vars,SERVICE_MENU_KV:legacy,NOTIFY_SECRET:'offline-fixture',STRIPE_WEBHOOK_SECRET:'offline-fixture',TALLY_SIGNING_SECRET_ES:'offline-fixture',SENDGRID_API_KEY:'offline-fixture',GITHUB_TOKEN:'offline-fixture',ALERT_EMAIL:'',REPLY_TO_EMAIL:''};
  let instance=new HmuState({storage},env);
  env.HMU_STATE={idFromName:n=>n,get:()=>({fetch:r=>instance.fetch(r)})};
  const db=new DurableStateStore(storage,legacy);
  return {env,legacy,storage,db,reboot(){instance=new HmuState({storage},env);},async seed(prefill=PREFILL){
    await legacy.put('hmu_order:synthetic-order',JSON.stringify({order_id:'synthetic-order',customer_email:'audit@example.invalid',currency:'mxn',status:'generating',submission_id:'synthetic-initial',slug:'audit-synthetic'}));
    await legacy.put('hmu_submission:synthetic-initial',JSON.stringify({submission_id:'synthetic-initial',order_id:'synthetic-order',slug:'audit-synthetic',prefill}));
  }};
}
export function network(t,{mail,dispatch}={}){
  const calls={mail:[],dispatch:[]};
  t.mock.method(globalThis,'fetch',async(url,init={})=>{
    if(String(url)==='https://api.sendgrid.com/v3/mail/send'){
      calls.mail.push(JSON.parse(init.body));
      return mail?mail(calls.mail.length,init):new Response(null,{status:202});
    }
    if(String(url)==='https://api.github.com/repos/yuyitov/service-menu-app/dispatches'){
      calls.dispatch.push(JSON.parse(init.body));
      return dispatch?dispatch(calls.dispatch.length,init):new Response(null,{status:204});
    }
    throw Error('Unexpected external route blocked in offline test');
  });
  return calls;
}
export async function call(f,path,body){
  const raw=JSON.stringify(body);
  const headers={'Content-Type':'application/json',Authorization:'Bearer offline-fixture','cf-connecting-ip':'offline-'+Math.random()};
  if(path==='/tally-webhook')headers['tally-signature']=createHmac('sha256','offline-fixture').update(raw).digest('base64');
  if(path==='/stripe/webhook'){const ts=String(Math.floor(Date.now()/1000));headers['stripe-signature']='t='+ts+',v1='+createHmac('sha256','offline-fixture').update(ts+'.'+raw).digest('hex');}
  const response=await worker.fetch(new Request('https://audit.invalid'+path,{method:'POST',headers,body:raw}),f.env,{});
  return {status:response.status,body:await response.json()};
}
export const deliver=f=>call(f,'/notify',{slug:'audit-synthetic',submission_id:'synthetic-initial'});
export const mailText=m=>m.content.find(c=>c.type==='text/plain').value;
export const formUrl=m=>(mailText(m).match(/https:\/\/tally\.so\/\S+/g)||[])[0]||'';
export function tally(url,id,patch={}){
  const u=new URL(url),fields=[];
  for(const[k,v]of u.searchParams){
    const hidden=['order_id','customer_email','client_slug','correction_token'].includes(k);
    fields.push({name:k,label:k,type:hidden?'HIDDEN_FIELDS':'INPUT_TEXT',value:Object.hasOwn(patch,k)?patch[k]:v});
  }
  return {eventType:'FORM_RESPONSE',data:{responseId:id,formId:'MeyDpk',fields}};
}
export const notifyEdit=(f,id,attempt=1)=>call(f,'/notify',{slug:'audit-synthetic',submission_id:id,generation_attempt:attempt});
