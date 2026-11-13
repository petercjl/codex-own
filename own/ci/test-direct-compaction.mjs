// Real CLI, offline model fixture: image history, compaction overflow retry,
// persistent same-thread summary, and native tool execution after compaction.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import http from 'node:http';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),bridge=require(process.env.OWN_AGENT_BRIDGE_MODULE||'../lib/subagent-bridge.cjs');
const app=path.resolve(process.argv[2]),root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'own-direct-compact-'))),core=path.join(root,'core');fs.mkdirSync(core);
let requests=0,fixtureError,sawImage=false;
const server=await bridge.startServer({fetch:async(_url,options)=>{
 try{
  const body=JSON.parse(options.body);requests++;
  if(requests===1)sawImage=JSON.stringify(body.input).includes('input_image');
  if(requests===2)return new Response(JSON.stringify({error:{code:'context_length_exceeded',type:'invalid_request_error',message:'Fixture compaction overflow'}}),{status:400,headers:{'content-type':'application/json'}});
  if(requests===4)assert.match(JSON.stringify(body.input),/OWN_COMPACTION_SUMMARY/);
  if(requests===5)assert.match(JSON.stringify(body.input),/OWN_NATIVE_TOOL_OK/);
  assert.ok(requests<=5);
  const output=requests===4?[{type:'function_call',id:'fc_fixture',call_id:'fixture',name:'exec_command',arguments:JSON.stringify({cmd:'printf "OWN_NATIVE_TOOL_OK\\n"',login:false})}]:[{type:'message',id:'msg_'+requests,role:'assistant',content:[{type:'output_text',text:requests===3?'OWN_COMPACTION_SUMMARY: Continue the original image task and verify the native tool.':requests===5?'OWN_DIRECT_COMPACT_OK':'OWN_FIRST_TURN_OK',annotations:[]}]}];
  const usage=requests===1?{input_tokens:100000,output_tokens:10,total_tokens:100010}:{input_tokens:100,output_tokens:10,total_tokens:110};
  const events=[{type:'response.created',response:{id:'r_'+requests,status:'in_progress',output:[]}},...output.flatMap((item,output_index)=>[{type:'response.output_item.added',output_index,item},{type:'response.output_item.done',output_index,item}]),{type:'response.completed',response:{id:'r_'+requests,status:'completed',output,usage}}];
  return new Response(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});
 }catch(error){fixtureError=error;return new Response('{}',{status:500});}
}});
fs.writeFileSync(path.join(core,'config.toml'),`model="deepseek-v4.1-flash"\nmodel_provider="offline_fixture"\nmodel_auto_compact_token_limit=75000\nmodel_catalog_json=${JSON.stringify(path.resolve('own/defaults/models.json'))}\n[model_providers.offline_fixture]\nname="Direct compaction fixture"\nbase_url=${JSON.stringify(server.url)}\nwire_api="responses"\nrequires_openai_auth=false\n`,{flag:'wx',mode:0o600});
const cli=path.join(app,'Contents/Resources/codex-own-cli'),env={...process.env,CODEX_HOME:core,HOME:root};for(const k of Object.keys(env))if(/^(OPENAI_|CHATGPT_|ELECTRON_|NODE_REPL_|BASH_ENV$|ZDOTDIR$|NODE_OPTIONS$)/.test(k))delete env[k];
const child=spawn(cli,['app-server','--stdio'],{env,stdio:['pipe','pipe','pipe']});let id=0,buffer='',stderr='',active;const pending=new Map();
const fail=error=>{for(const p of pending.values())p.reject(error);pending.clear();active?.reject(error);};
child.on('error',fail);child.on('exit',()=>fail(Error('CLI exited: '+stderr)));child.stderr.on('data',c=>stderr=(stderr+c).slice(-3000));
child.stdout.on('data',c=>{buffer+=c;let i;while((i=buffer.indexOf('\n'))>=0){let m;try{m=JSON.parse(buffer.slice(0,i));}catch{}buffer=buffer.slice(i+1);if(!m)continue;const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}if(m.method==='turn/completed'&&active){const a=active;active=null;m.params.turn.status==='completed'?a.resolve():a.reject(Error(JSON.stringify(m.params.turn)));}}});
const call=(method,params)=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
const timer=setTimeout(()=>fail(Error('Compaction timeout: '+stderr)),60000);
try{
 await call('initialize',{clientInfo:{name:'direct-compaction-acceptance',version:'1'},capabilities:{experimentalApi:true}});child.stdin.write('{"method":"initialized"}\n');
 const thread=await call('thread/start',{cwd:root,approvalPolicy:'never',sandbox:'danger-full-access'});
 const image='data:image/png;base64,'+fs.readFileSync(path.resolve('resources/own/codex-own.png')).toString('base64');
 for(const input of [[{type:'text',text:'Remember the image task.',text_elements:[]},{type:'image',url:image}],[{type:'text',text:'Continue the same task and execute the native tool.',text_elements:[]}]]){
  const done=new Promise((resolve,reject)=>{active={resolve,reject};});done.catch(()=>{});await call('turn/start',{threadId:thread.thread.id,input});await done;
 }
 if(fixtureError)throw fixtureError;assert.equal(requests,5);assert.ok(sawImage);
 await call('thread/resume',{threadId:thread.thread.id,cwd:root});
 console.log(JSON.stringify({ok:true,requests,sameThread:true,imageInput:true,localCompaction:true,compactionOverflowRetry:true,nativeToolAfterCompaction:true,resume:true,realCredentialsUsed:false,profile:root}));
}finally{clearTimeout(timer);child.kill();child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();await server.close();}
