'use strict';
const fs=require('node:fs'),path=require('node:path');
const fail=code=>Object.assign(Error('Company application authorization is unavailable'),{code,status:code==='ACCESS_DENIED'?403:401});
function create({core,session,fetch,now=Date.now,onRevoke=()=>{}}){
 const origin=new URL(session.origin);
 if(origin.protocol!=='https:'&&!(session.allowHttp&&['127.0.0.1','localhost','[::1]'].includes(origin.hostname)))throw fail('AUTH_REQUIRED');
 let validUntil=0,nextCheck=0,pending,stopped=false,timer;
 let controller=new AbortController();
 const revoke=code=>{validUntil=0;nextCheck=now()+10000;controller.abort(fail(code));onRevoke(code);throw fail(code);};
 const local=()=>{
  const file=path.join(core,'managed-login.json');
  if(!fs.existsSync(file)||fs.lstatSync(file).isSymbolicLink())return revoke('AUTH_REQUIRED');
  const meta=JSON.parse(fs.readFileSync(file,'utf8'));
  if(meta.contract!==2||!meta.active||meta.subject!==session.subject||meta.credentialFile!==session.credentialFile)return revoke('AUTH_REQUIRED');
 };
 async function check(){
  if(stopped)throw fail('AUTH_REQUIRED');local();
  if(now()<nextCheck&&now()<validUntil)return controller.signal;
  if(!pending)pending=(async()=>{
   const started=now();
   try{
    const response=await fetch(origin.origin+'/api/codex-own/session',{redirect:'error',headers:{authorization:'Bearer '+session.token},signal:AbortSignal.timeout(10000)});
    if(response.status===401||response.status===403)return revoke(response.status===403?'ACCESS_DENIED':'AUTH_REQUIRED');
    if(!response.ok)throw Error('Unavailable');
    const text=await response.text();if(Buffer.byteLength(text)>16384)throw Error('Invalid');
    const result=JSON.parse(text),data=result.data,lease=data?.authorization;
    if(result.ok!==true||data?.authenticated!==true||data.subject!==session.subject||lease?.validForSeconds!==300||lease.refreshAfterSeconds!==120)throw Error('Invalid');
    if(data.configVersion!==session.configVersion)return revoke('CONFIGURATION_CHANGED');
    local();validUntil=Math.min(started+300000,Date.parse(session.expiresAt));nextCheck=started+120000;if(controller.signal.aborted)controller=new AbortController();
   }catch(error){if(controller.signal.aborted||!Number.isFinite(validUntil)||now()>=validUntil)return revoke(['ACCESS_DENIED','CONFIGURATION_CHANGED'].includes(error.code)?error.code:'AUTH_REQUIRED');nextCheck=Math.min(now()+10000,validUntil);}
  })().finally(()=>{pending=null;});
  await pending;if(now()>=validUntil)return revoke('AUTH_REQUIRED');return controller.signal;
 }
 const schedule=()=>{if(stopped)return;const deadline=validUntil>now()?Math.min(nextCheck,validUntil):nextCheck||now()+10000;timer=setTimeout(()=>{check().catch(()=>{}).finally(schedule);},Math.max(100,deadline-now()));timer.unref();};
 let localTimer;
 return {check,start:async()=>{try{await check();}finally{schedule();localTimer=setInterval(()=>{try{local();}catch{}},1000);localTimer.unref();}},close:()=>{stopped=true;clearTimeout(timer);clearInterval(localTimer);controller.abort();},get signal(){return controller.signal;}};
}
module.exports={create};
