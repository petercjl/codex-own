import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFileSync, spawn} from 'node:child_process';
import {networkFetch, verifiedDownload, progress} from './network.mjs';
import {validateParts, assembleNpmAsset} from './npm-assets.mjs';

export const packageRoot = path.resolve(import.meta.dirname, '..');
export const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot,'package.json'),'utf8'));
export function fail(code, message) { const e=new Error(message); e.code=code; throw e; }
export const hash = b=>crypto.createHash('sha256').update(b).digest('hex');
export function read(p) { return JSON.parse(fs.readFileSync(p,'utf8')); }
export function exclusive(p, value) { fs.writeFileSync(p, JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600}); }
export function paths(platform=process.platform, home=os.homedir()) {
  const local=process.env.LOCALAPPDATA||path.join(home,'AppData','Local');
  const root=platform==='darwin'?path.join(home,'Library','Application Support','codex-own-independent'):path.join(local,'codex-own-independent');
  return {root, manager:path.join(root,'manager'), core:path.join(root,'core'), desktop:path.join(root,'desktop'), target:platform==='darwin'?'/Applications/codex-own.app':path.join(local,'Programs','codex-own','current'), platform:`${platform}-${process.arch}`};
}
export function rejectLinks(p) {
  let q=path.resolve(p); while(true){ if(fs.existsSync(q)&&fs.lstatSync(q).isSymbolicLink())fail('UNSAFE_PATH',`Symbolic link/reparse path: ${q}`); const parent=path.dirname(q);if(parent===q)break;q=parent; }
}
export function validateManifest(m, platform) {
  if(![1,2].includes(m.schema)||m.repository!=='petercjl/codex-own'||!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(m.version))fail('INVALID_MANIFEST','Invalid release identity');
  const a=m.platforms?.[platform];if(!a)fail('PLATFORM_UNAVAILABLE',`No verified build for ${platform} in ${m.version}`);
  if(!/^[a-f0-9]{64}$/.test(a.sha256)||!Number.isSafeInteger(a.size)||a.size<=0)fail('INVALID_MANIFEST','Invalid archive checksum/size');
  if(m.schema===2){validateParts(a);if(a.entry!==(platform==='darwin-arm64'?'codex-own.app':'app'))fail('INVALID_MANIFEST','Unexpected archive entry');return a;}
  const expected=`https://github.com/petercjl/codex-own/releases/download/own-v${m.version}/`;
  if(!a.url?.startsWith(expected)||/[?#]/.test(a.url))fail('INVALID_MANIFEST','Unexpected artifact origin');
  if(a.entry!==(platform==='darwin-arm64'?'codex-own.app':'app'))fail('INVALID_MANIFEST','Unexpected archive entry');
  return a;
}
export async function digestFile(p) { const h=crypto.createHash('sha256');for await(const b of fs.createReadStream(p))h.update(b);return h.digest('hex'); }
export const download = verifiedDownload;
export function checkEntries(names) {
  for(const n of names){const p=n.replaceAll('\\','/');if(p.startsWith('/')||/^[a-z]:/i.test(p)||p.split('/').includes('..'))fail('UNSAFE_ARCHIVE','Unsafe archive entry');}
}
export function tarExecutable(platform=process.platform,env=process.env,exists=fs.existsSync) {
  if(platform!=='win32')return 'tar';
  const root=env.SystemRoot||env.SYSTEMROOT||env.windir||env.WINDIR;
  if(!root)fail('DEPENDENCY_MISSING','Windows system directory is unavailable');
  const executable=path.win32.join(root,'System32','tar.exe');
  if(!exists(executable))fail('DEPENDENCY_MISSING','Windows system tar.exe is required');
  return executable;
}
export function unpack(archive,dest) {
  const names=execFileSync(tarExecutable(),['-tf',archive],{encoding:'utf8',maxBuffer:30*1024*1024}).split('\n').filter(Boolean);checkEntries(names);
  fs.mkdirSync(dest);execFileSync(tarExecutable(),['-xf',archive,'-C',dest],{stdio:'pipe'});
  // Bundled framework links may be relative but must stay within the extracted tree.
  function walk(p){for(const x of fs.readdirSync(p,{withFileTypes:true})){const f=path.join(p,x.name);if(x.isSymbolicLink()){const resolved=path.resolve(path.dirname(f),fs.readlinkSync(f));if(!resolved.startsWith(dest+path.sep))fail('UNSAFE_ARCHIVE','Escaping symlink');}else if(x.isDirectory())walk(f);}}
  walk(dest);
}
export function running(p=paths()) {
  if(process.platform==='darwin'){
    const lines=execFileSync('ps',['-axo','pid=,command='],{encoding:'utf8'}).split('\n');
    return lines.filter(l=>l.includes('codex-own.app/Contents/')&&!l.includes(' ps -')&&!l.includes('/Contents/Resources/cua_node/')).map(l=>l.trim().split(/\s+/)[0]);
  }
  const out=execFileSync('powershell.exe',['-NoProfile','-Command',"@(Get-Process -Name 'codex-own' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id) -join ','"],{encoding:'utf8'}).trim();return out?out.split(','):[];
}
export function appIdentity(app) {
  if(process.platform==='darwin')return execFileSync('/usr/libexec/PlistBuddy',['-c','Print :CFBundleIdentifier',path.join(app,'Contents','Info.plist')],{encoding:'utf8'}).trim();
  return read(path.join(app,'codex-own-build.json')).identity;
}
export function state(p=paths()) {const f=path.join(p.manager,'state.json');return fs.existsSync(f)?read(f):null;}
export function writeState(p,value){const f=path.join(p.manager,'state.json');if(fs.existsSync(f)){const b=f+'.backup-'+crypto.randomUUID();fs.copyFileSync(f,b,fs.constants.COPYFILE_EXCL);}const tmp=f+'.new-'+crypto.randomUUID();exclusive(tmp,value);fs.renameSync(tmp,f);}
export function snapshot(p,dir) {
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  for(const name of ['core','desktop'])if(fs.existsSync(p[name]))fs.cpSync(p[name],path.join(dir,name),{recursive:true,errorOnExist:true,force:false});
}
export function switchApp({p,source,version,adopt=false,identity=appIdentity,isRunning=running,backupData=snapshot}) {
  rejectLinks(p.target);rejectLinks(p.root);
  if(isRunning(p).length)fail('APP_RUNNING','Quit codex-own before updating');
  const previous=state(p), exists=fs.existsSync(p.target);
  if(exists&&identity(p.target)!=='local.codex-own')fail('UNMANAGED_TARGET','Target is not codex-own');
  if(exists&&!previous&&!adopt)fail('ADOPTION_REQUIRED','Existing codex-own needs install --adopt --yes (a backup is kept)');
  if(identity(source)!=='local.codex-own')fail('INVALID_APP','Downloaded app identity does not match');
  const id=crypto.randomUUID(),backup=path.join(p.manager,'backups',id);fs.mkdirSync(backup,{recursive:true,mode:0o700});
  if(exists)backupData(p,path.join(backup,'data'));
  const old=path.join(path.dirname(p.target),'.codex-own-backup-'+id), next=path.join(path.dirname(p.target),'.codex-own-next-'+id);
  fs.mkdirSync(path.dirname(p.target),{recursive:true});fs.cpSync(source,next,{recursive:true,force:false,errorOnExist:true,dereference:false,verbatimSymlinks:true});
  const journal=path.join(p.manager,'transaction-'+id+'.json');exclusive(journal,{target:p.target,old,next,version,previous,backup});
  let moved=false,activated=false;
  try {if(exists){fs.renameSync(p.target,old);moved=true;}fs.renameSync(next,p.target);activated=true;
    writeState(p,{schema:1,identity:'local.codex-own',version,target:p.target,installedAt:new Date().toISOString(),previous:exists?{app:old,data:path.join(backup,'data'),state:previous}:null});
  }catch(e){if(activated&&fs.existsSync(p.target))fs.renameSync(p.target,path.join(path.dirname(p.target),'.codex-own-failed-'+id));if(moved)fs.renameSync(old,p.target);throw e;}
  exclusive(path.join(p.manager,'transaction-'+id+'.complete.json'),{ok:true});
  return {ok:true,version,target:p.target,backup:exists?old:null,dataBackup:exists?path.join(backup,'data'):null};
}
export async function locked(p,fn){rejectLinks(p.root);fs.mkdirSync(p.manager,{recursive:true,mode:0o700});const lock=path.join(p.manager,'operation.lock');let fd;try{fd=fs.openSync(lock,'wx',0o600);}catch{fail('BUSY','Another operation or interrupted lock exists; inspect doctor before recovery');}try{fs.writeSync(fd,JSON.stringify({pid:process.pid,time:new Date().toISOString()}));return await fn();}finally{fs.closeSync(fd);fs.unlinkSync(lock);}}
export async function latest() {const r=await networkFetch('https://registry.npmjs.org/@petercjl%2fcodex-own/latest',{signal:AbortSignal.timeout(30000)});if(!r.ok)fail('REGISTRY_UNAVAILABLE',`Registry HTTP ${r.status}`);const p=await r.json();if(p.name!==pkg.name)fail('INVALID_MANIFEST','Registry package mismatch');return p.version;}
export async function manifestFor(v){if(v===pkg.version)return read(path.join(packageRoot,'release.json'));if(!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(v))fail('INVALID_VERSION','Invalid version');const r=await networkFetch(`https://registry.npmjs.org/@petercjl%2fcodex-own/${v}`,{signal:AbortSignal.timeout(30000)});if(!r.ok)fail('MANIFEST_UNAVAILABLE',`npm HTTP ${r.status}`);const p=await r.json(),m=p.ownDesktopManifest;if(p.name!==pkg.name||p.version!==v||m?.version!==v||m?.schema!==2)fail('MANIFEST_UNAVAILABLE','This version has no npm desktop manifest; update the npm manager to latest.');return m;}
export async function configure(keyFile){if(!keyFile)fail('KEY_FILE_REQUIRED','Provide --api-key-file');const key=fs.readFileSync(keyFile,'utf8').trim();if(!/^sk-[A-Za-z0-9_-]{10,}$/.test(key))fail('INVALID_KEY_FILE','Expected a single API key');const p=paths();return locked(p,async()=>{if(running(p).length)fail('APP_RUNNING','Quit codex-own first');rejectLinks(p.core);fs.mkdirSync(p.core,{recursive:true,mode:0o700});fs.chmodSync(p.core,0o700);
 if(process.platform==='win32'){const sid=execFileSync('powershell.exe',['-NoProfile','-Command','[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'],{encoding:'utf8'}).trim();execFileSync('icacls.exe',[p.core,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`],{stdio:'pipe'});}
 const auth=path.join(p.core,'auth.json');rejectLinks(auth);let backup=null;if(fs.existsSync(auth)){backup=auth+'.backup-'+crypto.randomUUID();fs.copyFileSync(auth,backup,fs.constants.COPYFILE_EXCL);fs.chmodSync(backup,0o600);}const tmp=auth+'.new-'+crypto.randomUUID();exclusive(tmp,{auth_mode:'apikey',OPENAI_API_KEY:key});fs.renameSync(tmp,auth);
 const models=path.join(p.core,'models.json');if(!fs.existsSync(models))fs.copyFileSync(path.join(packageRoot,'defaults','models.json'),models,fs.constants.COPYFILE_EXCL);
 const config=path.join(p.core,'config.toml');if(!fs.existsSync(config))fs.writeFileSync(config,`model = "deepseek-v4.1-flash"\nmodel_provider = "dashscope_deepseek"\nforced_login_method = "api"\ncli_auth_credentials_store = "file"\nmodel_catalog_json = ${JSON.stringify(models.replaceAll('\\','/'))}\nmodel_reasoning_effort = "high"\nweb_search = "disabled"\n[model_providers.dashscope_deepseek]\nname = "DeepSeek-DashScope"\nbase_url = "https://dashscope.aliyuncs.com/compatible-mode/v1"\nwire_api = "responses"\nrequires_openai_auth = true\n`,{flag:'wx',mode:0o600});return {ok:true,configured:true,backup,configPreserved:true};});}
export async function install({version,adopt=false,archive,manifest}={}) {
  const p=paths();if(!['darwin-arm64','win32-x64'].includes(p.platform))fail('UNSUPPORTED_PLATFORM',p.platform);
  progress('准备安装：检查版本、平台与独立目录');
  return locked(p,async()=>{const m=manifest||await manifestFor(version||pkg.version);const a=validateManifest(m,p.platform);
    if(state(p)?.version===m.version&&!archive)return {ok:true,unchanged:true,version:m.version};
    if(running(p).length)fail('APP_RUNNING','Quit codex-own before install/update');
    const stage=fs.mkdtempSync(path.join(p.manager,'stage-'));let f=archive;
    if(f){if(fs.statSync(f).size!==a.size||await digestFile(f)!==a.sha256)fail('CHECKSUM_MISMATCH','Local archive checksum mismatch');}
    else{if(m.schema!==2)fail('NPM_ASSETS_REQUIRED','Update @petercjl/codex-own to the latest npm-only release.');f=path.join(stage,'app.tar.gz');const cache=path.join(p.manager,'npm-assets');rejectLinks(cache);await assembleNpmAsset(a,f,cache,tarExecutable());}
    progress('校验通过，正在解压桌面程序');
    const content=path.join(stage,'unpacked');unpack(f,content);const source=path.join(content,a.entry);
    if(process.platform==='darwin')execFileSync('codesign',['--verify','--deep','--strict',source],{stdio:'pipe'});
    progress('正在安装到独立目录');
    const result=switchApp({p,source,version:m.version,adopt});
    if(process.platform==='darwin')execFileSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',['-f',p.target],{stdio:'pipe'});
    else shortcut(p);
    fs.rmSync(stage,{recursive:true,force:true});progress('安装完成');return result;
  });
}
export function shortcut(p) {
  const folder=path.join(process.env.APPDATA,'Microsoft','Windows','Start Menu','Programs','codex-own');fs.mkdirSync(folder,{recursive:true});const file=path.join(folder,'codex-own.lnk');if(fs.existsSync(file))fs.copyFileSync(file,file+'.backup-'+crypto.randomUUID(),fs.constants.COPYFILE_EXCL);
  const quote=s=>"'"+s.replaceAll("'","''")+"'";
  execFileSync('powershell.exe',['-NoProfile','-Command',`$s=(New-Object -ComObject WScript.Shell).CreateShortcut(${quote(file)});$s.TargetPath=${quote(path.join(p.target,'codex-own.exe'))};$s.WorkingDirectory=${quote(p.target)};$s.Save()`]);
}
export function launch(){const p=paths();if(!fs.existsSync(p.target))fail('NOT_INSTALLED','Run codex-own install first');if(process.platform==='darwin')execFileSync('open',[p.target]);else{const child=spawn(path.join(p.target,'codex-own.exe'),[],{detached:true,stdio:'ignore'});child.unref();}return {ok:true,target:p.target};}
export async function rollback({restoreData=false}={}){const p=paths();return locked(p,async()=>{if(running(p).length)fail('APP_RUNNING','Quit codex-own first');const s=state(p);if(!s?.previous)fail('NO_ROLLBACK','No previous installation');if(!restoreData)fail('DATA_RESTORE_REQUIRED','Use rollback --restore-data --yes; newer data is backed up before restoring the previous snapshot');const prev=s.previous;rejectLinks(prev.app);if(appIdentity(prev.app)!=='local.codex-own')fail('INVALID_BACKUP','Backup identity mismatch');
  const backup=path.join(p.manager,'backups','rollback-'+crypto.randomUUID());snapshot(p,backup);
  const preserved=path.join(path.dirname(p.target),'.codex-own-before-rollback-'+crypto.randomUUID());fs.renameSync(p.target,preserved);fs.renameSync(prev.app,p.target);
  for(const n of ['core','desktop']){const snap=path.join(prev.data,n);if(fs.existsSync(p[n]))fs.renameSync(p[n],path.join(p.root,n+'.before-rollback-'+crypto.randomUUID()));if(fs.existsSync(snap))fs.cpSync(snap,p[n],{recursive:true,force:false,errorOnExist:true});}
  writeState(p,{...(prev.state||{schema:1,identity:'local.codex-own',version:'adopted-legacy',target:p.target}),previous:null});return {ok:true,preserved,dataBackup:backup};});}
export function doctor(){const p=paths(),s=state(p);let tar=true;try{execFileSync(tarExecutable(),['--version'],{stdio:'pipe'});}catch{tar=false;}const pending=fs.existsSync(p.manager)?fs.readdirSync(p.manager).filter(n=>/^transaction-.*\.json$/.test(n)&&!n.endsWith('.complete.json')&&!fs.existsSync(path.join(p.manager,n.replace('.json','.complete.json')))):[];return {ok:tar&&!pending.length,managerVersion:pkg.version,platform:p.platform,supported:['darwin-arm64','win32-x64'].includes(p.platform),installed:s?.version||null,paths:p,tar,pendingTransactions:pending,lock:fs.existsSync(path.join(p.manager,'operation.lock')),configured:fs.existsSync(path.join(p.core,'auth.json')),windowsGuiTested:false};}
