// Offline native-engine integration gate. A separate real-model VM smoke verifies model choice.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
export function pendingShellSession(input){
 const last=(input||[]).filter(x=>x.type==='function_call_output').at(-1);
 const output=typeof last?.output==='string'?last.output:JSON.stringify(last?.output??'');
 const match=output.match(/Process running with session ID\s+(\d+)/i);
 return match?Number(match[1]):null;
}
export async function verifyWindowsAgentShell({cli,adapterPath,catalog,timeout=90000}){
 assert.equal(process.platform,'win32');
 const require=createRequire(import.meta.url),adapter=require(adapterPath),cp=require('node:child_process'),home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'own-shell-native-'))),selection=adapter.discover();
 assert.ok(selection.bash,'Native Windows QA requires Git Bash');assert.ok(selection.powershell,'Native Windows QA requires PowerShell');
 fs.copyFileSync(catalog,path.join(home,'models.json'),fs.constants.COPYFILE_EXCL);
 const configText=`model = "deepseek-v4.1-flash"\nmodel_provider = "shell_fixture"\nmodel_catalog_json = ${JSON.stringify(path.join(home,'models.json').replaceAll('\\','/'))}\ndeveloper_instructions = "Keep baseline instructions from the private config."\n[features]\nunified_exec = true\n[model_providers.shell_fixture]\nname = "Offline shell integration fixture"\nbase_url = "PLACEHOLDER"\nwire_api = "responses"\nrequires_openai_auth = false\n`;
 const bodies=[],outputs=[];let requests=0,shells=0,serverError;
 const server=http.createServer(async(req,res)=>{
  try{let body='';for await(const c of req)body+=c;const parsed=JSON.parse(body);bodies.push(parsed);requests++;
   const tools=parsed.tools||[];assert.ok(tools.some(t=>t.name==='exec_command'),'Engine must expose explicit-shell exec_command');
   assert.ok(requests<=20,'Native shell fixture exceeded its bounded polling limit');
   const seq=requests,session=pendingShellSession(parsed.input);let args,name;
   if(session!==null){name='write_stdin';args={session_id:session,chars:'',yield_time_ms:1000,max_output_tokens:1000};}
   else if(shells<2){name='exec_command';args=shells++===0?{cmd:'printf "OWN_BASH_OK:%s\\n" "$BASH_VERSION"',shell:selection.bash,login:false,yield_time_ms:30000,max_output_tokens:1000}:{cmd:'Write-Output ("OWN_POWERSHELL_OK:" + $PSVersionTable.PSVersion.ToString())',shell:selection.powershell,login:false,yield_time_ms:30000,max_output_tokens:1000};}
   const item=name?{type:'function_call',id:'fc_'+seq,call_id:'call_'+seq,name,arguments:JSON.stringify(args)}:{type:'message',id:'msg_done',role:'assistant',status:'completed',content:[{type:'output_text',text:'Both native shell checks completed.',annotations:[]}]};
   res.writeHead(200,{'content-type':'text/event-stream'});const send=(type,data)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...data})+'\n\n');
   send('response.created',{response:{id:'resp_'+seq,status:'in_progress',output:[]}});send('response.output_item.added',{output_index:0,item});send('response.output_item.done',{output_index:0,item});send('response.completed',{response:{id:'resp_'+seq,status:'completed',output:[item],usage:{input_tokens:10,output_tokens:10,total_tokens:20}}});res.end();
  }catch(e){serverError=e;res.writeHead(500);res.end('fixture failure');}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const config=path.join(home,'config.toml');assert.ok(!fs.existsSync(config));fs.writeFileSync(config,configText.replace('PLACEHOLDER','http://127.0.0.1:'+server.address().port+'/v1'),{flag:'wx',mode:0o600});
 const env={...process.env};for(const k of Object.keys(env))if(/^(CODEX_|OPENAI_|CHATGPT_|ELECTRON_|NODE_REPL_)/.test(k))delete env[k];env.CODEX_HOME=home;
 adapter.install({cli,core:home,env});const child=cp.spawn(cli,['-c','features.code_mode_host=true','app-server','--stdio'],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});let buffer='',id=0;const pending=new Map();let resolveTurn,rejectTurn;
 const completed=new Promise((r,j)=>{resolveTurn=r;rejectTurn=j});completed.catch(()=>{});
 child.stdout.on('data',b=>{buffer+=b;for(;;){const i=buffer.indexOf('\n');if(i<0)break;const line=buffer.slice(0,i);buffer=buffer.slice(i+1);let m;try{m=JSON.parse(line)}catch{continue;}const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}if(m.method==='turn/completed')m.params.turn.status==='completed'?resolveTurn():rejectTurn(Error(JSON.stringify(m.params.turn)));if(m.method==='item/completed')outputs.push(m.params.item);}});
 let stderr='';child.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-4000)});const fail=e=>{for(const p of pending.values())p.reject(e);rejectTurn(e)};child.on('error',fail);child.on('exit',()=>fail(Error('Native CLI exited before shell gate completed: '+stderr)));
 const timer=setTimeout(()=>fail(Error('Native shell QA timeout: '+stderr)),timeout),call=(method,params)=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
 try{
  await call('initialize',{clientInfo:{name:'own-shell-native-qa',title:'Own shell native QA',version:'1.0.0'},capabilities:{experimentalApi:true}});child.stdin.write('{"method":"initialized"}\n');
  const started=await call('thread/start',{cwd:home,approvalPolicy:'never',sandbox:'danger-full-access'});
  await call('turn/start',{threadId:started.thread.id,input:[{type:'text',text:'Run the two read-only shell checks.',text_elements:[]}]});await completed;if(serverError)throw serverError;
  const wire=JSON.stringify(bodies),toolOutputs=JSON.stringify(bodies.at(-1)?.input?.filter(x=>x.type==='function_call_output')||[]);assert.ok(wire.includes('codex-own-windows-shell-policy'));assert.ok(wire.includes('Keep baseline instructions'));assert.match(toolOutputs,/OWN_BASH_OK:[0-9]/);assert.match(toolOutputs,/OWN_POWERSHELL_OK:[0-9]/);
  await call('thread/resume',{threadId:started.thread.id,cwd:home});await call('thread/fork',{threadId:started.thread.id,cwd:home});
  return {ok:true,gitBash:selection.bash,powershell:selection.powershell,requests,preservedBaseline:true,nativeBashExecuted:true,explicitPowerShellExecuted:true,startResumeFork:true,home};
 }finally{clearTimeout(timer);try{cp.execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'pipe',timeout:10000});}catch{child.kill();}child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();child.unref();cp[adapter.HOOK]?.restore();server.closeAllConnections();await new Promise(r=>server.close(r));}
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)console.log(JSON.stringify(await verifyWindowsAgentShell({cli:path.resolve(process.argv[2]),adapterPath:path.resolve(process.argv[3]),catalog:path.resolve(process.argv[4])})));
