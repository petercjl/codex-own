import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import {execFileSync,spawn} from 'node:child_process';import {pathToFileURL} from 'node:url';
const lib=process.env.OWN_INSTALL_LIB||path.resolve(import.meta.dirname,'../lib');
const {copyNewDirectory,removeTemporary}=await import(pathToFileURL(path.join(lib,'file-operations.mjs')));
const {archiveNames,extractChecked}=await import(pathToFileURL(path.join(lib,'extraction.mjs')));
const {repairPlan,repairRun}=await import(pathToFileURL(path.join(lib,'maintenance.mjs')));
const {install,locked}=await import(pathToFileURL(path.join(lib,'manager.mjs')));
function fixture(t){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'own-install-中文-')));t.after(()=>fs.promises.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100}));const p={root,manager:path.join(root,'manager'),core:path.join(root,'core'),desktop:path.join(root,'desktop'),target:path.join(root,'apps','current'),platform:process.platform+'-'+process.arch};fs.mkdirSync(p.manager);return {root,p};}
test('strict new directory copy works on the real Node, refuses existing targets and cleans partial copies',t=>{
 const {root}=fixture(t),source=path.join(root,'source'),dest=path.join(root,'new');fs.mkdirSync(source);fs.writeFileSync(path.join(source,'item'),'content');
 copyNewDirectory(source,dest);assert.equal(fs.readFileSync(path.join(dest,'item'),'utf8'),'content');assert.throws(()=>copyNewDirectory(source,dest),{code:'EEXIST'});assert.equal(fs.readFileSync(path.join(dest,'item'),'utf8'),'content');
 const partial=path.join(root,'partial');assert.throws(()=>copyNewDirectory(source,partial,{copy:(s,d)=>{fs.writeFileSync(d,'partial');throw Error('copy interrupted');}}));assert.equal(fs.existsSync(partial),false);
});
test('CRLF inventories, missing files with a successful tar exit, and bounded extraction retry',t=>{
 const {root}=fixture(t),dest=path.join(root,'unpacked');let writes=0;
 const execute=(bin,args)=>{if(args[0]==='-tf')return 'app/\r\napp/main.dll\r\n';writes++;fs.mkdirSync(path.join(dest,'app'),{recursive:true});if(writes>1)fs.writeFileSync(path.join(dest,'app','main.dll'),'bytes');};
 const r=extractChecked(path.join(root,'app.tar'),dest,{tar:'fixture',execute,delay:()=>{}});assert.equal(r.attempts,2);assert.equal(writes,2);assert.equal(fs.existsSync(path.join(dest,'app/main.dll')),true);
 assert.deepEqual(archiveNames('app/\r\napp/a\r\n'),['app/','app/a']);for(const n of ['../private','/root','C:\\Windows\\a','app/../../b'])assert.throws(()=>archiveNames(n+'\n'),{code:'UNSAFE_ARCHIVE'});
});
test('persistent interception and tar failure cannot report extraction success',t=>{
 const {root}=fixture(t);let calls=0;
 const execute=(b,a)=>{if(a[0]==='-tf')return 'app/main.dll\r\n';calls++;};
 assert.throws(()=>extractChecked(path.join(root,'a.tar'),path.join(root,'out'),{tar:'fixture',execute,delay:()=>{}}),e=>e.code==='UNPACK_INCOMPLETE'&&e.missingCount===1&&e.missing[0]==='app/main.dll');assert.equal(calls,3);
 const dest=path.join(root,'nonzero');assert.throws(()=>extractChecked(path.join(root,'a.tar'),dest,{tar:'fixture',delay:()=>{},execute:(b,a)=>{if(a[0]==='-tf')return 'a\n';fs.writeFileSync(path.join(dest,'a'),'complete');throw Object.assign(Error('tar failed'),{status:1});}}),{code:'UNPACK_FAILED'});
});
test('an escaping link from partial extraction is refused before retry',t=>{
 const {root}=fixture(t),dest=path.join(root,'unsafe'),outside=path.join(root,'outside');fs.mkdirSync(outside);
 assert.throws(()=>extractChecked(path.join(root,'a.tar'),dest,{tar:'fixture',execute:(b,a)=>{if(a[0]==='-tf')return 'escape/file\n';fs.symlinkSync(outside,path.join(dest,'escape'),process.platform==='win32'?'junction':'dir');},delay:()=>{}}),{code:'UNSAFE_ARCHIVE'});assert.deepEqual(fs.readdirSync(outside),[]);
});
test('a failed installer checksum always removes its own stage and releases its lock',async t=>{
 const {root,p}=fixture(t),archive=path.join(root,'archive');fs.writeFileSync(archive,'bad');const hash='a'.repeat(64),manifest={schema:2,repository:'petercjl/codex-own',version:'0.6.5',platforms:{[p.platform]:{entry:p.platform.startsWith('darwin')?'codex-own.app':'app',size:3,sha256:hash,parts:[{sha256:hash,size:3,archiveSha256:hash,archiveSize:3,url:`https://registry.npmjs.org/@petercjl/codex-own/-/codex-own-0.0.0-payload.h${hash}.tgz`}]}}};
 await assert.rejects(install({p,manifest,archive,isRunning:()=>[]}),{code:'CHECKSUM_MISMATCH'});assert.deepEqual(fs.readdirSync(p.manager).filter(n=>n.startsWith('stage-')),[]);assert.equal(fs.existsSync(path.join(p.manager,'operation.lock')),false);
});
test('recovery removes inactive stages and a dead lock, preserving live data and unknown next directories',async t=>{
 const {p}=fixture(t),stage=path.join(p.manager,'stage-prior'),unknown=path.join(path.dirname(p.target),'.codex-own-next-'+crypto.randomUUID());fs.mkdirSync(stage);fs.writeFileSync(path.join(stage,'app.tar'),'disposable');fs.mkdirSync(p.core);fs.writeFileSync(path.join(p.core,'auth.json'),'fixture-credential');fs.mkdirSync(unknown,{recursive:true});
 const dead=execFileSync(process.execPath,['-e','console.log(process.pid)'],{encoding:'utf8'}).trim();fs.writeFileSync(path.join(p.manager,'operation.lock'),JSON.stringify({pid:Number(dead),time:new Date().toISOString()}));
 assert.equal(repairPlan({p,isRunning:()=>[]}).lock.alive,false);const r=await repairRun({p,isRunning:()=>[]});assert.equal(r.ok,true);assert.ok(fs.existsSync(r.recoveredLock));assert.equal(fs.existsSync(stage),false);assert.ok(fs.existsSync(unknown));assert.equal(fs.readFileSync(path.join(p.core,'auth.json'),'utf8'),'fixture-credential');assert.equal(fs.existsSync(path.join(p.manager,'operation.lock')),false);
});
test('recovery refuses live, malformed locks and incomplete transactions; the recovery guard blocks normal work',async t=>{
 const {p}=fixture(t),lock=path.join(p.manager,'operation.lock');fs.writeFileSync(lock,JSON.stringify({pid:process.pid}));await assert.rejects(repairRun({p,isRunning:()=>[]}),{code:'LOCK_OWNER_UNCERTAIN_OR_ALIVE'});assert.ok(fs.existsSync(lock));fs.unlinkSync(lock);
 fs.writeFileSync(lock,'unknown');await assert.rejects(repairRun({p,isRunning:()=>[]}),{code:'LOCK_OWNER_UNCERTAIN_OR_ALIVE'});fs.unlinkSync(lock);fs.writeFileSync(path.join(p.manager,'transaction-unknown.json'),'{}');await assert.rejects(repairRun({p,isRunning:()=>[]}),{code:'INCOMPLETE_TRANSACTION'});
 fs.writeFileSync(path.join(p.manager,'recovery.lock'),'guard');await assert.rejects(locked(p,()=>{}),{code:'BUSY'});assert.equal(fs.existsSync(lock),false);
});
test('native Windows sharing violations retain failed staging without terminating the installer',{skip:process.platform!=='win32'},async t=>{
 const {root}=fixture(t),dir=path.join(root,'stage-held');fs.mkdirSync(dir);const file=path.join(dir,'app.tar');fs.writeFileSync(file,'locked');
 const script="$f=[IO.File]::Open('"+file.replaceAll("'","''")+"',[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None);[Console]::WriteLine('READY');[Console]::ReadLine()|Out-Null;$f.Dispose()";
 const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('File lock probe timed out')),30000);child.once('error',reject);child.once('exit',()=>{clearTimeout(timer);reject(Error('File lock probe exited'));});child.stdout.on('data',b=>{if(b.toString().includes('READY')){clearTimeout(timer);resolve();}});});
  const warnings=[];assert.equal(await removeTemporary(dir,{report:x=>warnings.push(x)}),false);assert.ok(fs.existsSync(file));assert.equal(warnings.length,1);
 }finally{if(child.exitCode===null){const closed=new Promise(resolve=>child.once('close',resolve));child.stdin.end('\n');await closed;}}
 assert.equal(await removeTemporary(dir),true);assert.equal(fs.existsSync(dir),false);
});
test('CLI diagnostics expose the actual Node and preserve JSON/progress contracts',()=>{
 const cli=process.env.OWN_INSTALL_CLI||path.resolve(import.meta.dirname,'../bin/codex-own.mjs');
 const doc=JSON.parse(execFileSync(process.execPath,[cli,'doctor','--json'],{encoding:'utf8'}));assert.equal(doc.bootstrap.executable,process.execPath);assert.equal(doc.bootstrap.nodeVersion,process.version);assert.ok(Array.isArray(doc.orphanStages));
 assert.ok(JSON.parse(execFileSync(process.execPath,[cli,'help'],{encoding:'utf8'})).commands.includes('repair plan'));
 assert.throws(()=>execFileSync(process.execPath,[cli,'repair','run'],{encoding:'utf8'}),e=>JSON.parse(e.stderr.toString()).code==='CONFIRMATION_REQUIRED');
 assert.throws(()=>execFileSync(process.execPath,[cli,'doctor','--json','--progress','stdout'],{encoding:'utf8'}),e=>JSON.parse(e.stderr.toString()).code==='INVALID_ARGUMENT');
 const module=pathToFileURL(path.join(lib,'network.mjs')).href;
 const text=execFileSync(process.execPath,['--input-type=module','-e',`const {setProgressMode,progress}=await import(${JSON.stringify(module)});setProgressMode('stdout');progress('安装进度');setProgressMode('quiet');progress('hidden');`],{encoding:'utf8'});assert.equal(text,'[codex-own] 安装进度\n');
});
