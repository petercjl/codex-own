import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {paths,state,locked,rejectLinks,exclusive,appIdentity,validateManifest,fail} from './manager.mjs';

export const CLEANUP_POLICY=Object.freeze({contract:1,cacheLimitBytes:2*1024**3,rollbackCopies:1,reportLimit:20,healthyStartupSeconds:30});
const PACKAGE='@petercjl/codex-own',UUID='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const json=file=>{rejectLinks(file);try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}};
const norm=file=>process.platform==='win32'?path.resolve(file).toLowerCase():path.resolve(file);
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&norm(a)===norm(b);
const contains=(base,file)=>same(base,file)||norm(file).startsWith(norm(base)+path.sep);
const version=v=>/^\d+\.\d+\.\d+$/.test(v||'');
function notNewer(a,b){if(!version(a)||!version(b))return false;const aa=a.split('.').map(Number),bb=b.split('.').map(Number);for(let i=0;i<3;i++){if(aa[i]!==bb[i])return aa[i]<bb[i];}return true;}
function exists(file){return fs.existsSync(file);}
function regular(file){rejectLinks(file);return exists(file)&&fs.lstatSync(file).isFile();}
function names(dir){rejectLinks(dir);return exists(dir)?fs.readdirSync(dir):[];}
function bytes(file){const s=fs.lstatSync(file);if(s.isSymbolicLink())return s.size;if(s.isDirectory())return fs.readdirSync(file).reduce((n,name)=>n+bytes(path.join(file,name)),0);return s.size;}
function fingerprint(file){const s=fs.lstatSync(file);return {size:s.size,mtimeMs:s.mtimeMs,ino:s.ino};}
function unchanged(file,expected){try{const s=fingerprint(file);return s.size===expected.size&&s.mtimeMs===expected.mtimeMs&&s.ino===expected.ino;}catch{return false;}}
function currentInstall(p,identify){
  rejectLinks(p.manager);rejectLinks(p.target);
  regular(path.join(p.manager,'state.json'));
  const s=state(p),meta=path.join(p.target,p.platform.startsWith('darwin-')?'Contents/Resources':'resources','own-updater','desktop-version.json');
  if(s?.identity!=='local.codex-own'||!same(s.target,p.target)||!version(s.version)||!s.desktop||!/^[a-f0-9]{64}$/.test(s.desktop.identity)||s.desktop.identity!==s.releaseManifest?.platforms?.[p.platform]?.sha256||identify(p.target)!=='local.codex-own'||json(meta)?.version!==s.version)
    fail('UNMANAGED_TARGET','Cleanup requires the matching managed desktop and component identity');
  return s;
}
function pendingTransactions(p){return names(p.manager).filter(n=>new RegExp('^transaction-'+UUID+'\\.json$').test(n)&&json(path.join(p.manager,n.replace('.json','.complete.json')))?.ok!==true);}
function healthFor(p,s){
  const root=path.join(p.manager,'health');
  return names(root).filter(n=>new RegExp('^startup-'+UUID+'\\.json$').test(n)).map(n=>({file:path.join(root,n),value:json(path.join(root,n))})).filter(({value:h})=>h?.schema===1&&h.package===PACKAGE&&h.version===s.version&&h.desktopIdentity===s.desktop.identity&&same(h.target,p.target)).sort((a,b)=>String(b.value.readyAt).localeCompare(String(a.value.readyAt)))[0]||null;
}

