// Offline native acceptance: parallel tools, interruption, backend restart,
// resumed history, then another parallel tool round. No real API credentials.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import http from 'node:http';
import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),bridge=require(process.env.OWN_AGENT_BRIDGE_MODULE||'../lib/subagent-bridge.cjs');
const app=path.resolve(process.argv[2]),root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'own-history-'))),core=path.join(root,'core');fs.mkdirSync(core);
let count=0,fixtureError,ready;const interruptedRequest=new Promise(r=>{ready=r;});
const patch=n=>'*** Begin Patch\n'+(n===1?'*** Add File: proof.txt\n+中文第一版':'*** Update File: proof.txt\n@@\n-中文第一版\n+中文恢复版')+'\n*** End Patch';
function assertPairs(input){
 for(let i=0;i<input.length;i++)if(['function_call','custom_tool_call'].includes(input[i].type)){
  const call=input[i],out=input[++i];assert.equal(out?.call_id,call.call_id,'Provider must receive each call immediately followed by its result');assert.equal(out.type,call.type+'_output');
 }
}
const upstream=http.createServer(async(req,res)=>{
 try{
  let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);count++;assert.ok(count<=4);assertPairs(body.input);
  if(count===2){assert.equal(body.input.filter(x=>/call_output$/.test(x.type)).length,2);ready();return;}
  const n=count===1?1:count===3?2:0;
  if(count===3)assert.equal(body.input.filter(x=>/call_output$/.test(x.type)).length,2,'Resume must retain actual earlier results');
  if(count===4)assert.equal(body.input.filter(x=>/call_output$/.test(x.type)).length,4);
  const output=n?[
   {type:'function_call',id:'fc_'+n,call_id:'exec_'+n,name:'exec_command',arguments:JSON.stringify({cmd:n===1?'printf "HISTORY_SHELL_OK\\n"':'cat proof.txt'})},
   {type:'reasoning',id:'reason_'+n,summary:[],content:[{type:'reasoning_text',text:'Continue with the other tool while the shell is pending.'}]},
   {type:'custom_tool_call',id:'ct_'+n,call_id:'patch_'+n,name:'apply_patch',input:JSON.stringify({data:patch(n)})}
  ]:[{type:'message',id:'final',role:'assistant',content:[{type:'output_text',text:'HISTORY_RESUME_OK',annotations:[]}]}];
  res.writeHead(200,{'content-type':'text/event-stream'});const send=(type,data)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...data})+'\n\n');
  send('response.created',{response:{id:'r_'+count,status:'in_progress',output:[]}});
  output.forEach((item,output_index)=>{send('response.output_item.added',{output_index,item});send('response.output_item.done',{output_index,item});});
  send('response.completed',{response:{id:'r_'+count,status:'completed',output,usage:{input_tokens:10,output_tokens:10,total_tokens:20}}});res.end();
 }catch(error){fixtureError=error;res.writeHead(500);res.end('fixture failed');ready();}
});
await new Promise(r=>upstream.listen(0,'127.0.0.1',r));const server=await bridge.startServer({upstream:'http://127.0.0.1:'+upstream.address().port+'/v1',fetch});
fs.writeFileSync(path.join(core,'config.toml'),`model="deepseek-v4.1-flash"\nmodel_provider="offline_fixture"\nmodel_catalog_json=${JSON.stringify(path.resolve('own/defaults/models.json'))}\n[model_providers.offline_fixture]\nname="Offline history fixture"\nbase_url=${JSON.stringify(server.url)}\nwire_api="responses"\nrequires_openai_auth=false\n`,{flag:'wx',mode:0o600});
let backend;
function start(){
 const env={...process.env,CODEX_HOME:core,HOME:root};for(const k of Object.keys(env))if(/^(OPENAI_|CHATGPT_|ELECTRON_|NODE_REPL_|BASH_ENV$|ZDOTDIR$|NODE_OPTIONS$)/.test(k))delete env[k];
 const child=spawn(path.join(app,'Contents/Resources/codex-own-cli'),['app-server','--stdio'],{env,stdio:['pipe','pipe','pipe']});
 let id=0,buffer='',finished;const pending=new Map(),turn=new Promise(r=>{finished=r;});child.stderr.on('data',()=>{});
 child.stdout.on('data',c=>{buffer+=c;let i;while((i=buffer.indexOf('\n'))>=0){const m=JSON.parse(buffer.slice(0,i));buffer=buffer.slice(i+1);const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.j(Error(JSON.stringify(m.error))):p.r(m.result);}if(m.method==='turn/completed')finished(m.params.turn);}});
 return {child,turn,call:(method,params)=>new Promise((r,j)=>{pending.set(++id,{r,j});child.stdin.write(JSON.stringify({id,method,params})+'\n');}),stop:()=>new Promise(r=>{child.once('exit',r);child.kill();child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();})};
}
async function initialize(){backend=start();await backend.call('initialize',{clientInfo:{name:'history-resume-qa',version:'1'},capabilities:{experimentalApi:true}});backend.child.stdin.write('{"method":"initialized"}\n');}
const timer=setTimeout(()=>{console.error('History fixture timed out');process.exit(1);},60000);
try{
 await initialize();const thread=await backend.call('thread/start',{cwd:root,approvalPolicy:'never',sandbox:'workspace-write'});
 const turn=await backend.call('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:'Run parallel shell and patch tools.',text_elements:[]}]});
 await interruptedRequest;if(fixtureError)throw fixtureError;
 await backend.call('turn/interrupt',{threadId:thread.thread.id,turnId:turn.turn.id});assert.equal((await backend.turn).status,'interrupted');
 await backend.stop();backend=null;
 await initialize();await backend.call('thread/resume',{threadId:thread.thread.id,cwd:root,approvalPolicy:'never',sandbox:'workspace-write'});
 await backend.call('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:'Continue after restart.',text_elements:[]}]});assert.equal((await backend.turn).status,'completed');if(fixtureError)throw fixtureError;
 assert.equal(count,4);assert.equal(fs.readFileSync(path.join(root,'proof.txt'),'utf8'),'中文恢复版\n');
 console.log(JSON.stringify({ok:true,realNativeTools:true,parallelRounds:2,reasoningBetweenCalls:true,interruptedAndResumed:true,backendRestart:true,patchCreateAndUpdate:true,realCredentialsUsed:false,profile:root}));
}finally{clearTimeout(timer);if(backend)await backend.stop();await server.close();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));}
