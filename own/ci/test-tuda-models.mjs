// Explicit live acceptance: real configured models discover and call board MCP.
// Credentials and Tuda business state stay in a temporary private profile.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {createRequire} from 'node:module';import {once} from 'node:events';
import {StringDecoder} from 'node:string_decoder';
const args=process.argv.slice(2),value=key=>{const i=args.indexOf(key);return i<0?null:args[i+1];};
if(!args.includes('--live')||!value('--app')||!value('--core'))throw Error('Required: --live --app APP --core CORE');
if(process.platform!=='darwin')throw Error('This live desktop acceptance currently supports Mac development only');
const app=path.resolve(value('--app')),sourceCore=path.resolve(value('--core')),bundle=path.join(app,'Contents/Resources/own-updater');
const require=createRequire(import.meta.url),{parse}=require(path.join(bundle,'node_modules/smol-toml'));
const {readModelAccess}=await import('../lib/model-access.mjs');
const catalog=JSON.parse(fs.readFileSync(parse(fs.readFileSync(path.join(sourceCore,'config.toml'),'utf8')).model_catalog_json));
const selected=value('--model'),models=catalog.models.map(m=>m.slug).filter(m=>!selected||m===selected);assert(models.length);
const node=require(path.join(bundle,'lib/bundled-node.cjs')).resolveBundledNode(bundle),cli=path.join(app,'Contents/Resources/codex-own-cli');
for(const model of models){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'own-tuda-live-'))),core=path.join(root,'core'),work=path.join(root,'work');fs.chmodSync(root,0o700);fs.mkdirSync(core,{mode:0o700});fs.mkdirSync(work,{mode:0o700});
 for(const name of ['config.toml','auth.json','model-access.json','managed-login.json']){fs.copyFileSync(path.join(sourceCore,name),path.join(core,name),fs.constants.COPYFILE_EXCL);fs.chmodSync(path.join(core,name),0o600);}
 const secrets=Object.values(readModelAccess(core).providers).map(p=>p.apiKey).filter(Boolean);
 const redact=value=>{let s=String(value);for(const secret of secrets)s=s.replaceAll(secret,'[redacted]');return s;};
 const env={...process.env};for(const key of Object.keys(env))if(/^(CODEX_|OPENAI_|CHATGPT_|ELECTRON_|NODE_REPL_|BASH_ENV$|ZDOTDIR$|NODE_OPTIONS$|NODE_PATH$)/.test(key))delete env[key];env.CODEX_HOME=core;
 const processApi={spawn};require(path.join(bundle,'lib/api-input-compat.cjs')).install({cli,core,processApi});
 const child=processApi.spawn(cli,['-c','features.code_mode_host=true','app-server'],{env,stdio:['pipe','pipe','pipe']});
 let id=0,buffer='',resolveTurn,rejectTurn,receipt;const pending=new Map(),items=[],decoder=new StringDecoder('utf8');
 const turn=new Promise((r,j)=>{resolveTurn=r;rejectTurn=j;});turn.catch(()=>{});
 const fail=e=>{for(const p of pending.values())p.reject(e);pending.clear();rejectTurn(e);};
 child.stderr.on('data',()=>{});child.once('error',fail);child.once('exit',()=>fail(Error('Acceptance backend exited')));
 child.stdout.on('data',bytes=>{buffer+=decoder.write(bytes);let i;while((i=buffer.indexOf('\n'))>=0){let m;try{m=JSON.parse(buffer.slice(0,i));}catch{}buffer=buffer.slice(i+1);if(!m)continue;
  if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(redact(JSON.stringify(m.error)))):p.resolve(m.result);}
  if(m.method==='item/completed')items.push(m.params.item);
  if(m.method==='turn/completed')m.params.turn.status==='completed'?resolveTurn():rejectTurn(Error(redact(JSON.stringify(m.params.turn.error||{status:m.params.turn.status}))));
 }});
 const call=(method,params)=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
 const timer=setTimeout(()=>fail(Error('Live board acceptance timed out')),300000);
 try{
  await call('initialize',{clientInfo:{name:'codex-own-tuda-model-acceptance',version:'1'},capabilities:{experimentalApi:true}});child.stdin.write('{"method":"initialized"}\n');
  const status=await call('mcpServerStatus/list',{}),server=status.data?.find(s=>s.name==='codex_own_tuda');
  assert(server,'Expected native Tuda MCP registration');
  const started=await call('thread/start',{cwd:work,model,modelProvider:'codex_own_imported',approvalPolicy:'never',sandbox:'workspace-write'});
  await call('turn/start',{threadId:started.thread.id,input:[{type:'text',text:'这是 codex-own 内置画板插件的真实只读验收。请实际调用 codex_own_tuda 的 get_space 和 list_boards 两个工具，核对当前为 enterprise 空间。完成后只回复 TUDA_NATIVE_MODEL_QA_OK。',text_elements:[]}]});await turn;
  const calls=items.filter(i=>i.type==='mcpToolCall');assert(calls.some(i=>i.tool==='get_space'),'Expected actual get_space MCP call');assert(calls.some(i=>i.tool==='list_boards'),'Expected actual list_boards MCP call');assert(calls.every(i=>i.status==='completed'),'Expected successful MCP calls');
  assert(items.some(i=>i.type==='agentMessage'&&i.text?.includes('TUDA_NATIVE_MODEL_QA_OK')));
  receipt={ok:true,model,realModel:true,nativeMcp:true,tools:calls.map(i=>i.tool),temporaryCredentialsRemoved:true,desktopOwnership:'independent'};
 }catch(e){console.error(JSON.stringify({ok:false,model,message:redact(e.message),observedTools:items.filter(i=>/tool/i.test(i.type)).map(i=>({type:i.type,status:i.status,server:i.server,tool:i.tool}))}));process.exitCode=1;}
 finally{
  clearTimeout(timer);const closed=once(child,'close').catch(()=>{});child.kill();child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();await Promise.race([closed,new Promise(r=>setTimeout(r,3000))]);
  fs.rmSync(root,{recursive:true,force:true});
  if(receipt)console.log(JSON.stringify(receipt));
 }
}
