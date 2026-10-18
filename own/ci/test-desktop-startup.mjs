// Launch only the supplied candidate against a new profile and verified tools.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import net from 'node:net';import assert from 'node:assert/strict';import {spawn,execFileSync} from 'node:child_process';
import {installRuntime} from '../lib/tool-runtime.mjs';
const app=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]),mac=process.platform==='darwin';
if(fs.existsSync(out))throw Error('Choose a fresh GUI evidence directory');fs.mkdirSync(out,{recursive:true});
const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'own-desktop-smoke-')));
const local=path.join(home,'AppData/Local'),root=mac?path.join(home,'Library/Application Support/codex-own-independent'):path.join(local,'codex-own-independent');
const resources=path.join(app,mac?'Contents/Resources':'resources'),bundle=path.join(resources,'own-updater');
const embedded=JSON.parse(fs.readFileSync(path.join(bundle,'release.json'))),meta=JSON.parse(fs.readFileSync(path.join(bundle,'desktop-version.json')));
assert.equal(embedded.runtimes.version,meta.toolRuntimeVersion);
await installRuntime(embedded.runtimes,{p:{root,manager:path.join(root,'manager'),core:path.join(root,'core'),desktop:path.join(root,'desktop'),target:app,platform:`${process.platform}-${process.arch}`},report:m=>console.error(m)});
const reservation=net.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
const env={...process.env};for(const k of Object.keys(env))if(/^(CODEX_|OPENAI_|CHATGPT_|ELECTRON_|NODE_REPL_)/.test(k))delete env[k];
Object.assign(env,{HOME:home,USERPROFILE:home,LOCALAPPDATA:local,APPDATA:path.join(home,'AppData/Roaming'),ELECTRON_ENABLE_LOGGING:'1'});
const executable=path.join(app,mac?'Contents/MacOS/codex-own-launch':'codex-own.exe');
const log=fs.openSync(path.join(out,'desktop.log'),'wx');
const child=spawn(executable,[`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1',`--user-data-dir=${path.join(root,'desktop')}`,'--disable-gpu','--no-first-run'],{env,detached:mac,windowsHide:true,stdio:['ignore',log,log]});
let launchError;child.on('error',e=>{launchError=e});let socket,id=0;const pending=new Map();
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
 socket.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}});
 const call=(method,params={})=>new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error('CDP timeout '+method))},10000);pending.set(key,{resolve,reject,timer});socket.send(JSON.stringify({id:key,method,params}));});
 let state;for(let i=0;i<40;i++){const result=await call('Runtime.evaluate',{expression:'JSON.stringify({title:document.title,url:location.href,ready:document.readyState,text:document.body?.innerText||"",elements:document.body?.querySelectorAll("*").length||0})',returnByValue:true});state=JSON.parse(result.result.value);if(state.ready==='complete'&&state.elements>20&&state.text.trim().length>15)break;await delay(500);}
 assert.equal(state.ready,'complete');assert.ok(state.elements>20&&state.text.trim().length>15,'Renderer did not hydrate');
 const screenshot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'desktop.png'),Buffer.from(screenshot.data,'base64'),{flag:'wx'});
 fs.writeFileSync(path.join(out,'renderer.json'),JSON.stringify({...state,text:state.text.slice(0,2000)},null,2),{flag:'wx'});
 console.log(JSON.stringify({ok:true,platform:process.platform,nativeDesktopLaunched:true,rendererHydrated:true,screenshot:path.join(out,'desktop.png'),profile:root,realCredentialsUsed:false,interactiveFeaturesTested:false}));
}finally{
 socket?.close();for(const p of pending.values())clearTimeout(p.timer);
 if(mac){try{process.kill(-child.pid,'SIGTERM')}catch{child.kill()}}else{try{execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'pipe',timeout:10000})}catch{child.kill()}}
 fs.closeSync(log);
}
