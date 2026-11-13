// Host lifecycle only. The collection owns registration, resolution and Skill materialization.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {locked,rejectLinks} from './manager.mjs';import {networkFetch} from './network.mjs';
import tools from './tool-env.cjs';import contract from './company-tools-env.cjs';
import {fileURLToPath} from 'node:url';
const execute=promisify(execFile),{PACKAGE,selection}=contract;
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const fault=code=>Object.assign(Error('Company tools: '+code),{code});
const stable=v=>typeof v==='string'&&/^\d+\.\d+\.\d+$/.test(v);
const forward=(old,next)=>stable(next)&&next.localeCompare(old,undefined,{numeric:true})>=0;
export async function setCompanyToolsPolicy(root,autoUpdate){
 if(typeof autoUpdate!=='boolean')throw fault('COLLECTION_POLICY');
 const base=path.join(root,'company-tools');rejectLinks(base);fs.mkdirSync(base,{recursive:true,mode:0o700});
 return locked({root:base,manager:base},async()=>{const value={contract:1,autoUpdate};save(path.join(base,'policy.json'),value);return value;});
}
export function companyToolsState(root){
 const base=path.join(root,'company-tools');rejectLinks(base);const current=selection(root);
 const read=name=>{const file=path.join(base,name);rejectLinks(file);return fs.existsSync(file)?json(file):null;};
 const status=read('status.json'),pending=read('pending.json');
 let graph=null,next=null;
 if(current)graph=json(path.join(current.directory,'collection.json'));
 if(pending){if(pending.contract!==1||!/^generation-[a-f0-9-]{36}$/.test(pending.generation))throw fault('COLLECTION_PENDING');const directory=contained(base,path.join(base,pending.generation));next=json(path.join(directory,'collection.json'));if(next.package!==PACKAGE||!stable(next.version))throw fault('COLLECTION_PENDING');}
 const checked=new Map((status?.members||[]).map(m=>[m.package,m]));
 const skills=(graph?.skills||[]).map(skill=>{
  if(!/^[a-z0-9][a-z0-9-]{1,99}$/.test(skill.name))throw fault('COLLECTION_SKILL');
  const file=path.join(root,'core','skills','company-tools',skill.name,'agents','openai.yaml');rejectLinks(file);let label=skill.name;
  if(fs.existsSync(file)){const match=fs.readFileSync(file,'utf8').match(/^\s*display_name:\s*(.+)$/m);if(match)label=match[1].trim().replace(/^["']|["']$/g,'').slice(0,120);}
  return {name:skill.name,label,package:skill.package,version:skill.version};
 });
 const members=(graph?.members||[]).map(member=>({id:member.id,package:member.package,version:member.version,cli:Array.isArray(member.bin)?member.bin:member.bin?[member.bin]:[],
  available:checked.get(member.package)?.available||next?.members.find(m=>m.package===member.package)?.version||null,
  skills:skills.filter(s=>s.package===member.package).map(s=>({name:s.name,label:s.label}))}));
 return {contract:1,package:PACKAGE,name:'淘宝 AI 运营工具集',description:'统一安装和更新公司使用的 Skill 与 CLI',installed:!!current,version:current?.version||null,
  availableVersion:status?.availableVersion||next?.version||null,autoUpdate:contract.policy(root).autoUpdate,intervalHours:6,
  phase:pending?'prepared':status?.status==='ready'?'installed':status?.status||'not-installed',checkedAt:status?.checkedAt||null,
  pendingUpdate:!!pending&&pending.generation!==current?.generation,restartRequired:false,pendingVersion:next?.version||null,
  members,skills,memberCount:members.length,skillCount:skills.length,pendingMemberCount:next?.members.length||0,pendingSkillCount:next?.skills.length||0,
  changes:status?.changes||null,error:status?.status==='failed'?String(status.reason||'COLLECTION_FAILED'):null};
}
export function hashes(root){
 const result={};
 function walk(dir){for(const name of fs.readdirSync(dir).sort()){
  const file=path.join(dir,name),s=fs.lstatSync(file),relative=path.relative(root,file).split(path.sep).join('/');
  if(s.isSymbolicLink())throw fault('COLLECTION_LINK');
  if(['__pycache__','tests','.suite-install.json','.install-meta.json'].includes(name)||name.endsWith('.pyc')||name==='.codex-own-collection.json')continue;
  if(s.isDirectory())walk(file);
  else if(s.isFile())result[relative]=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  else throw fault('COLLECTION_FILE_TYPE');
 }}walk(root);return result;
}
function same(a,b){return JSON.stringify(Object.entries(a).sort())===JSON.stringify(Object.entries(b).sort());}
function save(file,data){
 rejectLinks(file);
 if(fs.existsSync(file)){if(!fs.statSync(file).isFile())throw fault('UNSAFE_RECEIPT');fs.copyFileSync(file,file+'.backup-'+crypto.randomUUID(),fs.constants.COPYFILE_EXCL);}
 const next=file+'.new-'+crypto.randomUUID();fs.writeFileSync(next,JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(next,file);
}
function contained(root,file){
 if(typeof file!=='string'||!path.isAbsolute(file))throw fault('COLLECTION_PATH');
 const relative=path.relative(root,file);if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw fault('COLLECTION_PATH');
 rejectLinks(file);return file;
}
export function verifyGraph(directory){
 rejectLinks(directory);const graph=json(path.join(directory,'collection.json'));
 if(graph.ok!==true||graph.schemaVersion!==1||graph.package!==PACKAGE||!stable(graph.version)||graph.skillsDirectory!==path.join(directory,'skills')||!Array.isArray(graph.members)||!Array.isArray(graph.skills)||!graph.skills.length)throw fault('COLLECTION_RECEIPT');
 const identities=new Map([[PACKAGE,graph.version]]);
 for(const m of graph.members){if(m.blocked||!stable(m.version)||typeof m.package!=='string'||identities.has(m.package))throw fault('COLLECTION_MEMBER');identities.set(m.package,m.version);}
 const names=new Set();
 for(const skill of graph.skills){
  if(!/^[a-z0-9][a-z0-9-]{1,99}$/.test(skill.name)||names.has(skill.name)||identities.get(skill.package)!==skill.version||skill.directory!==path.join(graph.skillsDirectory,skill.name))throw fault('COLLECTION_SKILL');names.add(skill.name);
  if(!fs.statSync(contained(directory,skill.runtimeEntry)).isFile()||!fs.statSync(contained(directory,path.join(skill.directory,'SKILL.md'))).isFile())throw fault('COLLECTION_ENTRY');
  const runtime=json(path.join(skill.directory,'.collection-runtime.json'));
  if(runtime.runtimeEntry!==skill.runtimeEntry||runtime.package!==skill.package||runtime.version!==skill.version)throw fault('COLLECTION_RUNTIME');
 }
 if(!same(hashes(graph.skillsDirectory),json(path.join(directory,'integrity.json'))))throw fault('COLLECTION_MODIFIED');
 if(graph.environment?.TAOBAO_AI_OPS_STATE_DIR!==path.join(directory,'state'))throw fault('COLLECTION_ENVIRONMENT');
 return graph;
}
function verifyInstalled(root){
 const current=selection(root),target=path.join(root,'core','skills','company-tools');rejectLinks(target);
 if(!fs.existsSync(target)){if(current)throw fault('COLLECTION_INSTALL_MISSING');return;}
 const marker=path.join(target,'.codex-own-collection.json');
 if(!current||!fs.existsSync(marker)||json(marker).generation!==current.generation)throw fault('UNMANAGED_COLLECTION_SKILLS');
 if(!same(hashes(target),json(path.join(current.directory,'integrity.json'))))throw fault('COLLECTION_LOCAL_EDITS');
}
export function activateCollection(root,generation){
 const base=path.join(root,'company-tools'),directory=contained(base,path.join(base,generation));
 if(!/^generation-[a-f0-9-]{36}$/.test(generation))throw fault('COLLECTION_PATH');
 const graph=verifyGraph(directory);verifyInstalled(root);stableShims(root,graph);
 const target=path.join(root,'core','skills','company-tools'),previous=selection(root);
 fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
 const next=path.join(base,'activation-'+crypto.randomUUID()),backup=path.join(base,'previous-skills-'+crypto.randomUUID());
 const journal=path.join(base,'activation.json');if(fs.existsSync(journal))throw fault('COLLECTION_RECOVERY_REQUIRED');
 fs.cpSync(graph.skillsDirectory,next,{recursive:true,errorOnExist:true,force:false});
 fs.writeFileSync(path.join(next,'.codex-own-collection.json'),JSON.stringify({contract:1,generation}),{flag:'wx',mode:0o600});
 if(!same(hashes(next),json(path.join(directory,'integrity.json'))))throw fault('COLLECTION_COPY_FAILED');
 save(journal,{contract:1,generation,next:path.basename(next),backup:path.basename(backup),hadTarget:fs.existsSync(target)});
 if(fs.existsSync(target))fs.renameSync(target,backup);
 try{
  fs.renameSync(next,target);
  save(path.join(base,'active.json'),{contract:1,package:PACKAGE,version:graph.version,generation,previous:previous?.generation||null,skillsBackup:fs.existsSync(backup)?backup:null});
 }catch(e){if(fs.existsSync(target))fs.renameSync(target,next);if(fs.existsSync(backup))fs.renameSync(backup,target);fs.renameSync(journal,path.join(base,'activation-failed-'+crypto.randomUUID()+'.json'));throw e;}
 fs.renameSync(journal,path.join(base,'activation-complete-'+crypto.randomUUID()+'.json'));
 return {status:'activated',version:graph.version,skillCount:graph.skills.length};
}
export function stableShims(root,graph){
 const bin=path.join(root,'company-tools','bin'),marker=path.join(bin,'.codex-own-company-bin.json');rejectLinks(bin);fs.mkdirSync(bin,{recursive:true,mode:0o700});rejectLinks(marker);
 const previous=fs.existsSync(marker)?json(marker):{contract:1,files:{}};if(previous.contract!==1||!previous.files||typeof previous.files!=='object')throw fault('COLLECTION_BIN_OWNERSHIP');
 const digest=s=>crypto.createHash('sha256').update(s).digest('hex'),files={...previous.files},dispatcher=fileURLToPath(new URL('./company-tools-dispatch.cjs',import.meta.url)),quote=s=>"'"+s.replaceAll("'","'\"'\"'")+"'";
 for(const name of ['taobao-ai-ops',...graph.members.map(m=>m.bin)]){
  if(!/^[a-zA-Z0-9_-]+$/.test(name))throw fault('COLLECTION_BIN');
  if([root,dispatcher].some(v=>/[\r\n%"!]/.test(v)))throw fault('COLLECTION_WINDOWS_PATH');
  const scripts={[name]:'#!/bin/sh\nexec "$CODEX_OWN_NODE" '+quote(dispatcher)+' '+quote(root)+' '+quote(name)+' "$@"\n',[name+'.cmd']:'@echo off\r\n"%CODEX_OWN_NODE%" "'+dispatcher+'" "'+root+'" "'+name+'" %*\r\n'};
  for(const [file,source]of Object.entries(scripts)){const target=path.join(bin,file);rejectLinks(target);if(fs.existsSync(target)){if(!fs.statSync(target).isFile()||digest(fs.readFileSync(target))!==previous.files[file])throw fault('COLLECTION_BIN_LOCAL_EDITS');if(fs.readFileSync(target,'utf8')!==source){fs.copyFileSync(target,target+'.backup-'+crypto.randomUUID(),fs.constants.COPYFILE_EXCL);const next=target+'.new-'+crypto.randomUUID();fs.writeFileSync(next,source,{flag:'wx',mode:file.endsWith('.cmd')?0o600:0o700});fs.renameSync(next,target);}}else fs.writeFileSync(target,source,{flag:'wx',mode:file.endsWith('.cmd')?0o600:0o700});files[file]=digest(source);save(marker,{contract:1,files});}
 }
}
export async function activatePending(root){
 const base=path.join(root,'company-tools'),file=path.join(base,'pending.json');rejectLinks(base);
 if(!fs.existsSync(file)&&!fs.existsSync(path.join(base,'activation.json')))return {status:'unchanged'};
 return locked({root:base,manager:base},async()=>{
  const journal=path.join(base,'activation.json');
  if(fs.existsSync(journal)){
   const r=json(journal),target=path.join(root,'core/skills/company-tools');
   if(r.contract!==1||!/^generation-[a-f0-9-]{36}$/.test(r.generation)||!/^activation-[a-f0-9-]{36}$/.test(r.next)||!/^previous-skills-[a-f0-9-]{36}$/.test(r.backup)||typeof r.hadTarget!=='boolean')throw fault('COLLECTION_RECOVERY_REQUIRED');
   const backup=contained(base,path.join(base,r.backup));rejectLinks(target);
   if(selection(root)?.generation===r.generation)verifyInstalled(root);
   else if(fs.existsSync(backup)||!r.hadTarget){
    if(fs.existsSync(target)){
     const marker=path.join(target,'.codex-own-collection.json');if(!fs.existsSync(marker)||json(marker).generation!==r.generation)throw fault('COLLECTION_RECOVERY_REQUIRED');
     if(!same(hashes(target),json(path.join(base,r.generation,'integrity.json'))))throw fault('COLLECTION_LOCAL_EDITS');
     fs.renameSync(target,path.join(base,'interrupted-skills-'+crypto.randomUUID()));
    }
    if(fs.existsSync(backup))fs.renameSync(backup,target);
   }else verifyInstalled(root);
   fs.renameSync(journal,path.join(base,'activation-recovered-'+crypto.randomUUID()+'.json'));
  }
  if(!fs.existsSync(file))return {status:'recovered'};
  const pending=json(file);if(pending.contract!==1)throw fault('COLLECTION_PENDING');
  const result=selection(root)?.generation===pending.generation?{status:'unchanged'}:activateCollection(root,pending.generation);
  fs.renameSync(file,path.join(base,'applied-'+crypto.randomUUID()+'.json'));return result;
 });
}
function shims(directory,graph){
 const bin=path.join(directory,'bin');fs.mkdirSync(bin,{mode:0o700});
 const records=json(path.join(directory,'state','components.json')).components;
 const entries={'taobao-ai-ops':path.join(directory,'shell','bin','taobao-ai-ops.mjs')};
 for(const m of graph.members){if(!/^[a-zA-Z0-9_-]+$/.test(m.bin))throw fault('COLLECTION_BIN');const record=records[m.id];if(record?.package!==m.package||record.version!==m.version)throw fault('COLLECTION_COMPONENT');entries[m.bin]=contained(directory,record.entry);}
 const quote=s=>"'"+s.replaceAll("'","'\"'\"'")+"'";
 for(const [name,entry] of Object.entries(entries)){
  fs.writeFileSync(path.join(bin,name),'#!/bin/sh\nexec "$CODEX_OWN_NODE" '+quote(entry)+' "$@"\n',{flag:'wx',mode:0o700});
  // cmd quoting handles spaces/non-ASCII paths. Reject expansion metacharacters.
  if(/[\r\n%"!]/.test(entry))throw fault('COLLECTION_WINDOWS_PATH');
  fs.writeFileSync(path.join(bin,name+'.cmd'),'@echo off\r\n"%CODEX_OWN_NODE%" "'+entry+'" %*\r\n',{flag:'wx',mode:0o600});
 }
}
export async function maintainCompanyTools(root,{activate=true,force=false,checkOnly=false,now=Date.now(),fetcher=networkFetch,run=execute,report=()=>{},signal}={}){
 const base=path.join(root,'company-tools');rejectLinks(base);fs.mkdirSync(base,{recursive:true,mode:0o700});
 return locked({root:base,manager:base},async()=>{
  const stateFile=path.join(base,'status.json'),pendingFile=path.join(base,'pending.json');let activation;
  const runtime=tools.active(path.join(root,'runtimes'));if(!runtime)throw fault('RUNTIME_NOT_INSTALLED');
  const env=tools.environment(path.join(root,'runtimes'),process.env);
  const call=async(entry,args,cwd,timeout=12*60000)=>{
   const childEnv={...env,npm_execpath:runtime.npm,NODE_USE_ENV_PROXY:'1',TAOBAO_AI_OPS_AUTO_UPDATE:'0',AGENT_PACKAGE_UPDATE_CHECK:'0',npm_config_update_notifier:'false',npm_config_fetch_retries:'1',npm_config_fetch_timeout:'30000'};
   delete childEnv.ELECTRON_RUN_AS_NODE;delete childEnv.NODE_OPTIONS;
   try{const result=await run(runtime.node,[entry,...args],{cwd,env:childEnv,encoding:'utf8',timeout,maxBuffer:8*1024*1024,windowsHide:true,signal});return result.stdout;}
   catch(e){let childCode;try{const parsed=JSON.parse(String(e.stderr||e.stdout||'').trim());childCode=parsed.code||parsed.error?.code;}catch{}
    throw Object.assign(fault(typeof childCode==='string'&&/^[A-Z0-9_]+$/.test(childCode)?childCode:'COLLECTION_CHILD_FAILED'),{stage:args[0],exitCode:typeof e.code==='number'?e.code:null});}
  };
  try{
   verifyInstalled(root);
   if(activate&&!checkOnly&&fs.existsSync(pendingFile)){
    const pending=json(pendingFile);
    if(pending.contract!==1)throw fault('COLLECTION_PENDING');
    report({phase:'activating',label:'正在应用已下载的更新…',step:4,total:4,indeterminate:true});
    if(selection(root)?.generation!==pending.generation)activation=activateCollection(root,pending.generation);
    fs.renameSync(pendingFile,path.join(base,'applied-'+crypto.randomUUID()+'.json'));
    const result={...(fs.existsSync(stateFile)?json(stateFile):{}),...activation,status:'activated',version:selection(root).version,activation:'online'};save(stateFile,result);report({phase:'complete',label:'更新完成，已立即生效。',completed:4,total:4,indeterminate:false});return result;
   }
   const status=fs.existsSync(stateFile)?json(stateFile):null;
   if(!force&&status?.checkedAt&&now-status.checkedAt<6*3600000)return activation||{status:'throttled',version:selection(root)?.version||null};
   save(stateFile,{contract:1,status:'checking',checkedAt:now});
   report({phase:'checking',label:'正在检查公司工具集及全部成员…',step:1,total:checkOnly?1:4,completed:0,indeterminate:true});
   const response=await fetcher('https://registry.npmjs.org/@petercjl%2ftaobao-ai-ops/latest',{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)});
   if(!response.ok)throw fault('COLLECTION_REGISTRY_UNAVAILABLE');
   const meta=await response.json(),current=selection(root);
   if(meta.name!==PACKAGE||!stable(meta.version)||(current&&!forward(current.version,meta.version)))throw fault('COLLECTION_REGISTRY_IDENTITY');
   let shell=current?.directory&&path.join(current.directory,'shell','bin','taobao-ai-ops.mjs');
   if(!current||meta.version!==current.version){
    const acquisition=fs.mkdtempSync(path.join(base,'package-'));fs.chmodSync(acquisition,0o700);
    report({phase:'downloading',label:'正在下载工具集版本清单 '+meta.version+'…',step:1,total:checkOnly?1:4,completed:0,indeterminate:true});
    await call(runtime.npm,['install','--prefix',acquisition,'--ignore-scripts','--no-audit','--no-fund','--save-exact',PACKAGE+'@'+meta.version],acquisition);
    const pkg=path.join(acquisition,'node_modules',PACKAGE),identity=json(path.join(pkg,'package.json')),manifest=json(path.join(pkg,'sealwork.collection.json'));
    if(identity.name!==PACKAGE||identity.version!==meta.version||manifest.schemaVersion!==1||manifest.kind!=='capability-collection'||manifest.id!=='petercjl.taobao-ai-ops'||manifest.entry!=='bin/taobao-ai-ops.mjs'||!manifest.platforms?.includes(process.platform)||Object.keys({...identity.dependencies,...identity.optionalDependencies}).length)throw fault('COLLECTION_CONTRACT');
    shell=path.join(pkg,manifest.entry);
   }
   const previous=current?['--previous',path.join(current.directory,'collection.json')]:[];
   const check=JSON.parse(await call(shell,['collection','check','--json',...previous],base));
   if(check.ok!==true||!Array.isArray(check.members))throw fault('COLLECTION_CHECK');
   const upgrades=[];
   for(const m of check.members)if(m.blocked){if(!/^[a-zA-Z0-9._-]+$/.test(m.id)||!forward(m.version,m.available))throw fault('COLLECTION_MEMBER_DOWNGRADE');upgrades.push(m.id);}
   const oldMembers=current?json(path.join(current.directory,'collection.json')).members:[],oldVersions=new Map(oldMembers.map(m=>[m.package,m.version])),newPackages=new Set(check.members.map(m=>m.package));
   const changes={added:check.members.filter(m=>!oldVersions.has(m.package)).length,upgraded:check.members.filter(m=>oldVersions.has(m.package)&&oldVersions.get(m.package)!==(m.blocked?m.available:m.version)).length,removed:oldMembers.filter(m=>!newPackages.has(m.package)).length};
   const checked={contract:1,checkedAt:now,version:current?.version||null,availableVersion:meta.version,members:check.members,changes};
   if(checkOnly){const result={...checked,status:check.changed||upgrades.length?'available':'current'};save(stateFile,result);return result;}
   if(!check.changed&&!upgrades.length&&current){const result={...checked,status:'current'};save(stateFile,result);return activation||result;}
   const generation='generation-'+crypto.randomUUID(),directory=path.join(base,generation);
   report({phase:'preparing',label:'正在下载、安装组件并准备 Skill…',step:2,total:4,completed:1,indeterminate:true});
   await call(shell,['collection','prepare','--directory',directory,'--yes','--json',...previous,...(upgrades.length?['--accept-component-upgrades',upgrades.join(',')]:[])],base);
   report({phase:'verifying',label:'正在校验完整性、版本与 Skill…',step:3,total:4,completed:2,indeterminate:false});
   const graph=verifyGraph(directory);if(graph.version!==meta.version)throw fault('COLLECTION_VERSION');shims(directory,graph);
   verifyInstalled(root);
   const result={...checked,status:'ready',version:graph.version,generation,skillCount:graph.skills.length,activation:'next-startup'};
   save(pendingFile,{contract:1,generation});
   if(activate){report({phase:'activating',label:'正在启用新版本…',step:4,total:4,completed:3,indeterminate:false});activation=activateCollection(root,generation);activation.activation='online';fs.renameSync(pendingFile,path.join(base,'applied-'+crypto.randomUUID()+'.json'));}
   save(stateFile,{...result,...activation});return {...result,...activation};
  }catch(e){const result={contract:1,status:'failed',checkedAt:now,reason:e.code||'COLLECTION_FAILED',stage:e.stage||null,exitCode:e.exitCode??null,version:selection(root)?.version||null};save(stateFile,result);return result;}
 });
}
