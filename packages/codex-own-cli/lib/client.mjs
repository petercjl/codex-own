import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
const err=(code,message=code)=>Object.assign(Error(message),{code});
export function defaultRoot(){
 if(process.platform==='darwin')return path.join(os.homedir(),'.codex-own-dev','Library/Application Support/codex-own-independent');
 throw err('TARGET_REQUIRED','Supply --root for an explicitly configured desktop control endpoint; Windows desktop control has not been verified');
}
export function endpoint(root){
 const file=path.join(root||defaultRoot(),'control/bridge.json');let stat;try{stat=fs.lstatSync(file);}catch{throw err('DESKTOP_CONTROL_UNAVAILABLE','Start a codex-own development build with desktop control contract 1');}
 if(stat.isSymbolicLink()||!stat.isFile()||(process.platform!=='win32'&&(stat.mode&0o077)))throw err('UNSAFE_CONTROL_ENDPOINT');
 const value=JSON.parse(fs.readFileSync(file,'utf8'));
 if(value.contract!==1||value.kind!=='codex-own-desktop-control'||!Number.isInteger(value.port)||value.port<1||value.port>65535||!Number.isInteger(value.pid)||!/^\w{64}$/.test(value.token))throw err('INVALID_CONTROL_ENDPOINT');
 try{process.kill(value.pid,0);}catch{throw err('DESKTOP_NOT_RUNNING');}return value;
}
export async function request(root,action,params={}){
 const e=endpoint(root);let response;try{response=await fetch('http://127.0.0.1:'+e.port+'/v1',{method:'POST',headers:{authorization:'Bearer '+e.token,'content-type':'application/json'},body:JSON.stringify({action,params}),signal:AbortSignal.timeout(35000)});}catch{throw err('CONTROL_OUTCOME_UNKNOWN','Read operation/chat status before retrying a write');}
 const value=await response.json();if(!value.ok)throw err(value.error?.code||'CONTROL_FAILED',value.error?.message);return value.data;
}
export async function wait(root,threadId,{timeout=60,interval=500}={}){
 if(!Number.isFinite(timeout)||timeout<0||timeout>60)throw err('INVALID_WAIT_TIMEOUT','Use bounded waits from 0 to 60 seconds');
 const end=Date.now()+timeout*1000;let value;do{value=await request(root,'chat.result',{threadId});if(value.complete||value.status==='needs_attention')return value;if(Date.now()>=end)break;await new Promise(r=>setTimeout(r,interval));}while(true);return {...value,timedOut:true};
}