// Only return matched owned roots, never persist unrelated process arguments.
export function activeCleanupRoots(roots){
  if(!roots.length)return [];
  if(process.platform==='win32'){
    const quoted=roots.map(r=>"'"+r.replaceAll("'","''")+"'").join(',');
    const ps=`$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$roots=@(${quoted});@(Get-CimInstance Win32_Process | ForEach-Object { $f=$_.ExecutablePath;$c=$_.CommandLine; foreach($r in $roots){$prefix=$r+'\\';if(($f -and ($f.Equals($r,[StringComparison]::OrdinalIgnoreCase) -or $f.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase))) -or ($c -and ($c.IndexOf($prefix,[StringComparison]::OrdinalIgnoreCase) -ge 0))){$r}} }) | ConvertTo-Json -Compress`;
    const text=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:30000});
    const result=text.trim()?JSON.parse(text):[];return [...new Set(Array.isArray(result)?result:[result])];
  }
  const lines=execFileSync('ps',['-axo','command='],{encoding:'utf8',timeout:10000}).split('\n');
  return roots.filter(r=>lines.some(line=>line.includes(r+path.sep)));
}
function manifestParts(m,platform){
  validateManifest(m,platform);
  return [m.platforms[platform],...Object.values(m.runtimes?.platforms?.[platform]||{})].flatMap(a=>a.parts||[]).map(a=>a.sha256);
}
function helperResult(dir,p){
  const runtime=path.join(dir,'runtime'),meta=json(path.join(runtime,'desktop-version.json')),ready=json(path.join(runtime,'handoff-ready.json'));
  if(meta?.source!=='https://registry.npmjs.org/@petercjl%2fcodex-own/latest'||meta.updaterContract!==2||!ready?.ready)return null;
  if(ready.schema===2){
    if(!Number.isSafeInteger(ready.pid)||ready.pid<1||ready.current!==meta.version||!new RegExp('^update-result-'+UUID+'\\.json$').test(path.basename(ready.resultFile||''))||!same(path.dirname(ready.resultFile),p.manager))return null;
    try{process.kill(ready.pid,0);return null;}catch(e){if(e.code!=='ESRCH')return null;}
    if(typeof ready.receipt!=='string'||path.basename(ready.receipt)!=='receipt.json'||!/^update-[a-zA-Z0-9]+$/.test(path.basename(path.dirname(ready.receipt)))||!same(path.dirname(path.dirname(ready.receipt)),path.join(p.manager,'prepared')))return null;
    const result=json(ready.resultFile),receipt=json(ready.receipt),applied=json(ready.receipt+'.applied.json');
    return result?.version===receipt?.version&&applied?.ok===true&&applied.version===receipt?.version?result:null;
  }
  // Legacy helpers have no PID/result receipt. A completed log plus an owned
  // executable-process scan is required before reclaiming their copied runtime.
  const log=path.join(dir,'install.log');if(!regular(log))return null;
  const fd=fs.openSync(log,'r'),size=fs.fstatSync(fd).size,b=Buffer.alloc(Math.min(size,131072));
  try{fs.readSync(fd,b,0,b.length,Math.max(0,size-b.length));}finally{fs.closeSync(fd);}
  for(const line of b.toString('utf8').split('\n').reverse()){try{const r=JSON.parse(line).result;if(r)return r;}catch{}}
  return null;
}

