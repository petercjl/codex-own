// Host-owned connector updates. Independent Tuda application updates belong to Tuda.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {x as extract} from 'tar';
import {networkFetch} from './network.mjs';import {locked,rejectLinks} from './manager.mjs';
import {archiveInventory} from './archive-inventory.mjs';import {isNewer} from './app-update.mjs';
import contract from './tuda-contract.cjs';
const PACKAGE='@petercjl/tuda',REGISTRY='https://registry.npmjs.org/@petercjl%2ftuda/latest';
const fault=code=>Object.assign(Error('Tuda component operation failed'),{code});
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
function safe(base,file){rejectLinks(file);const relative=path.relative(base,file);if(relative.startsWith('..')||path.isAbsolute(relative))throw fault('UNSAFE_TUDA_PATH');return file;}
function save(file,value){rejectLinks(file);if(fs.existsSync(file)){if(!fs.statSync(file).isFile())throw fault('UNSAFE_TUDA_PATH');fs.copyFileSync(file,file+'.backup-'+crypto.randomUUID(),fs.constants.COPYFILE_EXCL);}const next=file+'.new-'+crypto.randomUUID();fs.writeFileSync(next,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});fs.renameSync(next,file);}
function inventory(root){
 const files={};let bytes=0;
 const walk=dir=>{for(const name of fs.readdirSync(dir).sort()){const file=path.join(dir,name),s=fs.lstatSync(file);if(s.isSymbolicLink())throw fault('UNSAFE_TUDA_PACKAGE');if(s.isDirectory())walk(file);else if(s.isFile()){if((bytes+=s.size)>32*1024*1024||Object.keys(files).length>=2048)throw fault('TUDA_PACKAGE_TOO_LARGE');files[path.relative(root,file).replaceAll(path.sep,'/')]={size:s.size,sha256:hash(fs.readFileSync(file))};}else throw fault('UNSAFE_TUDA_PACKAGE');}};walk(root);return files;
}
function validatePackage(root,version){
 safe(root,root);const pkg=json(path.join(root,'package.json'));
 if(pkg.name!==PACKAGE||pkg.version!==version||!/^\d+\.\d+\.\d+$/.test(version)||Object.keys({...pkg.dependencies,...pkg.optionalDependencies}).length)throw fault('TUDA_PACKAGE_INVALID');
 try{contract.verifyTudaContract(root);}catch{throw fault('TUDA_CONTRACT_INCOMPATIBLE');}return inventory(root);
}
function own(base){
 rejectLinks(base);const marker=path.join(base,'owner.json');
 if(fs.existsSync(base)&&!fs.existsSync(marker)&&fs.readdirSync(base).length)throw fault('UNMANAGED_TUDA_RUNTIME');
 fs.mkdirSync(base,{recursive:true,mode:0o700});
 safe(base,marker);safe(base,path.join(base,'versions'));
 if(!fs.existsSync(marker))fs.writeFileSync(marker,JSON.stringify({contract:1,package:PACKAGE}),{flag:'wx',mode:0o600});
 if(json(marker).package!==PACKAGE||json(marker).contract!==1)throw fault('UNMANAGED_TUDA_RUNTIME');
 fs.mkdirSync(path.join(base,'versions'),{recursive:true,mode:0o700});
}
function selection(base){
 const active=path.join(base,'active.json');if(!fs.existsSync(active))return null;safe(base,active);const r=json(active);
 if(r.contract!==1||r.package!==PACKAGE||typeof r.directory!=='string'||!/^\d+\.\d+\.\d+-[a-f0-9]{16}-[a-f0-9]{8}$/.test(r.directory))throw fault('TUDA_RECEIPT_INVALID');
 const directory=safe(base,path.join(base,'versions',r.directory)),packageRoot=safe(base,path.join(directory,'package'));
 const files=validatePackage(packageRoot,r.version);if(JSON.stringify(files)!==JSON.stringify(r.files))throw fault('TUDA_PACKAGE_MODIFIED');
 return {base,version:r.version,packageRoot,pluginEntry:path.join(packageRoot,'dist/board-plugin.js'),managerEntry:path.join(packageRoot,'dist/main.js'),source:r.source};
}
function activate(base,source,version,origin){
 const stage=fs.mkdtempSync(path.join(base,'stage-'));fs.chmodSync(stage,0o700);
 try{
  const pkg=path.join(stage,'package');fs.cpSync(source,pkg,{recursive:true,force:false,errorOnExist:true});
  const files=validatePackage(pkg,version),directory=version+'-'+hash(JSON.stringify(files)).slice(0,16)+'-'+crypto.randomUUID().slice(0,8),dest=path.join(base,'versions',directory);
  if(fs.existsSync(dest))throw fault('TUDA_VERSION_EXISTS');fs.renameSync(stage,dest);
  save(path.join(base,'active.json'),{contract:1,package:PACKAGE,version,directory,files,source:origin});
 }finally{if(fs.existsSync(stage))fs.rmSync(stage,{recursive:true,force:true});}
}
export async function selectTudaRuntime({root,bundle}){
 const meta=json(path.join(bundle,'tuda-plugin.json')),base=path.join(root,'native-plugins','tuda');
 if(meta.contract!==2||meta.connection!=='independent-existing'||Object.hasOwn(meta,'desktop'))throw fault('TUDA_BUNDLE_INVALID');
 own(base);let current=selection(base);
 if(current&&!isNewer(meta.version,current.version))return current;
 await locked({root:base,manager:base},async()=>{current=selection(base);if(!current||isNewer(meta.version,current.version))activate(base,path.join(bundle,'node_modules/@petercjl/tuda'),meta.version,{kind:'bundled',version:meta.version});});
 return selection(base);
}
async function bytes(response,limit){if(!response.ok)throw fault('TUDA_REGISTRY_UNAVAILABLE');let size=0;const chunks=[];for await(const chunk of response.body){if((size+=chunk.length)>limit)throw fault('TUDA_RESPONSE_TOO_LARGE');chunks.push(Buffer.from(chunk));}return Buffer.concat(chunks);}
function compatible(candidate,current){const a=candidate.split('.').map(Number),b=current.split('.').map(Number);return a[0]===b[0]&&(a[0]!==0||a[1]===b[1]);}
export async function updateTudaRuntime(current,{fetcher=networkFetch,now=Date.now(),force=false,signal}={}){
 own(current.base);
 const {base}=current,stateFile=path.join(base,'update.json'),policy=json(path.join(current.packageRoot,'capabilities.json')).nativePlugin.updates;
 const state=fs.existsSync(stateFile)?json(stateFile):null;
 if(!force&&state?.checkedAt&&now-state.checkedAt<policy.intervalHours*3600000)return {status:'throttled',activeVersion:current.version};
 try{return await locked({root:base,manager:base},async()=>{
  const last=fs.existsSync(stateFile)?json(stateFile):null;if(!force&&last?.checkedAt&&now-last.checkedAt<policy.intervalHours*3600000)return {status:'throttled',activeVersion:current.version};
  save(stateFile,{contract:1,checkedAt:now,status:'checking'});
  let temporary;
  try{
   const installed=selection(base)||current;
   const get=(url,timeout)=>fetcher(url,{redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout)});
   const metadata=JSON.parse((await bytes(await get(REGISTRY,policy.timeoutMs),2*1024*1024)).toString('utf8')),v=metadata.version;
   if(metadata.name!==PACKAGE||!/^\d+\.\d+\.\d+$/.test(v||''))throw fault('TUDA_REGISTRY_INVALID');
   if(!compatible(v,installed.version)){const result={status:'deferred',reason:'INCOMPATIBLE_VERSION',available:v,activeVersion:current.version};save(stateFile,{contract:1,checkedAt:now,...result});return result;}
   if(!isNewer(v,installed.version)&&!(v===installed.version&&installed.source?.kind==='bundled')){const result={status:'current',activeVersion:current.version,installedVersion:installed.version};save(stateFile,{contract:1,checkedAt:now,...result});return result;}
   const url=`https://registry.npmjs.org/@petercjl/tuda/-/tuda-${v}.tgz`,integrity=metadata.dist?.integrity;
   if(metadata.dist?.tarball!==url||typeof integrity!=='string'||!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity)||Buffer.from(integrity.slice(7),'base64').length!==64)throw fault('TUDA_INTEGRITY_INVALID');
   const archive=await bytes(await get(url,10000),8*1024*1024);if('sha512-'+crypto.createHash('sha512').update(archive).digest('base64')!==integrity)throw fault('TUDA_INTEGRITY_MISMATCH');
   temporary=fs.mkdtempSync(path.join(base,'download-'));fs.chmodSync(temporary,0o700);const tarball=path.join(temporary,'package.tgz');fs.writeFileSync(tarball,archive,{flag:'wx',mode:0o600});
   const entries=archiveInventory(tarball);if(entries.length>2048||entries.reduce((n,e)=>n+e.size,0)>32*1024*1024||entries.some(e=>!e.name.startsWith('package/')||!['File','OldFile','ContiguousFile','Directory'].includes(e.type)))throw fault('UNSAFE_TUDA_PACKAGE');
   const unpacked=path.join(temporary,'unpacked');fs.mkdirSync(unpacked,{mode:0o700});extract({file:tarball,cwd:unpacked,sync:true,strip:1,strict:true,preservePaths:false});
   validatePackage(unpacked,v);
   activate(base,unpacked,v,{kind:'npm',registry:'https://registry.npmjs.org',tag:'latest',integrity});
   const result={status:'installed',available:v,activeVersion:current.version,nextVersion:v,activation:'next-connection'};save(stateFile,{contract:1,checkedAt:now,...result});return result;
  }catch(e){const result={status:e.code==='TUDA_CONTRACT_INCOMPATIBLE'?'deferred':'failed',reason:e.code||'TUDA_UPDATE_UNAVAILABLE',activeVersion:current.version};save(stateFile,{contract:1,checkedAt:now,...result});return result;}
  finally{if(temporary)fs.rmSync(temporary,{recursive:true,force:true});}
 });}catch(e){return {status:'deferred',reason:e.code||'BUSY',activeVersion:current.version};}
}
