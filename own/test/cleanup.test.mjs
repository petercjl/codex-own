import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync,spawn,spawnSync} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {payloadURL,assembleNpmAsset} from '../lib/npm-assets.mjs';
const moduleURL=process.env.OWN_CLEANUP_MODULE?pathToFileURL(process.env.OWN_CLEANUP_MODULE):new URL('../lib/cleanup.mjs',import.meta.url);
const {planCleanup,runCleanup,cleanupAfterHealthyStartup,activeCleanupRoots,CLEANUP_POLICY}=await import(moduleURL);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const put=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));return file;};
function fixture(t){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'own-cleanup-中文-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:200}));
 const p={root,manager:path.join(root,'manager'),core:path.join(root,'core'),desktop:path.join(root,'desktop'),target:path.join(root,'programs','current'),platform:process.platform+'-'+process.arch};
 const identify=dir=>JSON.parse(fs.readFileSync(path.join(dir,'codex-own-build.json'))).identity;
 const app=dir=>{put(path.join(dir,'codex-own-build.json'),{identity:'local.codex-own'});put(path.join(dir,'program.bin'),'application bytes');};app(p.target);
 const manifest=(v='0.6.4',data=Buffer.from('archive'))=>{const h=sha(data);return {schema:2,repository:'petercjl/codex-own',version:v,platforms:{[p.platform]:{entry:p.platform.startsWith('darwin-')?'codex-own.app':'app',size:data.length,sha256:h,parts:[{sha256:h,size:data.length,archiveSha256:h,archiveSize:data.length,url:payloadURL(h)}]}}};};
 const m=manifest(),s={schema:1,identity:'local.codex-own',version:'0.6.4',target:p.target,desktop:{version:'0.6.4',identity:m.platforms[p.platform].sha256},releaseManifest:m,previous:null};
 const save=()=>put(path.join(p.manager,'state.json'),s);save();
 put(path.join(p.target,p.platform.startsWith('darwin-')?'Contents/Resources':'resources','own-updater','desktop-version.json'),{version:s.version});
 put(path.join(p.core,'auth.json'),'private-key-placeholder');put(path.join(p.core,'sessions','current.jsonl'),'current conversation');put(path.join(root,'runtimes','active.json'),'private runtime selection');
 const options={p,identify,processRoots:()=>[]};
 function past(v,{keep=false,complete=true}={}){
  const id=crypto.randomUUID(),old=path.join(path.dirname(p.target),'.codex-own-backup-'+id),backup=path.join(p.manager,'backups',id);app(old);put(path.join(backup,'data','core','snapshot'),'old private snapshot');
  const journal=put(path.join(p.manager,'transaction-'+id+'.json'),{target:p.target,old,backup,version:keep?s.version:v});if(complete)put(journal.replace('.json','.complete.json'),{ok:true});
  if(keep){s.previous={app:old,data:path.join(backup,'data'),state:{version:v}};save();}return {old,backup,journal};
 }
 function prepared(v,{applied=false,data=Buffer.from('archive'),bad=false}={}){
  const dir=path.join(p.manager,'prepared','update-'+crypto.randomUUID().replaceAll('-',''));const receipt=path.join(dir,'receipt.json');
  put(receipt,bad?'invalid':{schema:1,current:'0.6.1',version:v,platform:p.platform,manifest:manifest(v,data)});const archive=put(path.join(dir,'desktop.tar.gz'),data);
  if(applied)put(receipt+'.applied.json',{ok:true,version:v});return {dir,receipt,archive,hash:sha(data)};
 }
 function block(data,age=0){const hash=sha(data),file=put(path.join(p.manager,'npm-assets',hash+'.bin'),data);if(age)fs.utimesSync(file,new Date(age),new Date(age));return {file,hash};}
 function helper({success=true,active=false,newReceipt=false,dead=false}={}){
  const dir=path.join(p.manager,'handoffs','apply-'+crypto.randomUUID().replaceAll('-',''));
  put(path.join(dir,'runtime','desktop-version.json'),{version:'0.6.3',updaterContract:2,source:'https://registry.npmjs.org/@petercjl%2fcodex-own/latest'});
  const ready={ready:true};if(newReceipt){const receipt=prepared('0.6.4',{applied:true}).receipt;Object.assign(ready,{schema:2,pid:dead?spawnSync(process.execPath,['-e',''],{windowsHide:true}).pid:process.pid,current:'0.6.3',receipt,resultFile:path.join(p.manager,'update-result-'+crypto.randomUUID()+'.json')});put(ready.resultFile,{ok:success,version:'0.6.4',target:p.target});}
  put(path.join(dir,'runtime','handoff-ready.json'),ready);put(path.join(dir,'install.log'),JSON.stringify({result:{ok:success,version:'0.6.4',target:p.target}})+'\n');
  return {dir,active};
 }
 return {p,s,save,manifest,options,past,prepared,block,helper,app};
}
test('no boot confirmation, a changed install, and incomplete transactions never authorize deletion',async t=>{
 const a=fixture(t),r=a.prepared('0.6.2',{applied:true});assert.equal(planCleanup(a.options).reason,'HEALTH_NOT_CONFIRMED');
 const result=await runCleanup(a.options);assert.equal(result.deferred,true);assert.ok(fs.existsSync(r.archive));
 await assert.rejects(cleanupAfterHealthyStartup('0.6.3',a.options),{code:'INSTALLATION_CHANGED'});
 a.past('0.6.2',{complete:false});const blocked=await cleanupAfterHealthyStartup('0.6.4',a.options);assert.equal(blocked.reason,'INCOMPLETE_TRANSACTION');assert.ok(fs.existsSync(r.archive));
});
test('healthy startup reclaims applied archives and obsolete complete backups, preserving one complete rollback and live user data',async t=>{
 const a=fixture(t),old=a.past('0.6.2'),keep=a.past('0.6.3',{keep:true}),r=a.prepared('0.6.2',{applied:true});
 const protectedFiles=[path.join(a.p.core,'auth.json'),path.join(a.p.core,'sessions','current.jsonl'),path.join(a.p.root,'runtimes','active.json'),path.join(keep.backup,'data','core','snapshot')],hashes=protectedFiles.map(f=>sha(fs.readFileSync(f)));
 const result=await cleanupAfterHealthyStartup('0.6.4',a.options);assert.equal(result.ok,true);assert.ok(result.reclaimedBytes>0);
 assert.equal(fs.existsSync(r.archive),false);assert.ok(fs.existsSync(r.receipt));assert.equal(fs.existsSync(old.old),false);assert.equal(fs.existsSync(old.backup),false);assert.ok(fs.existsSync(keep.old));
 assert.deepEqual(protectedFiles.map(f=>sha(fs.readFileSync(f))),hashes);assert.ok(fs.existsSync(result.report));
 const again=await runCleanup(a.options);assert.equal(again.removed.length,0);
});
test('pending and future receipts pin their blocks; missing or malformed receipts protect the cache conservatively',async t=>{
 const a=fixture(t),pending=a.prepared('0.6.5',{data:Buffer.from('pending update')}),future=a.prepared('0.6.6',{applied:true,data:Buffer.from('future update')});
 const pin=a.block(Buffer.from('pending update'),1000),junk=a.block(Buffer.from('disposable'),2000);
 const r=await cleanupAfterHealthyStartup('0.6.4',{...a.options,cacheLimitBytes:0});assert.ok(fs.existsSync(pending.archive));assert.ok(fs.existsSync(future.archive));assert.ok(fs.existsSync(pin.file));assert.equal(fs.existsSync(junk.file),false);assert.equal(r.cacheLimitExceeded,true);assert.equal(r.cacheProtection,'PENDING_UPDATE');
 a.prepared('0.6.5',{bad:true});const extra=a.block(Buffer.from('unknown receipt may need this'));
 const safe=await runCleanup({...a.options,cacheLimitBytes:0});assert.ok(fs.existsSync(extra.file));assert.equal(safe.cacheProtection,'UNKNOWN_RECEIPT');
});
test('LRU evicts only unused managed blocks and successful assembly refreshes their usage time',async t=>{
 const a=fixture(t),used=a.block(Buffer.from('used'),1000),old=a.block(Buffer.from('old!'),2000);put(path.join(a.p.manager,'npm-assets','user-note.txt'),'keep');
 const m=a.manifest('0.6.4',Buffer.from('used')),asset=m.platforms[a.p.platform];
 await assembleNpmAsset(asset,path.join(a.p.root,'assembled.tar'),path.join(a.p.manager,'npm-assets'),'unused-tar',{report:()=>{},download:()=>{throw Error('Unexpected network');}});
 assert.ok(fs.statSync(used.file).mtimeMs>fs.statSync(old.file).mtimeMs);
 const result=await cleanupAfterHealthyStartup('0.6.4',{...a.options,cacheLimitBytes:4});assert.equal(fs.existsSync(old.file),false);assert.ok(fs.existsSync(used.file));assert.equal(result.cacheBytesAfter,4);assert.ok(fs.existsSync(path.join(a.p.manager,'npm-assets','user-note.txt')));
});
test('active old apps keep their paired data backup; completed inactive helpers are reclaimed and failed/live helpers stay',async t=>{
 const a=fixture(t),old=a.past('0.6.2'),done=a.helper(),failed=a.helper({success:false}),active=a.helper({active:true}),pid=a.helper({newReceipt:true}),dead=a.helper({newReceipt:true,dead:true});
 const r=await cleanupAfterHealthyStartup('0.6.4',{...a.options,processRoots:()=>[old.old,active.dir]});
 assert.equal(r.ok,true);assert.ok(fs.existsSync(old.old));assert.ok(fs.existsSync(old.backup));assert.equal(fs.existsSync(done.dir),false);assert.equal(fs.existsSync(dead.dir),false);assert.ok(fs.existsSync(failed.dir));assert.ok(fs.existsSync(active.dir));assert.ok(fs.existsSync(pid.dir));
});
test('unknown journal paths, unrelated backups and rollback-recovery material are preserved',async t=>{
 const a=fixture(t),old=a.past('0.6.2'),j=JSON.parse(fs.readFileSync(old.journal));j.old=path.join(a.p.root,'unrelated');put(old.journal,j);put(path.join(a.p.manager,'backups','manual','snapshot'),'keep');put(path.join(a.p.root,'core.before-rollback-user','auth.json'),'preserve');
 await cleanupAfterHealthyStartup('0.6.4',a.options);assert.ok(fs.existsSync(old.old));assert.ok(fs.existsSync(old.backup));assert.ok(fs.existsSync(path.join(a.p.manager,'backups','manual','snapshot')));assert.ok(fs.existsSync(path.join(a.p.root,'core.before-rollback-user','auth.json')));
});
test('a broken latest rollback and unavailable process inspection defer cleanup instead of sacrificing recovery',async t=>{
 const a=fixture(t);await cleanupAfterHealthyStartup('0.6.4',a.options);const old=a.past('0.6.2'),keep=a.past('0.6.3',{keep:true});fs.rmSync(path.join(keep.backup,'data'),{recursive:true});
 assert.equal((await runCleanup(a.options)).reason,'ROLLBACK_INCOMPLETE');assert.ok(fs.existsSync(old.old));
 a.s.previous=null;a.save();const r=await runCleanup({...a.options,processRoots:()=>{throw Error('cannot inspect');}});assert.equal(r.reason,'PROCESS_INSPECTION_UNAVAILABLE');assert.deepEqual(r.actions,[]);assert.ok(fs.existsSync(old.old));
});
test('operation locks refuse concurrent cleanup and linked owned paths never escape into another directory',async t=>{
 const a=fixture(t);await cleanupAfterHealthyStartup('0.6.4',a.options);const lock=put(path.join(a.p.manager,'operation.lock'),'owned test lock');assert.equal(planCleanup(a.options).reason,'BUSY');await assert.rejects(runCleanup(a.options),{code:'BUSY'});fs.unlinkSync(lock);
 const old=a.past('0.6.2');fs.rmSync(old.old,{recursive:true});const outside=path.join(a.p.root,'external');put(path.join(outside,'important'),'keep');fs.symlinkSync(outside,old.old,process.platform==='win32'?'junction':'dir');
 await assert.rejects(runCleanup(a.options),{code:'UNSAFE_PATH'});assert.equal(fs.readFileSync(path.join(outside,'important'),'utf8'),'keep');
});
test('startup and cleanup diagnostic histories are bounded while current health confirmation stays usable',async t=>{
 const a=fixture(t);for(let i=0;i<25;i++)await cleanupAfterHealthyStartup('0.6.4',a.options);
 assert.ok(fs.readdirSync(path.join(a.p.manager,'cleanup-reports')).length<=CLEANUP_POLICY.reportLimit);assert.ok(fs.readdirSync(path.join(a.p.manager,'health')).length<=CLEANUP_POLICY.reportLimit);assert.equal(planCleanup(a.options).deferred,undefined);
});
async function readyChild(executable,args){
 const child=spawn(executable,args,{windowsHide:true,stdio:['pipe','pipe','pipe']});
 try{await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('Probe process did not become ready')),10000);child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',()=>{clearTimeout(timer);reject(Error('Probe exited before readiness'));});child.stdout.on('data',b=>{text+=b;if(text.includes('READY')){clearTimeout(timer);resolve();}});});}
 catch(e){child.kill();throw e;}
 return child;
}
async function stopChild(child){if(child.exitCode!==null||child.signalCode!==null)return;const close=new Promise(resolve=>child.once('close',resolve));child.kill();await close;}
test('native process inspection protects an actually running owned program and its paired snapshot',async t=>{
 const a=fixture(t),old=a.past('0.6.2');let executable=process.execPath;
 if(process.platform==='win32'){executable=path.join(old.old,'node.exe');fs.copyFileSync(process.execPath,executable,fs.constants.COPYFILE_EXCL);}
 const child=await readyChild(executable,['-e','console.log("READY");setInterval(()=>{},1000)',path.join(old.old,'process-marker')]);
 try{
  assert.ok(activeCleanupRoots([old.old]).includes(old.old));
  const r=await cleanupAfterHealthyStartup('0.6.4',{...a.options,processRoots:activeCleanupRoots});assert.equal(r.ok,true);assert.ok(fs.existsSync(old.old));assert.ok(fs.existsSync(old.backup));
 }finally{await stopChild(child);}
});
test('Windows file locks are reported without failing the update or deleting the protected recovery data',{skip:process.platform!=='win32'},async t=>{
 const a=fixture(t),keep=a.past('0.6.3',{keep:true}),r=a.prepared('0.6.2',{applied:true});
 const ps="$ErrorActionPreference='Stop';$f=[IO.File]::Open('"+r.archive.replaceAll("'","''")+"',[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None);[Console]::WriteLine('READY');[Console]::ReadLine() | Out-Null;$f.Dispose()";
 const child=await readyChild('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')]);
 try{const result=await cleanupAfterHealthyStartup('0.6.4',a.options);assert.equal(result.ok,true);assert.ok(result.warnings.some(w=>w.path===r.archive));assert.ok(fs.existsSync(r.archive));assert.ok(fs.existsSync(keep.old));assert.ok(fs.existsSync(keep.backup));}
 finally{await stopChild(child);}
 const retry=await runCleanup(a.options);assert.equal(retry.ok,true);assert.equal(fs.existsSync(r.archive),false);
});
test('the installed CLI exposes preview and requires explicit confirmation and valid limits',()=>{
 const cli=process.env.OWN_CLEANUP_CLI||fileURLToPath(new URL('../bin/codex-own.mjs',import.meta.url));
 const call=args=>JSON.parse(execFileSync(process.execPath,[cli,...args],{encoding:'utf8',windowsHide:true}));
 assert.ok(call(['help']).commands.some(s=>s.startsWith('cleanup plan')));
 for(const [args,code]of [[['cleanup','run'],'CONFIRMATION_REQUIRED'],[['cleanup','plan','--cache-limit-mib','-1'],'INVALID_ARGUMENT'],[['cleanup','plan','--cache-limit-mib'],'INVALID_ARGUMENT']]){
  assert.throws(()=>call(args),e=>JSON.parse(e.stderr.toString()).code===code);
 }
 const preview=call(['cleanup','plan']);assert.equal(preview.ok,true);
});
