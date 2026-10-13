const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),{webcrypto}=require('crypto');
const {transformSync}=require('esbuild');
const original=fs.readFileSync('supabase/functions/push-dispatch/index.ts','utf8');
const compiled=transformSync(original.replace(/^import .*;\s*$/gm,'')+'\ngetAccessToken=async()=>({token:"fake",projectId:"fake"});\nbuildMessage=async(job)=>({title:"Test",body:"Test",data:{event_type:job.event_type}});\nexport {processQueue};',{loader:'ts',format:'cjs'}).code;
let jobs,logs,sends,failOnce;
const devices=[{id:'d1',user_id:'u1',token:'t1',group_id:'g',enabled:true},{id:'d2',user_id:'u2',token:'t2',group_id:'g',enabled:true}];
function reset(){jobs=[{id:'j1',group_id:'g',target_user_id:null,event_type:'due_0',created_at:'2026-10-13',attempts:0,sent_at:null}];logs=[];sends=[];failOnce=new Set();}
function chain(table){let operation='select',values,filters=[];const builder={select(){return builder},update(v){operation='update';values=v;return builder},upsert(v){operation='upsert';values=v;return builder},eq(k,v){filters.push([k,v]);return builder},then(resolve,reject){return Promise.resolve().then(()=>{
 const rows=table==='push_jobs'?jobs:table==='push_devices'?devices:logs;
 const matched=rows.filter(r=>filters.every(([k,v])=>r[k]===v));
 if(operation==='update'){matched.forEach(r=>Object.assign(r,values));return {error:null};}
 if(operation==='upsert'){const row=logs.find(r=>r.job_id===values.job_id&&r.device_id===values.device_id);if(row)Object.assign(row,values);else logs.push({...values});return {error:null};}
 return {data:matched.map(r=>({...r})),error:null};
 }).then(resolve,reject);}};return builder;}
const db={from:chain,rpc:async(name,{p_worker,p_limit})=>{assert.equal(name,'claim_push_jobs');const claimed=jobs.filter(j=>!j.sent_at&&j.attempts<10&&!j.claim_token).slice(0,p_limit);claimed.forEach(j=>j.claim_token=p_worker);return {data:claimed.map(j=>({...j})),error:null};}};
const ctx={exports:{},module:{exports:{}},createClient:()=>db,crypto:webcrypto,Deno:{env:{get:()=>undefined},serve:()=>{}},console,Date,setTimeout,
 fetch:async(url,args)=>{const message=JSON.parse(args.body).message;sends.push(message);await new Promise(r=>setTimeout(r,5));const failed=failOnce.delete(message.token);return {ok:!failed,status:failed?503:200,text:async()=>failed?'temporary failure':'{}'};}};
ctx.module.exports=ctx.exports;vm.createContext(ctx);vm.runInContext(compiled,ctx);const processQueue=ctx.module.exports.processQueue;
(async()=>{
 reset();await Promise.all([processQueue(),processQueue(),processQueue(),processQueue(),processQueue()]);assert.equal(sends.length,2);assert.equal(logs.length,2);assert.ok(jobs[0].sent_at);assert.ok(sends.every(m=>m.android.notification.tag==='j1'));
 reset();failOnce.add('t1');await processQueue();assert.equal(jobs[0].attempts,1);assert.equal(jobs[0].sent_at,null);await processQueue();assert.equal(sends.filter(m=>m.token==='t2').length,1);assert.equal(sends.filter(m=>m.token==='t1').length,2);assert.ok(jobs[0].sent_at);
 reset();jobs[0].target_user_id='u1';await processQueue();assert.equal(sends.length,1);assert.equal(sends[0].token,'t1');
 console.log('PASS: five simultaneous workers send once per device, partial failure retries only failed device, stable Android tag and private recipient');
})().catch(e=>{console.error(e);process.exitCode=1});
