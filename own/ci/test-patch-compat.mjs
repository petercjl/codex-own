// Exercise the real bundled patch handler through the owned HTTP adapter.
// All model responses and credentials are offline fixtures.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import http from 'node:http';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),app=path.resolve(process.argv[2]);
const bridge=require(process.env.OWN_AGENT_BRIDGE_MODULE||'../lib/subagent-bridge.cjs');
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'own-patch-'))),core=path.join(root,'core');fs.mkdirSync(core);
const add='*** Begin Patch\n*** Add File: patch-proof.txt\n+第一版：路径 C:\\temp\\new，字面量 \\n。\n*** End Patch';
const update='*** Begin Patch\n*** Update File: patch-proof.txt\n@@\n-第一版：路径 C:\\temp\\new，字面量 \\n。\n+第二版：中文与引号 "保持原样"，字面量 \\n。\n*** End Patch';
let count=0,outputs=[],fixtureError;
const upstream=http.createServer(async(req,res)=>{
 try{
  let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);count++;assert.ok(count<=4,'Unexpected tool retry');
  outputs=body.input.filter(x=>x.type==='custom_tool_call_output').map(x=>x.output);
  if(count===1)assert.ok(body.tools.some(x=>x.type==='custom'&&x.name==='apply_patch'),'Bundled CLI must expose the freeform patch tool');
  const patch=count===1?JSON.stringify({data:add}):count===2?JSON.stringify({data:JSON.stringify({data:update})}):null;
  const item=patch?{type:'custom_tool_call',id:'ct_'+count,call_id:'call_'+count,name:'apply_patch',input:patch}:{type:'message',id:'msg_done',role:'assistant',status:'completed',content:[{type:'output_text',text:'PATCH_COMPAT_OK',annotations:[]}]};
  res.writeHead(200,{'content-type':'text/event-stream'});
  const send=(type,data)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...data})+'\n\n');
  send('response.created',{response:{id:'resp_'+count,status:'in_progress',output:[]}});
  send('response.output_item.added',{output_index:0,item:patch?{...item,input:''}:item});
  if(patch){for(const delta of [patch.slice(0,35),patch.slice(35)])send('response.custom_tool_call_input.delta',{item_id:item.id,output_index:0,delta});send('response.custom_tool_call_input.done',{item_id:item.id,output_index:0,input:patch});}
  send('response.output_item.done',{output_index:0,item});send('response.completed',{response:{id:'resp_'+count,status:'completed',output:[item],usage:{input_tokens:10,output_tokens:10,total_tokens:20}}});res.end();
 }catch(e){fixtureError=e;res.writeHead(500);res.end('fixture failed');}
});
await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
const server=await bridge.startServer({upstream:'http://127.0.0.1:'+upstream.address().port+'/v1',fetch});
fs.writeFileSync(path.join(core,'config.toml'),`model="deepseek-v4.1-flash"\nmodel_provider="offline_fixture"\nmodel_catalog_json=${JSON.stringify(path.resolve('own/defaults/models.json'))}\n[model_providers.offline_fixture]\nname="Offline patch fixture"\nbase_url=${JSON.stringify(server.url)}\nwire_api="responses"\nrequires_openai_auth=false\n`,{flag:'wx',mode:0o600});
const env={...process.env};for(const k of Object.keys(env))if(/^(CODEX_|OPENAI_|CHATGPT_|ELECTRON_|NODE_REPL_)/.test(k))delete env[k];env.CODEX_HOME=core;
const child=spawn(path.join(app,process.platform==='darwin'?'Contents/Resources/codex-own-cli':'resources/codex.exe'),['app-server','--stdio'],{env,stdio:['pipe','pipe','pipe']});
let id=0,buffer='',stderr='',resolveTurn,rejectTurn;const pending=new Map();const turn=new Promise((r,j)=>{resolveTurn=r;rejectTurn=j});turn.catch(()=>{});
const fail=e=>{for(const p of pending.values())p.reject(e);rejectTurn(e)};
child.on('error',fail);child.on('exit',()=>fail(Error('Native CLI exited '+stderr)));child.stderr.on('data',b=>{stderr=(stderr+b).slice(-2000)});
child.stdout.on('data',b=>{buffer+=b;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);let m;try{m=JSON.parse(line)}catch{continue;}const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}if(m.method==='turn/completed')m.params.turn.status==='completed'?resolveTurn():rejectTurn(Error(JSON.stringify(m.params.turn)));}});
const call=(method,params)=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params})+'\n')});
const timer=setTimeout(()=>fail(Error('Native patch fixture timed out '+stderr)),60000);
try{
 await call('initialize',{clientInfo:{name:'own-patch-qa',version:'1'},capabilities:{experimentalApi:true}});child.stdin.write('{"method":"initialized"}\n');
 const started=await call('thread/start',{cwd:root,approvalPolicy:'never',sandbox:'danger-full-access'});
 await call('turn/start',{threadId:started.thread.id,input:[{type:'text',text:'Use apply_patch to create then update patch-proof.txt.',text_elements:[]}]});await turn;if(fixtureError)throw fixtureError;
 assert.equal(count,3);assert.equal(outputs.length,2);for(const output of outputs)assert.match(output,/Success/);
 assert.equal(fs.readFileSync(path.join(root,'patch-proof.txt'),'utf8'),'第二版：中文与引号 "保持原样"，字面量 \\n。\n');
 console.log(JSON.stringify({ok:true,realBundledPatchHandler:true,singleAndNestedEnvelope:true,unicodeAndLiteralEscapesPreserved:true,toolCalls:2,toolErrors:0,realCredentialsUsed:false,profile:root}));
}finally{clearTimeout(timer);child.kill();child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();await server.close();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));}
