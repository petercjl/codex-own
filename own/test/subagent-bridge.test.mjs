import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {PassThrough} from 'node:stream';import http from 'node:http';import {once,EventEmitter} from 'node:events';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),b=require(process.env.OWN_AGENT_BRIDGE_MODULE||'../lib/subagent-bridge.cjs');
const task='标记 测试-A；路径 C:\\课程\\题目.jpg；计算 1327×19。';
const body=()=>({model:'deepseek-test',input:[{type:'message',role:'user',content:[{type:'input_text',text:'ordinary'}]},{type:'agent_message',author:'/root',recipient:'/root/child',content:[{type:'input_text',text:'Message Type: NEW_TASK\nPayload:\n'},{type:'encrypted_content',encrypted_content:task}]},{type:'reasoning',encrypted_content:'opaque-reasoning-blob'},{type:'function_call_output',call_id:'real',output:'real tool output'}]});
test('v2 task text becomes ordinary user input while real tools and reasoning stay unchanged',()=>{
 const source=body(),before=JSON.stringify(source),next=b.normalizeBody(source);
 assert.equal(JSON.stringify(source),before);assert.equal(next.input[1].type,'message');assert.equal(next.input[1].role,'user');assert.equal(next.input[1].content[1].text,task);
 assert.deepEqual(next.input[2],source.input[2]);assert.deepEqual(next.input[3],source.input[3]);assert.deepEqual(b.normalizeBody(next),next);
});
test('plain final-answer notifications are delivered and unrelated models are preserved',()=>{
 const source=body();source.input[1].content=[{type:'input_text',text:'Message Type: FINAL_ANSWER\nPayload:\n25213'}];
 assert.equal(b.normalizeBody(source).input[1].content[0].text,source.input[1].content[0].text);
 const other={...source,model:'gpt-fixture'};assert.equal(b.normalizeBody(other),other);
 assert.throws(()=>b.normalizeBody({...body(),input:[{type:'agent_message',content:[{type:'unknown'}]}]}),{code:'AGENT_MESSAGE_INVALID'});
});
test('session API pinning preserves settings and respects other providers',()=>{
 const m={method:'thread/resume',params:{threadId:'existing',config:{'model_providers.dashscope_deepseek.base_url':'https://original.example/v1',features:{example:true},model_providers:{dashscope_deepseek:{name:'preserve',base_url:'https://original.example/v1'}}}}};
 const next=b.pinRequest(m,'http://127.0.0.1:12345');assert.equal(next.params.threadId,'existing');assert.equal(next.params.config['model_providers.dashscope_deepseek.base_url'],'http://127.0.0.1:12345');assert.equal(next.params.config.model_providers.dashscope_deepseek.name,'preserve');assert.deepEqual(next.params.config.features,m.params.config.features);
 const other={...m,params:{...m.params,modelProvider:'openai'}};assert.equal(b.pinRequest(other,'http://localhost'),other);
 const untouched={method:'turn/start',params:{input:[]}};assert.equal(b.pinRequest(untouched,'http://localhost'),untouched);
});
test('RPC relay preserves UTF8 chunks and unrelated frames',async()=>{
 const m={method:'thread/start',params:{developerInstructions:task}},raw=Buffer.from(JSON.stringify(m)+'\n not-json\n'),s=b.rpcInput('http://127.0.0.1:1'),chunks=[];
 s.on('data',c=>chunks.push(c));const done=once(s,'end');for(let i=0;i<raw.length;i+=3)s.write(raw.subarray(i,i+3));s.end();await done;
 const text=Buffer.concat(chunks).toString();assert.equal(JSON.parse(text.split('\n')[0]).params.developerInstructions,task);assert.ok(text.endsWith(' not-json\n'));
});
test('invocation uses bundled Node and limits the bridge to DeepSeek API mode',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'own-bridge-invoke-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const cli=path.join(root,'codex.exe'),dir=path.join(root,'own-updater');fs.mkdirSync(path.join(dir,'lib'),{recursive:true});
 const config={forced_login_method:'api',model_provider:'dashscope_deepseek',model:'deepseek-test',model_providers:{dashscope_deepseek:{wire_api:'responses'}}},args=['app-server'],options={windowsHide:true};
 assert.throws(()=>b.invocation({cli,args,options,core:root,config,platform:'win32'}),{code:'AGENT_BRIDGE_MISSING'});
 fs.writeFileSync(path.join(dir,'node.exe'),'fixture',{flag:'wx'});fs.writeFileSync(path.join(dir,'lib','subagent-bridge-runner.cjs'),'fixture',{flag:'wx'});
 const next=b.invocation({cli,args,options,core:root,config,platform:'win32'});assert.equal(next.file,path.join(dir,'node.exe'));assert.deepEqual(next.args.slice(-1),args);assert.equal(next.options,options);
 assert.equal(b.invocation({cli,args,options,core:root,config:{...config,model_provider:'openai'}}),null);
});
async function upstream(t,handler){const server=http.createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));return 'http://127.0.0.1:'+server.address().port+'/v1';}
test('real HTTP relay preserves credentials in transit, task bytes, status and streaming events',async t=>{
 let received,firstSent=false,finished=false;
 const url=await upstream(t,async(req,res)=>{let bytes='';for await(const c of req)bytes+=c;received={path:req.url,auth:req.headers.authorization,body:JSON.parse(bytes)};res.writeHead(200,{'content-type':'text/event-stream'});firstSent=true;res.write('data: {"type":"response.created"}\n\n');setTimeout(()=>{finished=true;res.end('data: {"type":"response.completed"}\n\n');},100);});
 const server=await b.startServer({upstream:url,fetch});t.after(()=>server.close());
 const response=await fetch(server.url+'/responses?fixture=1',{method:'POST',headers:{authorization:'Bearer fixture', 'content-type':'application/json'},body:JSON.stringify(body())});
 const reader=response.body.getReader(),first=await reader.read();assert.equal(response.status,200);assert.equal(firstSent,true);assert.equal(finished,false);assert.match(Buffer.from(first.value).toString(),/response.created/);
 let rest='';for(;;){const x=await reader.read();if(x.done)break;rest+=Buffer.from(x.value).toString();}assert.match(rest,/response.completed/);
 assert.equal(received.path,'/v1/responses?fixture=1');assert.equal(received.auth,'Bearer fixture');assert.equal(received.body.input[1].content[1].text,task);
});
test('API errors retain status and body; forbidden paths never reach upstream',async t=>{
 let count=0;const url=await upstream(t,(_req,res)=>{count++;res.writeHead(429,{'content-type':'application/json'});res.end('{"error":{"code":"fixture_rate_limit"}}');});
 const server=await b.startServer({upstream:url,fetch});t.after(()=>server.close());
 const response=await fetch(server.url+'/responses',{method:'POST',body:JSON.stringify(body())});assert.equal(response.status,429);assert.equal((await response.json()).error.code,'fixture_rate_limit');
 const forbidden=await fetch(server.url+'/credentials',{method:'POST',body:'{}'});assert.equal(forbidden.status,404);assert.equal(count,1);
});
test('invalid or oversized requests fail explicitly without exposing request data',async t=>{
 const server=await b.startServer({upstream:'http://127.0.0.1:1/v1',fetch,maxBodyBytes:32});t.after(()=>server.close());
 const response=await fetch(server.url+'/responses',{method:'POST',body:'private-fixture-data'.repeat(4)});assert.equal(response.status,502);const text=await response.text();assert.ok(!text.includes('private-fixture-data'));assert.match(text,/AGENT_BRIDGE_TOO_LARGE/);
});

