// Launch only the supplied candidate against a new profile and verified tools.
// macOS uses Chromium's test-only mock keychain; never access real keychain items.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import net from 'node:net';import assert from 'node:assert/strict';import {spawn,execFileSync} from 'node:child_process';
import {installRuntime} from '../lib/tool-runtime.mjs';
import {createRequire} from 'node:module';
import {nativeDeviceContract} from './native-device-contract.mjs';
const app=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]),mac=process.platform==='darwin';
if(fs.existsSync(out))throw Error('Choose a fresh GUI evidence directory');fs.mkdirSync(out,{recursive:true});
// Darwin Unix-domain socket paths are limited to roughly 104 bytes.
const home=fs.realpathSync(fs.mkdtempSync(path.join(mac?'/private/tmp':os.tmpdir(),'og-')));
const local=path.join(home,'AppData/Local'),root=mac?path.join(home,'Library/Application Support/codex-own-independent'):path.join(local,'codex-own-independent');
const resources=path.join(app,mac?'Contents/Resources':'resources'),bundle=path.join(resources,'own-updater');
const embedded=JSON.parse(fs.readFileSync(path.join(bundle,'release.json'))),meta=JSON.parse(fs.readFileSync(path.join(bundle,'desktop-version.json')));
assert.equal(embedded.runtimes.version,meta.toolRuntimeVersion);
if(process.env.OWN_GUI_MANIFEST){
 const source=path.resolve(process.env.OWN_GUI_MANIFEST),target=path.join(out,'verified-manifest.json');fs.statSync(source);assert.ok(!fs.existsSync(target));
 const manifest=JSON.parse(fs.readFileSync(source));assert.equal(manifest.version,meta.version);assert.equal(manifest.platforms[`${process.platform}-${process.arch}`]?.entry,path.basename(app));
 fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);
}
if(mac)assert.ok(Buffer.byteLength(path.join(root,'core/ipc/ipc.sock'))<104,'GUI fixture IPC path is too long');
if(process.argv[4]){
 const cache=path.resolve(process.argv[4]),dest=path.join(root,'runtimes/npm-assets');assert.ok(fs.lstatSync(cache).isDirectory());fs.mkdirSync(dest,{recursive:true});
 for(const name of fs.readdirSync(cache).filter(n=>/^[a-f0-9]{64}\.bin$/.test(n)))fs.copyFileSync(path.join(cache,name),path.join(dest,name),fs.constants.COPYFILE_EXCL);
 // installRuntime rechecks every cached content-addressed part before reuse.
}
await installRuntime(embedded.runtimes,{p:{root,manager:path.join(root,'manager'),core:path.join(root,'core'),desktop:path.join(root,'desktop'),target:app,platform:`${process.platform}-${process.arch}`},report:m=>console.error(m)});
// Exercise the API-mode workbench with a fixture credential and a loopback-only
// provider. The separate protocol fixture verifies successful model responses.
const core=path.join(root,'core');fs.mkdirSync(core,{recursive:true});
fs.writeFileSync(path.join(core,'auth.json'),JSON.stringify({auth_mode:'apikey',OPENAI_API_KEY:'sk-fixture-only-no-service-access'}),{flag:'wx',mode:0o600});
fs.writeFileSync(path.join(core,'config.toml'),`cli_auth_credentials_store = "file"\nforced_login_method = "api"\nmodel = "deepseek-v4.1-flash"\nmodel_provider = "offline_fixture"\nmodel_catalog_json = ${JSON.stringify(path.resolve('own/defaults/models.json'))}\n[model_providers.offline_fixture]\nname = "Offline GUI fixture"\nbase_url = "http://127.0.0.1:9/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`,{flag:'wx',mode:0o600});
const reservation=net.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
const env={...process.env};for(const k of Object.keys(env))if(/^(CODEX_|OPENAI_|CHATGPT_|ELECTRON_|NODE_REPL_|DASHSCOPE_|ANTHROPIC_|AZURE_OPENAI_|GH_TOKEN$|GITHUB_TOKEN$)/.test(k))delete env[k];
Object.assign(env,{HOME:home,CFFIXED_USER_HOME:home,USERPROFILE:home,LOCALAPPDATA:local,APPDATA:path.join(home,'AppData/Roaming'),ELECTRON_ENABLE_LOGGING:'1'});
for(const directory of [env.APPDATA,env.LOCALAPPDATA])fs.mkdirSync(directory,{recursive:true});
const executable=path.join(app,mac?'Contents/MacOS/codex-own-launch':'codex-own.exe');
const log=fs.openSync(path.join(out,'desktop.log'),'wx');
const child=spawn(executable,[...(mac?['--use-mock-keychain']:[]),`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1',`--user-data-dir=${path.join(root,'desktop')}`,'--disable-gpu','--no-first-run'],{env,detached:mac,windowsHide:true,stdio:['ignore',log,log]});
let launchError;child.on('error',e=>{launchError=e});let socket,id=0;const pending=new Map(),events=[];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
try{
 let target;const deadline=Date.now()+120000;
 while(Date.now()<deadline){
  if(launchError)throw launchError;if(child.exitCode!==null)throw Error('Desktop exited before renderer became ready: '+child.exitCode);
  try{const list=await(await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(2000)})).json();target=list.find(t=>t.type==='page'&&/^(file|app|codex-own):/.test(t.url)&&!t.url.includes('update.html'));if(target)break;}catch{}
  await delay(500);
 }
 if(!target)throw Error('No main desktop renderer observed; see desktop.log');
 socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});
 socket.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(m.method==='Runtime.exceptionThrown'||m.method==='Log.entryAdded')events.push(m);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}});
 const call=(method,params={})=>new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error('CDP timeout '+method))},10000);pending.set(key,{resolve,reject,timer});socket.send(JSON.stringify({id:key,method,params}));});
 await call('Runtime.enable');await call('Log.enable');
 let state;for(let i=0;i<180;i++){const result=await call('Runtime.evaluate',{expression:'JSON.stringify({title:document.title,url:location.href,ready:document.readyState,buttons:document.querySelectorAll("button").length,composer:document.querySelectorAll("textarea,[contenteditable=true]").length,text:document.body?.innerText||"",elements:document.body?.querySelectorAll("*").length||0,html:document.body?.innerHTML.slice(0,5000),policy:globalThis.codexOwnProductPolicy})',returnByValue:true});state=JSON.parse(result.result.value);if(state.ready==='complete'&&state.buttons>=5&&state.composer>=1&&state.text.trim().length>30)break;await delay(500);}
 const screenshot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'desktop.png'),Buffer.from(screenshot.data,'base64'),{flag:'wx'});
 fs.writeFileSync(path.join(out,'renderer.json'),JSON.stringify({...state,text:state.text.slice(0,2000)},null,2),{flag:'wx'});
 assert.equal(state.ready,'complete');assert.ok(state.buttons>=5&&state.composer>=1&&state.text.trim().length>30,'Desktop workbench did not become interactive');
 if(!mac){
  const asar=createRequire(import.meta.url)('@electron/asar'),archive=path.join(resources,'app.asar');
  const bridges=asar.listPackage(archive).map(n=>n.replaceAll('\\','/').replace(/^\//,'')).filter(n=>/^webview\/assets\/codex-micro-bridge-[\w-]+\.js$/.test(n));
  assert.equal(bridges.length,1,'Expected one native device bridge');
  const contract=nativeDeviceContract(asar.extractFile(archive,bridges[0].replaceAll('/',path.sep)).toString());
  const result=await call('Runtime.evaluate',{expression:`(async()=>{const api=(await import(${JSON.stringify('app://-'+contract.module)}))[${JSON.stringify(contract.binding)}];if(api?.codexMicro==null)throw Error('Native device host service unavailable');await api.codexMicro.getState();await new Promise(r=>setTimeout(r,1500));const state=await api.codexMicro.getState();return JSON.stringify({runtime:'official Owl',status:state.status,error:state.error,physicalDeviceCommunicationTested:false});})()`,awaitPromise:true,returnByValue:true});
  assert.ok(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));const native=JSON.parse(result.result.value);
  fs.writeFileSync(path.join(out,'native-device-service.json'),JSON.stringify(native,null,2),{flag:'wx'});
  assert.ok(['not-detected','detected','connected'].includes(native.status),'Native device discovery failed');assert.equal(native.error,null);
 }
 assert.equal(events.filter(e=>e.method==='Runtime.exceptionThrown').length,0,'Renderer raised an unhandled exception');
 console.log(JSON.stringify({ok:true,platform:process.platform,nativeDesktopLaunched:true,rendererHydrated:true,workbenchControlsAndComposer:true,screenshot:path.join(out,'desktop.png'),profile:root,realCredentialsUsed:false,interactiveFeaturesTested:false}));
}finally{
 socket?.close();for(const p of pending.values())clearTimeout(p.timer);
 fs.writeFileSync(path.join(out,'renderer-events.json'),JSON.stringify(events,null,2),{flag:'wx'});
 if(mac){
  // Owl starts application processes outside the launcher's process group.
  // Bind cleanup to this candidate and its unique test profile, then include
  // descendants before terminating the launch process.
  const rows=execFileSync('ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).split('\n').map(l=>l.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)).filter(Boolean).map(m=>({pid:+m[1],parent:+m[2],command:m[3]}));
  const owned=new Set([child.pid,...rows.filter(r=>r.command.startsWith(app+path.sep)&&r.command.includes(root)).map(r=>r.pid)]);
  for(let changed=true;changed;){changed=false;for(const r of rows)if(owned.has(r.parent)&&!owned.has(r.pid)){owned.add(r.pid);changed=true;}}
  for(const pid of [...owned].reverse())try{process.kill(pid,'SIGTERM')}catch{}
 }else{try{execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'pipe',timeout:10000})}catch{child.kill()}}
 fs.closeSync(log);
}
