// No credentials on argv/stdout. This private host process prepares Tuda's grant
// after desktop readiness, using the same bundled Node and package contract.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {spawn,execFile} from 'node:child_process';import {fileURLToPath} from 'node:url';import {promisify} from 'node:util';
import {createInterface} from 'node:readline';import {once} from 'node:events';
import {storedSession,serviceOrigin} from '../lib/managed-login.mjs';
import {networkFetch} from '../lib/network.mjs';
import {rejectLinks} from '../lib/manager.mjs';
import tudaPlugin from '../lib/tuda-plugin.cjs';
import {selectTudaRuntime,updateTudaRuntime} from '../lib/tuda-package.mjs';
import {connectionOptions,verifyIndependentReady,connectionError} from '../lib/tuda-connection.mjs';
import control from '../lib/desktop-control.cjs';
const bundle=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const core=path.resolve(process.argv[2]),root=path.dirname(core);
const companyOrigin=serviceOrigin(JSON.parse(fs.readFileSync(path.join(bundle,'defaults/company-auth.json'),'utf8')).origin);
const shutdown=new AbortController();
let scratch,child,hostIdentity,previousHandoff;
const runFile=promisify(execFile);
const identity=s=>s&&Date.parse(s.expiresAt)>Date.now()?(s.identity||crypto.createHash('sha256').update(s.origin+'\n'+s.token).digest('hex')):null;
async function hostSession(){const file=path.join(core,'managed-login.json');if(fs.existsSync(file)&&JSON.parse(fs.readFileSync(file,'utf8')).contract===2)return control.request(root,'company.identity');return storedSession({core});}
function cleanup(){if(scratch)fs.rmSync(scratch,{recursive:true,force:true});}
async function prepare(file,instanceId,grant){
 hostIdentity=identity(grant);
 const origin=serviceOrigin(grant.origin,{allowHttp:grant.allowHttp===true}),verifier=crypto.randomBytes(32).toString('base64url');
 if(origin!==companyOrigin)throw Error('TUDA_COMPANY_ORIGIN_MISMATCH');
 const verifierHash=crypto.createHash('sha256').update(verifier).digest('hex');
 const response=grant.identity?{ok:true,json:async()=>({ok:true,data:await control.request(root,'company.handoff',{identity:grant.identity,verifierHash})})}:await networkFetch(origin+'/api/company/v1/handoff/issue',{method:'POST',redirect:'error',signal:AbortSignal.any([shutdown.signal,AbortSignal.timeout(15000)]),headers:{'content-type':'application/json',authorization:'Bearer '+grant.token,'x-company-app-id':'codex-own'},body:JSON.stringify({targetAppId:'tuda',verifierHash})});
 const result=await response.json(),data=result?.data;
 if(!response.ok||!result.ok||data?.contract!==1||data.sourceAppId!=='codex-own'||data.targetAppId!=='tuda'||! /^[A-Za-z0-9_-]{43}$/.test(data.code)||data.expiresIn!==60)throw Error('TUDA_HANDOFF_FAILED');
 const contents=JSON.stringify({contract:1,origin,appId:'tuda',instanceId,code:data.code,verifier,expiresAt:new Date(Date.now()+60000).toISOString()});
 if(fs.existsSync(file)){
  const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||fs.readFileSync(file,'utf8')!==previousHandoff)throw Error('TUDA_HANDOFF_FILE_CHANGED');
 }
 const next=file+'.next-'+crypto.randomUUID();try{fs.writeFileSync(next,contents,{flag:'wx',mode:0o600});fs.renameSync(next,file);previousHandoff=contents;}finally{if(fs.existsSync(next))fs.unlinkSync(next);}
}
async function desktopReady(env,runtime){
 let result;
 try{result=await runFile(process.execPath,[runtime.managerEntry,'desktop','prepare','--no-launch','--user-data-path',env.TUDA_USER_DATA_PATH,'--startup-timeout','120','--json'],{env,encoding:'utf8',windowsHide:true,signal:shutdown.signal,timeout:135000,maxBuffer:128*1024});}
 catch{throw Error('TUDA_INDEPENDENT_UNAVAILABLE');}
 let value;try{value=JSON.parse(result.stdout);}catch{throw Error('TUDA_DESKTOP_INCOMPATIBLE');}
 return verifyIndependentReady(value,runtime.packageRoot);

}
try{
 rejectLinks(root);rejectLinks(core);
 const temp=path.join(root,'tmp');rejectLinks(temp);fs.mkdirSync(temp,{recursive:true,mode:0o700});
 scratch=fs.mkdtempSync(path.join(temp,'tuda-auth-'));fs.chmodSync(scratch,0o700);
 const file=path.join(scratch,'handoff.json');
 const env={...process.env};for(const k of Object.keys(env))if(/^(TUDA_|TOAPISCLI_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(k))delete env[k];
 const connection=connectionOptions(root);
 Object.assign(env,{TUDA_USER_DATA_PATH:connection.userDataPath,TUDA_NO_LAUNCH:'1',TUDA_AUTH_HANDOFF_FILE:file,TUDA_PLUGIN_SPACE:'enterprise',TUDA_COMPANY_URL:companyOrigin,TUDA_STARTUP_TIMEOUT_MS:'120000'});
 const runtime=await selectTudaRuntime({root,bundle});
 child=spawn(process.execPath,[runtime.pluginEntry],{env,stdio:['pipe','pipe','inherit'],windowsHide:true});
 child.stdout.pipe(process.stdout);
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{shutdown.abort();child.kill(signal);process.stdin.destroy();});
 child.once('error',()=>{cleanup();process.stderr.write('Tuda board runtime could not start\n');process.exitCode=1;});
 child.once('exit',(code)=>{cleanup();process.exitCode=code??1;});
 child.once('close',()=>{shutdown.abort();process.stdin.destroy();});
 child.stdin.on('error',()=>{child.kill();});
 process.once('exit',cleanup);
 // Tool discovery is available while signed out. Issue the one-minute grant
 // immediately before a business call, rather than expiring it during idle time.
 let preparedInstance,lastUpdateCheck=0,lastHandoff=0;
 for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})){
  if(Buffer.byteLength(line)>32*1024*1024)throw Error('TUDA_MCP_FRAME_TOO_LARGE');
  let message;try{message=JSON.parse(line);}catch{throw Error('TUDA_MCP_FRAME_INVALID');}
  if(message.method==='tools/call'){
   try{
    if(!tudaPlugin.TOOLS.includes(message.params?.name))throw Error('TUDA_CAPABILITY_DENIED');
    const grant=await hostSession(),current=identity(grant);if(!current)throw Error('TUDA_HOST_LOGIN_REQUIRED');
    if(preparedInstance&&current!==hostIdentity)throw Error('TUDA_HOST_LOGIN_CHANGED');
    if(!lastUpdateCheck||Date.now()-lastUpdateCheck>=24*3600000){lastUpdateCheck=Date.now();void updateTudaRuntime(runtime,{signal:shutdown.signal}).catch(()=>{});}
    const instance=await desktopReady(env,runtime);
    if(identity(await hostSession())!==current)throw Error('TUDA_HOST_LOGIN_CHANGED');
    if(instance!==preparedInstance||Date.now()-lastHandoff>=5*60*1000){await prepare(file,instance,grant);if(identity(await hostSession())!==current)throw Error('TUDA_HOST_LOGIN_CHANGED');preparedInstance=instance;lastHandoff=Date.now();}
   }catch(error){
    if(shutdown.signal.aborted)break;
    const text=connectionError(error);
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{isError:true,content:[{type:'text',text}]}})+'\n');continue;
   }
  }
  if(!child.stdin.write(line+'\n'))await once(child.stdin,'drain');
 }
 child.stdin.end();
}catch(error){child?.kill();cleanup();process.stderr.write(connectionError(error)+'\n');process.exitCode=1;}
