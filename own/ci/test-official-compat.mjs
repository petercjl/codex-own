// Real bundled app-server operations against an offline Responses fixture.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const app=path.resolve(process.argv[2]),mac=process.platform==='darwin';
if(!mac){
 const require=createRequire(import.meta.url),base=path.join(app,'resources/app.asar.unpacked/node_modules/@worklouder/device-kit-oai/node_modules');
 const serial=require(path.join(base,'@serialport/bindings-cpp/build/Release/bindings.node')),hid=require(path.join(base,'node-hid/build/Release/HID.node'));
 assert.equal(typeof serial.list,'function');assert.equal(typeof hid.devices,'function');
 const ports=await new Promise((resolve,reject)=>serial.list((error,result)=>error?reject(error):resolve(result)));
 assert.ok(Array.isArray(ports));assert.ok(Array.isArray(hid.devices()));
 console.log(JSON.stringify({ok:true,windowsNativeDeviceBindingsLoaded:true,serialEnumeration:true,hidEnumeration:true,physicalDeviceInteractionTested:false}));
}
const home=fs.mkdtempSync(path.join(os.tmpdir(),'own-official-native-'));
let requests=0,fixtureError;
const server=http.createServer(async(req,res)=>{
 try{
  assert.match(req.url,/\/responses$/);let body='';for await(const b of req)body+=b;JSON.parse(body);requests++;
  assert.ok(requests<=6,'Unexpected repeated inference requests');
  const item={type:'message',id:'msg_'+requests,role:'assistant',status:'completed',content:[{type:'output_text',text:'OWN_COMPAT_OK',annotations:[]}]};
  res.writeHead(200,{'content-type':'text/event-stream'});
  const send=(type,data)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...data})}\n\n`);
  send('response.created',{response:{id:'resp_'+requests,status:'in_progress',output:[]}});
  send('response.output_item.added',{output_index:0,item});send('response.output_item.done',{output_index:0,item});
  send('response.completed',{response:{id:'resp_'+requests,status:'completed',output:[item],usage:{input_tokens:10,output_tokens:10,total_tokens:20}}});res.end();
 }catch(e){fixtureError=e;res.writeHead(500);res.end('fixture failure');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
fs.writeFileSync(path.join(home,'config.toml'),`model = "deepseek-v4.1-flash"\nmodel_provider = "offline_fixture"\ncli_auth_credentials_store = "file"\nmodel_catalog_json = ${JSON.stringify(path.resolve('own/defaults/models.json'))}\n[model_providers.offline_fixture]\nname = "Offline compatibility fixture"\nbase_url = "http://127.0.0.1:${server.address().port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`,{flag:'wx',mode:0o600});
const env={...process.env};for(const key of Object.keys(env))if(/^(CODEX_|OPENAI_|CHATGPT_|ELECTRON_|NODE_REPL_)/.test(key))delete env[key];env.CODEX_HOME=home;
const cli=path.join(app,mac?'Contents/Resources/codex-own-cli':'resources/codex.exe');
const child=spawn(cli,['app-server','--stdio'],{env,stdio:['pipe','pipe','pipe'],windowsHide:true});
let buffer='',id=0,stderr='',resolveTurn,rejectTurn;const pending=new Map(),notifications=[];
const turnDone=new Promise((resolve,reject)=>{resolveTurn=resolve;rejectTurn=reject});turnDone.catch(()=>{});
const fail=e=>{for(const p of pending.values())p.reject(e);rejectTurn(e)};
child.on('error',fail);child.on('exit',()=>fail(Error('Native app-server exited: '+stderr)));
child.stderr.on('data',b=>{stderr=(stderr+b).slice(-4000)});
child.stdout.on('data',b=>{buffer+=b;for(;;){const i=buffer.indexOf('\n');if(i<0)break;const line=buffer.slice(0,i);buffer=buffer.slice(i+1);let m;try{m=JSON.parse(line)}catch{continue}
 const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}
 if(m.method){notifications.push(m);if(m.method==='turn/completed')m.params.turn.status==='completed'?resolveTurn():rejectTurn(Error(JSON.stringify(m.params.turn)));}
}});
const call=(method,params)=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params})+'\n')});
const timer=setTimeout(()=>fail(Error('Native compatibility timeout: '+stderr)),120000);
try{
 await call('initialize',{clientInfo:{name:'own-official-compat',title:'Offline native compatibility',version:'1.0.0'},capabilities:{experimentalApi:true}});child.stdin.write('{"method":"initialized"}\n');
 const started=await call('thread/start',{cwd:home,approvalPolicy:'never',sandbox:'read-only'}),threadId=started.thread.id;
 await call('turn/start',{threadId,input:[{type:'text',text:'Reply OWN_COMPAT_OK.',text_elements:[]}]});await turnDone;if(fixtureError)throw fixtureError;
 assert.ok(requests>0);assert.match(JSON.stringify(notifications),/OWN_COMPAT_OK/);
 await call('thread/resume',{threadId,cwd:home});await call('thread/archive',{threadId});
 const archived=await call('thread/list',{archived:true,limit:100});assert.ok(archived.data.some(t=>t.id===threadId));
 await call('thread/delete',{threadId});const after=await call('thread/list',{archived:true,limit:100});assert.ok(!after.data.some(t=>t.id===threadId));
 console.log(JSON.stringify({ok:true,platform:process.platform,offlineResponsesTurn:true,startResumeArchiveDelete:true,requests,isolatedHome:home,realCredentialsUsed:false}));
}finally{
 clearTimeout(timer);child.kill();child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();server.closeAllConnections();await new Promise(r=>server.close(r));
}