export function planCleanup({p=paths(),cacheLimitBytes=CLEANUP_POLICY.cacheLimitBytes,identify=appIdentity,processRoots=activeCleanupRoots,lockHeld=false}={}){
  if(!Number.isSafeInteger(cacheLimitBytes)||cacheLimitBytes<0||cacheLimitBytes>16*1024**3)fail('INVALID_ARGUMENT','Cache limit must be between 0 and 16 GiB');
  const result={ok:true,contract:1,version:null,cacheLimitBytes,actions:[],preserved:[],plannedBytes:0};
  const defer=reason=>({...result,actions:[],plannedBytes:0,deferred:true,reason});
  if(!lockHeld&&exists(path.join(p.manager,'operation.lock')))return defer('BUSY');
  let s;try{s=currentInstall(p,identify);}catch(e){if(e.code==='UNSAFE_PATH')throw e;return defer('UNMANAGED_TARGET');}result.version=s.version;
  if(pendingTransactions(p).length)return defer('INCOMPLETE_TRANSACTION');
  const health=healthFor(p,s);if(!health)return defer('HEALTH_NOT_CONFIRMED');
  if(s.previous){
    const id=typeof s.previous.app==='string'?path.basename(s.previous.app).match(new RegExp('^\\.codex-own-backup-('+UUID+')$'))?.[1]:null;
    if(!id||!same(s.previous.app,path.join(path.dirname(p.target),'.codex-own-backup-'+id))||!same(s.previous.data,path.join(p.manager,'backups',id,'data')))return defer('UNKNOWN_ROLLBACK');
    rejectLinks(s.previous.app);rejectLinks(s.previous.data);
    const j=json(path.join(p.manager,'transaction-'+id+'.json')),done=json(path.join(p.manager,'transaction-'+id+'.complete.json'));
    if(done?.ok!==true||j?.version!==s.version||!same(j?.target,p.target)||!same(j?.old,s.previous.app)||!same(j?.backup,path.dirname(s.previous.data)))return defer('ROLLBACK_INCOMPLETE');
    if(!exists(s.previous.app)||!exists(s.previous.data)||identify(s.previous.app)!=='local.codex-own')return defer('ROLLBACK_INCOMPLETE');
  }
  result.rollbackRetained=!!s.previous;
  const protectedPaths=[p.target,p.core,p.desktop,s.previous?.app,s.previous?.data].filter(Boolean);
  const protects=f=>protectedPaths.some(q=>contains(f,q)||contains(q,f));
  const action=(kind,files,reason)=>{for(const f of files){rejectLinks(f);if(protects(f))fail('UNSAFE_PATH','Cleanup candidate intersects protected application data');}result.actions.push({kind,files,reason,bytes:files.reduce((n,f)=>n+bytes(f),0),fingerprints:files.map(fingerprint)});};
  const pinned=new Set();let pinAll=false;
  const prepared=path.join(p.manager,'prepared');
  for(const name of names(prepared)){
    if(!/^update-[a-zA-Z0-9]+$/.test(name))continue;
    const dir=path.join(prepared,name),receipt=path.join(dir,'receipt.json');rejectLinks(dir);
    const r=regular(receipt)?json(receipt):null,applied=regular(receipt+'.applied.json')?json(receipt+'.applied.json'):null;
    let valid=false;
    try{valid=!!r&&[1,2].includes(r.schema)&&r.platform===p.platform&&r.version===r.manifest?.version&&version(r.version);if(valid)manifestParts(r.manifest,p.platform);}catch{valid=false;}
    const completed=valid&&applied?.ok===true&&applied.version===r.version&&notNewer(r.version,s.version);
    if(!completed){
      if(valid)for(const hash of manifestParts(r.manifest,p.platform))pinned.add(hash);else pinAll=true;
      result.preserved.push({path:dir,reason:valid?'PENDING_OR_FAILED_UPDATE':'UNKNOWN_UPDATE_RECEIPT'});continue;
    }
    const archive=path.join(dir,'desktop.tar.gz');if(regular(archive))action('applied-archive',[archive],'APPLIED_UPDATE_AND_HEALTHY_DESKTOP');
  }
  const backups=[];
  for(const name of names(p.manager)){
    const match=name.match(new RegExp('^transaction-('+UUID+')\\.json$'));if(!match)continue;
    const j=json(path.join(p.manager,name)),done=json(path.join(p.manager,name.replace('.json','.complete.json'))),id=match[1];
    const old=path.join(path.dirname(p.target),'.codex-own-backup-'+id),backup=path.join(p.manager,'backups',id);
    if(done?.ok!==true||!notNewer(j?.version,s.version)||!same(j?.target,p.target)||!same(j?.old,old)||!same(j?.backup,backup))continue;
    const files=[old,backup].filter(exists);if(!files.length)continue;
    if(files.some(protects)){result.preserved.push({path:backup,reason:'LATEST_COMPLETE_ROLLBACK'});continue;}
    for(const f of files)rejectLinks(f);
    let owned=true;try{if(exists(old))owned=identify(old)==='local.codex-own';}catch{owned=false;}
    if(!owned){result.preserved.push({path:old,reason:'UNKNOWN_APP_IDENTITY'});continue;}
    backups.push({old,files});
  }
  const handoffs=[];const helperBase=path.join(p.manager,'handoffs');
  for(const name of names(helperBase)){
    if(!/^apply-[a-zA-Z0-9]+$/.test(name))continue;
    const dir=path.join(helperBase,name);rejectLinks(dir);const r=helperResult(dir,p);
    if(r?.ok===true&&same(r.target,p.target)&&notNewer(r.version,s.version))handoffs.push(dir);
    else result.preserved.push({path:dir,reason:'ACTIVE_FAILED_OR_UNKNOWN_HELPER'});
  }
  let active;try{active=processRoots([...backups.map(b=>b.old),...handoffs]);}catch{return defer('PROCESS_INSPECTION_UNAVAILABLE');}
  for(const b of backups){if(active.some(a=>same(a,b.old))){result.preserved.push({path:b.old,reason:'ACTIVE_OLD_APP'});continue;}action('old-rollback',b.files,'SUPERSEDED_COMPLETE_TRANSACTION');}
  for(const dir of handoffs){if(active.some(a=>same(a,dir))){result.preserved.push({path:dir,reason:'ACTIVE_UPDATE_HELPER'});continue;}action('completed-helper',[dir],'COMPLETED_HELPER_AND_HEALTHY_DESKTOP');}
  const cache=path.join(p.manager,'npm-assets'),blocks=[];
  for(const name of names(cache)){if(!/^[a-f0-9]{64}\.bin$/.test(name))continue;const f=path.join(cache,name);if(!regular(f))continue;const st=fs.statSync(f);blocks.push({file:f,hash:name.slice(0,64),bytes:st.size,used:st.mtimeMs});}
  let total=blocks.reduce((n,b)=>n+b.bytes,0);result.cacheBytesBefore=total;
  for(const b of blocks.sort((a,b)=>a.used-b.used||a.hash.localeCompare(b.hash))){
    if(total<=cacheLimitBytes)break;if(pinAll||pinned.has(b.hash))continue;
    action('cache-block',[b.file],'LEAST_RECENTLY_USED_UNPINNED_BLOCK');total-=b.bytes;
  }
  result.cacheBytesAfter=total;result.cacheLimitExceeded=total>cacheLimitBytes;result.cacheProtection=pinAll?'UNKNOWN_RECEIPT':pinned.size?'PENDING_UPDATE':null;
  for(const [folder,prefix,keep] of [['cleanup-reports','report-',CLEANUP_POLICY.reportLimit-1],['cleanup-intents','intent-',CLEANUP_POLICY.reportLimit-1],['health','startup-',CLEANUP_POLICY.reportLimit]]){
    const dir=path.join(p.manager,folder),records=names(dir).filter(n=>new RegExp('^'+prefix+UUID+'\\.json$').test(n)).map(n=>path.join(dir,n)).filter(regular).filter(f=>{const r=json(f);return r?.schema===1&&r.package===PACKAGE;}).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);
    for(const file of records.slice(keep))if(!same(file,health.file))action('old-report',[file],'BOUNDED_DIAGNOSTIC_HISTORY');
  }
  result.plannedBytes=result.actions.reduce((n,a)=>n+a.bytes,0);return result;
}

