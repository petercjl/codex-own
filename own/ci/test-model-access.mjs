// Explicit live acceptance, isolated from existing conversations and settings.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';import {spawn} from 'node:child_process';import {parse,stringify} from 'smol-toml';import {configure} from '../lib/manager.mjs';import {parseModelAccess} from '../lib/model-access.mjs';
const args=process.argv.slice(2),value=key=>args[args.indexOf(key)+1];
if(!args.includes('--live')||!args.includes('--app')||!args.includes('--config-file'))throw Error('Required: --live --app APP --config-file FILE [--runner FILE]');
const app=path.resolve(value('--app')),source=path.resolve(value('--config-file'));
const access=parseModelAccess(fs.readFileSync(source,'utf8')),root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'own-model-live-'))),core=path.join(root,'core'),work=path.join(root,'work');
fs.chmodSync(root,0o700);fs.mkdirSync(work,{mode:0o700});
const bundle=path.join(app,'Contents/Resources/own-updater'),runner=args.includes('--runner')?path.resolve(value('--runner')):path.join(bundle,'lib/subagent-bridge-runner.cjs');
const node=path.join(bundle,'node'),cli=path.join(app,'Contents/Resources/codex-own-cli'),secrets=Object.values(access.providers).map(p=>p.apiKey);
const redact=message=>secrets.reduce((s,key)=>s.replaceAll(key,'[redacted]'),String(message));
await configure(source,{p:{root,core,manager:path.join(root,'manager'),target:args.includes('--runner')?path.join(root,'source-preflight'):app},isRunning:()=>[]});
if(args.includes('--profile-core')){const desktop=parse(fs.readFileSync(path.join(path.resolve(value('--profile-core')),'config.toml'),'utf8')),file=path.join(core,'config.toml'),config=parse(fs.readFileSync(file,'utf8'));for(const key of ['mcp_servers','plugins','marketplaces'])if(desktop[key])config[key]=desktop[key];fs.writeFileSync(file,stringify(config),{mode:0o600});}
{const file=path.join(core,'config.toml'),config=parse(fs.readFileSync(file,'utf8'));config.mcp_servers={...config.mcp_servers,model_route_probe:{command:node,args:[fileURLToPath(new URL('./model-route-probe.mjs',import.meta.url))]}};fs.writeFileSync(file,stringify(config),{mode:0o600});}
const env={...process.env,HOME:root,CFFIXED_USER_HOME:root,USERPROFILE:root,CODEX_HOME:core};for(const k of Object.keys(env))if(/^(OPENAI_|CHATGPT_|ELECTRON_|NODE_REPL_|NODE_OPTIONS$|BASH_ENV$|ZDOTDIR$)/.test(k))delete env[k];
const child=spawn(node,[runner,core,cli,'-c','features.code_mode_host=true','app-server','--stdio','--analytics-default-enabled','-c','plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.enabled=true','-c','plugins.code-review@openai-bundled.mcp_servers.code-review.enabled=true'],{env,stdio:['pipe','pipe','pipe']});
let id=0,buffer='',stderr='',activeTurn;const pending=new Map(),events=[];
const fail=error=>{for(const p of pending.values())p.reject(error);activeTurn?.reject(error);};
child.on('error',fail);child.on('exit',()=>fail(Error('Backend exited: '+redact(stderr).slice(-1000))));child.stderr.on('data',b=>stderr=(stderr+b).slice(-6000));
child.stdout.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\n'))>=0){let m;try{m=JSON.parse(buffer.slice(0,i));}catch{}buffer=buffer.slice(i+1);if(!m)continue;const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}if(m.method){events.push(m);if(m.method==='turn/completed'&&activeTurn){const t=activeTurn;activeTurn=null;m.params.turn.status==='completed'?t.resolve():t.reject(Error(JSON.stringify(m.params.turn.error||m.params.turn)));}}}});
const call=(method,params)=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
const timer=setTimeout(()=>fail(Error('Model acceptance timeout')),300000),results=[];
try{
 await call('initialize',{clientInfo:{name:'codex-own-three-provider-acceptance',version:'1'},capabilities:{experimentalApi:true}});child.stdin.write('{"method":"initialized"}\n');
 for(const [provider,p]of Object.entries(access.providers))for(const model of Object.keys(p.models)){
  const alias=provider+'/'+model,dir=path.join(work,provider);fs.mkdirSync(dir,{recursive:true});
  const thread=await call('thread/start',{cwd:dir,model:alias,modelProvider:'codex_own_imported',approvalPolicy:'never',sandbox:'danger-full-access'});
  const done=new Promise((resolve,reject)=>{activeTurn={resolve,reject};});done.catch(()=>{});
  await call('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:'这是三组模型配置的隔离验收。请实际调用命令工具执行 printf "MODEL_ROUTE_SHELL_OK\\n"；使用 apply_patch 新建 proof.txt，内容为「中文模型路由验收」并以换行结束；再使用命令工具读取文件。完成后只回复 MODEL_ROUTE_LIVE_OK。',text_elements:[]}]});
  await done;assert.equal(fs.readFileSync(path.join(dir,'proof.txt'),'utf8'),'中文模型路由验收\n');
  assert.ok(events.some(e=>e.method==='item/completed'&&e.params.threadId===thread.thread.id&&e.params.item.type==='agentMessage'&&e.params.item.text?.includes('MODEL_ROUTE_LIVE_OK')));
  results.push({model:alias,protocol:p.protocol,realModel:true,realTools:true,unicodePatch:true});console.log(JSON.stringify({model:alias,ok:true,phase:'tools'}));
  const resumed=await call('thread/resume',{threadId:thread.thread.id,cwd:dir});assert.equal(resumed.thread.id,thread.thread.id);
  const again=new Promise((resolve,reject)=>{activeTurn={resolve,reject};});again.catch(()=>{});
  await call('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:'继续验收：使用命令工具读取 proof.txt；保持文件原样，最后只回复 MODEL_ROUTE_RESUME_OK。',text_elements:[]}]});await again;
  results.at(-1).resumedTurn=true;console.log(JSON.stringify({model:alias,ok:true,phase:'resume'}));
  const discovery=new Promise((resolve,reject)=>{activeTurn={resolve,reject};});discovery.catch(()=>{});
  await call('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:'插件工具发现验收：请使用 tool_search 搜索 model_route_probe 的 probe 工具，实际调用它，读取返回值后只回复 MODEL_DISCOVERY_OK。',text_elements:[]}]});await discovery;
  assert.ok(events.some(e=>e.method==='item/completed'&&e.params.threadId===thread.thread.id&&e.params.item.type==='mcpToolCall'&&e.params.item.server==='model_route_probe'&&e.params.item.tool==='probe'&&e.params.item.status==='completed'),'MCP probe must actually execute');
  results.at(-1).discovery=true;console.log(JSON.stringify({model:alias,ok:true,phase:'discovery'}));
  await call('thread/resume',{threadId:thread.thread.id,cwd:dir});
  const rediscovery=new Promise((resolve,reject)=>{activeTurn={resolve,reject};});rediscovery.catch(()=>{});const marker=events.length;
  await call('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:'恢复插件调用历史验收：再次实际调用刚才的 model_route_probe.probe，读取结果后只回复 MODEL_DISCOVERY_RESUME_OK。只使用该插件工具。',text_elements:[]}]});await rediscovery;
  assert.ok(events.slice(marker).some(e=>e.method==='item/completed'&&e.params.item.type==='mcpToolCall'&&e.params.item.server==='model_route_probe'&&e.params.item.status==='completed'),'MCP probe must execute after resume');results.at(-1).discoveryResume=true;
  console.log(JSON.stringify({model:alias,ok:true,phase:'discovery-resume'}));
 }
 const sequence=Object.entries(access.providers).map(([provider,p])=>provider+'/'+Object.keys(p.models)[0]);
 const shared=await call('thread/start',{cwd:work,model:sequence[0],modelProvider:'codex_own_imported',approvalPolicy:'never',sandbox:'danger-full-access'});
 for(const model of sequence){const done=new Promise((resolve,reject)=>{activeTurn={resolve,reject};});done.catch(()=>{});await call('turn/start',{threadId:shared.thread.id,model,input:[{type:'text',text:'同一对话切换模型验收：请实际调用命令工具执行 printf "MODEL_SWITCH_OK\\n"，最后只回复 MODEL_SWITCH_OK。',text_elements:[]}]});await done;console.log(JSON.stringify({ok:true,model,phase:'same-thread-switch'}));}
 console.log(JSON.stringify({ok:true,results,sameThreadModelSwitch:true,isolatedProfile:root,sourceRunner:args.includes('--runner')}));
}catch(error){console.error(JSON.stringify({ok:false,error:redact(error.message),results,isolatedProfile:root}));process.exitCode=1;}
finally{clearTimeout(timer);child.kill();child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();for(const name of ['auth.json','model-access.json']){const file=path.join(core,name);if(fs.existsSync(file))fs.unlinkSync(file);}}
