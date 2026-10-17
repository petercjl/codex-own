import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {paths,locked,rejectLinks,running,fail} from './manager.mjs';

const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
function readJSON(f){try{return JSON.parse(fs.readFileSync(f,'utf8'));}catch{return null;}}
export function lockStatus(p,{alive=pid=>{try{process.kill(pid,0);return true;}catch(e){return e.code==='ESRCH'?false:null;}}}={}){
 const file=path.join(p.manager,'operation.lock');
 if(!fs.existsSync(file))return {exists:false};
 rejectLinks(file);const s=fs.statSync(file),v=readJSON(file),valid=Number.isSafeInteger(v?.pid)&&v.pid>0;
 return {exists:true,pid:valid?v.pid:null,time:typeof v?.time==='string'?v.time:null,alive:valid?alive(v.pid):null,fingerprint:{ino:s.ino,size:s.size,mtimeMs:s.mtimeMs}};
}
export function incompleteTransactions(p){return fs.existsSync(p.manager)?fs.readdirSync(p.manager).filter(n=>/^transaction-.*\.json$/.test(n)&&!n.endsWith('.complete.json')&&!fs.existsSync(path.join(p.manager,n.replace('.json','.complete.json')))):[];}
function size(file){const s=fs.lstatSync(file);if(s.isSymbolicLink())return s.size;if(s.isFile())return s.size;if(!s.isDirectory())return 0;return fs.readdirSync(file).reduce((n,x)=>n+size(path.join(file,x)),0);}
export function temporaryStages(p){
 const items=[];
 for(const dir of [p.manager,path.join(p.root,'runtimes')]){
  rejectLinks(dir);if(!fs.existsSync(dir))continue;
  for(const n of fs.readdirSync(dir).filter(n=>/^stage-[A-Za-z0-9_-]+$/.test(n))){const f=path.join(dir,n);const st=fs.lstatSync(f);if(st.isDirectory()&&!st.isSymbolicLink())items.push({path:f,bytes:size(f),kind:'stage'});}
 }
 if(fs.existsSync(p.manager))for(const n of fs.readdirSync(p.manager).filter(n=>new RegExp('^temporary-'+uuid+'\\.json$').test(n))){
  const receipt=path.join(p.manager,n);rejectLinks(receipt);const r=readJSON(receipt),id=n.slice(10,-5),expected=path.join(path.dirname(p.target),'.codex-own-next-'+id);
  if(r?.package!=='@petercjl/codex-own'||r.kind!=='next'||r.path!==expected||r.target!==p.target||!fs.existsSync(expected))continue;
  rejectLinks(expected);items.push({path:expected,bytes:size(expected),kind:'next',receipt});
 }
 return items;
}
export function repairPlan({p=paths(),isRunning=running}={}){
 const lock=lockStatus(p),pending=incompleteTransactions(p),active=isRunning(p);
 const reason=pending.length?'INCOMPLETE_TRANSACTION':active.length?'APP_RUNNING':lock.exists&&lock.alive!==false?'LOCK_OWNER_UNCERTAIN_OR_ALIVE':null;
 return {ok:true,allowed:!reason,reason,lock,pendingTransactions:pending,orphanStages:temporaryStages(p),policy:'only inactive staging and receipted next copies; preserve applications, credentials, conversations, caches and rollback'};
}
export async function repairRun({p=paths(),isRunning=running}={}){
 rejectLinks(p.root);fs.mkdirSync(p.manager,{recursive:true,mode:0o700});
 const guard=path.join(p.manager,'recovery.lock');rejectLinks(guard);let fd;
 try{fd=fs.openSync(guard,'wx',0o600);}catch{fail('BUSY','Another recovery is active; inspect recovery.lock before recovery');}
 try{
  fs.writeSync(fd,JSON.stringify({pid:process.pid,time:new Date().toISOString()}));const plan=repairPlan({p,isRunning});
  if(!plan.allowed)fail(plan.reason,'Recovery is deferred; preserve the lock and transaction evidence');
  let recoveredLock=null;
  if(plan.lock.exists){const f=path.join(p.manager,'operation.lock'),now=lockStatus(p);if(JSON.stringify(now.fingerprint)!==JSON.stringify(plan.lock.fingerprint)||now.alive!==false)fail('BUSY','Lock changed during recovery');
   recoveredLock=path.join(p.manager,'recovered-lock-'+crypto.randomUUID()+'.json');fs.renameSync(f,recoveredLock);
  }
  return await locked(p,async()=>{
   const removed=[],warnings=[];let reclaimedBytes=0;
   for(const item of temporaryStages(p)){
    rejectLinks(item.path);try{await fs.promises.rm(item.path,{recursive:true,maxRetries:3,retryDelay:200});if(item.receipt)fs.unlinkSync(item.receipt);removed.push(item.path);reclaimedBytes+=item.bytes;}
    catch(e){warnings.push({path:item.path,code:e.code||'CLEANUP_FAILED'});}
   }
   return {ok:true,recoveredLock,removed,reclaimedBytes,warnings};
  },{recovery:true});
 }finally{fs.closeSync(fd);fs.unlinkSync(guard);}
}