function performCleanup(options){
  const p=options.p||paths(),plan=planCleanup({...options,p,lockHeld:true});
  if(plan.deferred)return {...plan,reclaimedBytes:0};
  const intents=path.join(p.manager,'cleanup-intents');rejectLinks(intents);fs.mkdirSync(intents,{recursive:true,mode:0o700});
  exclusive(path.join(intents,'intent-'+crypto.randomUUID()+'.json'),{schema:1,package:PACKAGE,version:plan.version,target:p.target,plannedAt:new Date().toISOString(),actions:plan.actions});
  const removed=[],warnings=[];let reclaimedBytes=0;
  for(const a of plan.actions){
    for(let i=0;i<a.files.length;i++){
      const file=a.files[i];let before;
      try{
        rejectLinks(file);if(!unchanged(file,a.fingerprints[i])){warnings.push({path:file,code:'CANDIDATE_CHANGED'});break;}
        before=bytes(file);fs.rmSync(file,{recursive:true,maxRetries:2,retryDelay:100});reclaimedBytes+=before;removed.push({kind:a.kind,path:file,bytes:before});
      }catch(e){let remaining;try{remaining=bytes(file);}catch{}if(Number.isSafeInteger(before)&&Number.isSafeInteger(remaining))reclaimedBytes+=Math.max(0,before-remaining);warnings.push({path:file,code:e.code||'CLEANUP_FAILED'});break;}
    }
  }
  const cache=path.join(p.manager,'npm-assets'),cacheBytesAfter=names(cache).filter(n=>/^[a-f0-9]{64}\.bin$/.test(n)).map(n=>path.join(cache,n)).filter(regular).reduce((n,f)=>n+fs.statSync(f).size,0);
  const result={schema:1,package:PACKAGE,ok:true,version:plan.version,completedAt:new Date().toISOString(),reclaimedBytes,removed,warnings,cacheLimitBytes:plan.cacheLimitBytes,cacheBytesAfter,cacheLimitExceeded:cacheBytesAfter>plan.cacheLimitBytes,cacheProtection:plan.cacheProtection,rollbackCopies:CLEANUP_POLICY.rollbackCopies,rollbackRetained:plan.rollbackRetained};
  const dir=path.join(p.manager,'cleanup-reports');rejectLinks(dir);fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const report=path.join(dir,'report-'+crypto.randomUUID()+'.json');exclusive(report,result);
  return {...result,report};
}
export async function runCleanup(options={}){const p=options.p||paths();return locked(p,()=>performCleanup({...options,p}));}

// Called only by the desktop worker after the controller's main-window health
// gate. A matching installed component is mandatory; spawning an app is not proof.
export async function cleanupAfterHealthyStartup(current,options={}){
  const p=options.p||paths(),identify=options.identify||appIdentity;
  return locked(p,()=>{
    const s=currentInstall(p,identify);if(s.version!==current)fail('INSTALLATION_CHANGED','The running desktop differs from its managed installation');
    if(pendingTransactions(p).length)return {ok:true,deferred:true,reason:'INCOMPLETE_TRANSACTION',reclaimedBytes:0};
    const dir=path.join(p.manager,'health');rejectLinks(dir);fs.mkdirSync(dir,{recursive:true,mode:0o700});
    exclusive(path.join(dir,'startup-'+crypto.randomUUID()+'.json'),{schema:1,package:PACKAGE,version:current,target:p.target,desktopIdentity:s.desktop.identity,readyAt:new Date().toISOString(),evidence:'main-window-loaded-and-alive-30s'});
    return performCleanup({...options,p});
  });
}