test('bridged Windows backend retains the Git Bash session policy',async t=>{
 const modulePath=process.env.OWN_API_COMPAT_MODULE||'../lib/api-input-compat.cjs',adapter=require(modulePath),shell=require(path.join(path.dirname(require.resolve(modulePath)),'windows-agent-shell.cjs'));
 const core=fs.mkdtempSync(path.join(os.tmpdir(),'own-bridge-shell-')),resources=path.join(core,'resources'),dir=path.join(resources,'own-updater');
 t.after(()=>fs.rmSync(core,{recursive:true,force:true}));fs.mkdirSync(path.join(dir,'lib'),{recursive:true});
 const cli=path.join(resources,'codex'),node=path.join(dir,process.platform==='win32'?'node.exe':'node');
 fs.writeFileSync(node,'fixture',{flag:'wx'});fs.writeFileSync(path.join(dir,'lib','subagent-bridge-runner.cjs'),'fixture',{flag:'wx'});
 fs.writeFileSync(path.join(core,'config.toml'),'forced_login_method="api"\nmodel_provider="dashscope_deepseek"\nmodel="deepseek-test"\n[model_providers.dashscope_deepseek]\nwire_api="responses"\nbase_url="https://api.example/v1"\n',{flag:'wx'});
 let invoked;const api={spawn(file,args,options){invoked={file,args,options};const child=new EventEmitter();child.stdin=new PassThrough();child.nativeInput=child.stdin;child.kill=()=>{};return child;}};
 const selection={supported:true,preferred:'gitBash',bash:'C:\\fixture\\bash.exe',powershell:'C:\\Windows\\powershell.exe'};
 shell.install({cli,core,processApi:api,platform:'win32',selection});adapter.install({cli,core,processApi:api});
 t.after(()=>{api[adapter.HOOK]?.restore();api[shell.HOOK]?.restore();});
 const child=api.spawn(cli,['app-server'],{windowsHide:true}),chunks=[];child.nativeInput.on('data',c=>chunks.push(c));const done=once(child.nativeInput,'end');
 child.stdin.end(JSON.stringify({method:'thread/start',params:{developerInstructions:'保留用户指令'}})+'\n');await done;
 const received=JSON.parse(Buffer.concat(chunks).toString());assert.equal(invoked.file,node);assert.ok(received.params.developerInstructions.startsWith('保留用户指令'));assert.match(received.params.developerInstructions,/codex-own-windows-shell-policy/);assert.match(received.params.developerInstructions,/Git Bash/);
});
