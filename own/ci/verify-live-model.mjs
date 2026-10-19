// Explicitly authorized live model acceptance. Credentials stay in a temporary
// profile, never in reports, and are removed when the owned backend exits.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {createRequire} from 'node:module';
const args=process.argv.slice(2),value=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
if(!args.includes('--live'))throw Error('Live acceptance requires explicit --live');
const app=path.resolve(value('--app')||''),sourceCore=path.resolve(value('--core')||''),model=value('--model');
if(!model||!value('--app')||!value('--core'))throw Error('Required: --live --app APP --core CORE --model MODEL');
const require=createRequire(import.meta.url),bundle=path.join(app,'Contents/Resources/own-updater');
const {parse,stringify}=require(path.join(bundle,'node_modules/smol-toml'));
const config=parse(fs.readFileSync(path.join(sourceCore,'config.toml'),'utf8')),auth=JSON.parse(fs.readFileSync(path.join(sourceCore,'auth.json'),'utf8'));
const provider=config.model_provider,endpoint=config.model_providers?.[provider];
if(provider!=='dashscope_deepseek'||new URL(endpoint.base_url).hostname!=='dashscope.aliyuncs.com'||endpoint.wire_api!=='responses')throw Error('Expected existing Bailian Responses configuration');
assert.ok(auth.auth_mode==='apikey'&&auth.OPENAI_API_KEY,'Expected existing API credential');
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'own-live-'))),core=path.join(root,'core'),work=path.join(root,'work'),home=path.join(root,'home');
for(const dir of [core,work,home])fs.mkdirSync(dir,{mode:0o700});
const catalog=JSON.parse(fs.readFileSync(config.model_catalog_json,'utf8')),existing=catalog.models.find(x=>x.slug===model)||catalog.models.find(x=>x.slug==='deepseek-v4.1-flash');assert.ok(existing,'Compatible catalogue entry required');
const selected={...structuredClone(existing),slug:model,display_name:model+' · 百炼'};catalog.models=catalog.models.filter(x=>x.slug!==model);catalog.models.unshift(selected);
fs.writeFileSync(path.join(core,'models.json'),JSON.stringify(catalog),{flag:'wx',mode:0o600});
const testConfig={model,model_provider:provider,model_reasoning_effort:'low',cli_auth_credentials_store:'file',forced_login_method:'api',model_catalog_json:path.join(core,'models.json'),web_search:'disabled',model_providers:{[provider]:endpoint}};
fs.writeFileSync(path.join(core,'config.toml'),stringify(testConfig),{flag:'wx',mode:0o600});
const credential=path.join(core,'auth.json');fs.writeFileSync(credential,JSON.stringify(auth),{flag:'wx',mode:0o600});
const env={...process.env};for(const k of Object.keys(env))if(/^(CODEX_|OPENAI_|CHATGPT_|ELECTRON_|NODE_REPL_|BASH_ENV$|ZDOTDIR$|NODE_OPTIONS$|NODE_PATH$)/.test(k))delete env[k];
Object.assign(env,{HOME:home,USERPROFILE:home,CFFIXED_USER_HOME:home,CODEX_HOME:core,PATH:path.dirname(path.join(bundle,'node'))+':/usr/bin:/bin:/usr/sbin:/sbin'});
const child=spawn(path.join(bundle,'node'),[path.join(bundle,'lib/subagent-bridge-runner.cjs'),core,path.join(app,'Contents/Resources/codex-own-cli'),'app-server','--stdio'],{env,stdio:['pipe','pipe','pipe']});
let id=0,buffer='',resolveTurn,rejectTurn;const pending=new Map(),notifications=[];
const turn=new Promise((r,j)=>{resolveTurn=r;rejectTurn=j});turn.catch(()=>{});
const fail=error=>{for(const p of pending.values())p.reject(error);rejectTurn(error)};
child.stderr.on('data',()=>{});child.on('error',fail);child.on('exit',()=>fail(Error('Live backend exited')));
child.stdout.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\n'))>=0){let m;try{m=JSON.parse(buffer.slice(0,i))}catch{}buffer=buffer.slice(i+1);if(!m)continue;
 const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}
 if(m.method==='item/completed')notifications.push(m.params.item);
 if(m.method==='turn/completed')m.params.turn.status==='completed'?resolveTurn():rejectTurn(Error(JSON.stringify(m.params.turn.error||{status:m.params.turn.status})));
}});
const call=(method,params)=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params})+'\n')});
const timer=setTimeout(()=>fail(Error('Live model acceptance timed out')),180000);
try{
 await call('initialize',{clientInfo:{name:'own-live-model-qa',version:'1'},capabilities:{experimentalApi:true}});child.stdin.write('{"method":"initialized"}\n');
 const started=await call('thread/start',{cwd:work,model,modelProvider:provider,approvalPolicy:'never',sandbox:'workspace-write'});
 const prompt='这是隔离的真实工具验收。只在当前工作目录操作，按顺序完成：1. 调用 exec_command 执行 printf "OWN_LIVE_SHELL_OK\\n"；2. 调用 apply_patch 新增 live-proof.txt，内容为「中文第一版」并以换行结束；3. 再次调用 apply_patch 将该文件修改为「中文第二版：1017」并以换行结束；4. 用 exec_command 读取文件确认；最后只回复 LIVE_MODEL_QA_OK。必须实际调用工具，补丁必须通过 apply_patch 执行。';
 await call('turn/start',{threadId:started.thread.id,input:[{type:'text',text:prompt,text_elements:[]}]});await turn;
 const files=[];function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(p.endsWith('.jsonl'))files.push(p);}}walk(path.join(core,'sessions'));
 const items=files.flatMap(p=>fs.readFileSync(p,'utf8').trim().split('\n').map(s=>JSON.parse(s))).filter(d=>d.type==='response_item').map(d=>d.payload);
 const patches=items.filter(x=>x.type==='custom_tool_call'&&x.name==='apply_patch'),outputs=items.filter(x=>['custom_tool_call_output','function_call_output'].includes(x.type));
 assert.ok(patches.length>=2,'Expected separate create and update patch calls');assert.ok(items.some(x=>x.type==='function_call'&&x.name==='exec_command'),'Expected real shell tool');
 for(const p of patches){const out=outputs.find(o=>o.call_id===p.call_id);assert.match(String(out?.output),/Success/,'Native patch handler must succeed');}
 assert.ok(outputs.some(x=>String(x.output).includes('OWN_LIVE_SHELL_OK')));assert.equal(fs.readFileSync(path.join(work,'live-proof.txt'),'utf8'),'中文第二版：1017\n');
 assert.ok(notifications.some(x=>x.type==='agentMessage'&&x.text?.includes('LIVE_MODEL_QA_OK')),'Expected final acceptance reply');
 console.log(JSON.stringify({ok:true,model,provider,realAPI:true,realNativeTools:true,patchCreateAndUpdate:true,patchCalls:patches.length,patchErrors:0,profile:root}));
}catch(error){console.error(JSON.stringify({ok:false,model,message:error.message.replaceAll(auth.OPENAI_API_KEY,'[redacted]'),profile:root}));process.exitCode=1;}
finally{clearTimeout(timer);child.kill();child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();if(fs.existsSync(credential))fs.unlinkSync(credential);}
