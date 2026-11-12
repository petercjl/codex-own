import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {bundleTuda} from './tuda-plugin.mjs';
const require=createRequire(import.meta.url);
const {resolveBundledNode}=require('../lib/bundled-node.cjs');
const root=path.resolve(import.meta.dirname,'..');
export function dependencyRoot(name,resolver){
  for(const spec of [name+'/package.json',name]){
    try{let current=path.dirname(resolver.resolve(spec));while(true){const metadata=path.join(current,'package.json');if(fs.existsSync(metadata)&&JSON.parse(fs.readFileSync(metadata)).name===name)return current;const parent=path.dirname(current);if(parent===current)break;current=parent;}}
    catch(error){if(!['MODULE_NOT_FOUND','ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code))throw error;}
  }
  // Subpath-only packages (for example @babel/runtime) have no exported root.
  // Search the resolver's own Node lookup paths and verify package identity.
  for(const directory of resolver.resolve.paths(name)||[]){const candidate=path.join(directory,name),metadata=path.join(candidate,'package.json');if(fs.existsSync(metadata)&&JSON.parse(fs.readFileSync(metadata)).name===name)return candidate;}
  throw Error('Updater dependency package missing: '+name);
}
export function copyRuntimeDependencies(names,resolver,destination){
  const reserved=new Map(names.map(name=>[name,JSON.parse(fs.readFileSync(path.join(dependencyRoot(name,resolver),'package.json'))).version]));
  const stats={packages:0,prunedFiles:0,prunedBytes:0};
  function copy(name,from,parent){
    const dependency=dependencyRoot(name,from),metadata=JSON.parse(fs.readFileSync(path.join(dependency,'package.json')));
    const shared=path.join(destination,'node_modules',name),existing=fs.existsSync(shared)?JSON.parse(fs.readFileSync(path.join(shared,'package.json'))).version:null;
    const target=(!reserved.has(name)||reserved.get(name)===metadata.version)&&(!existing||existing===metadata.version)?shared:path.join(parent,'node_modules',name);
    if(fs.existsSync(target)){if(JSON.parse(fs.readFileSync(path.join(target,'package.json'))).version!==metadata.version)throw Error('Updater dependency conflict: '+name);return;}
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.cpSync(dependency,target,{recursive:true,force:false,errorOnExist:true,filter:file=>{
      if(path.relative(dependency,file).split(path.sep).includes('node_modules'))return false;
      if(/(?:\.map|\.d\.(?:ts|mts|cts))$/.test(file)&&fs.lstatSync(file).isFile()){stats.prunedFiles++;stats.prunedBytes+=fs.statSync(file).size;return false;}return true;
    }});stats.packages++;
    const childRequire=createRequire(path.join(dependency,'package.json'));
    for(const child of Object.keys({...metadata.dependencies,...metadata.optionalDependencies})){
      try{dependencyRoot(child,childRequire);}catch(e){if(metadata.optionalDependencies?.[child])continue;throw e;}
      copy(child,childRequire,target);
    }
  }
  for(const name of names)copy(name,resolver,destination);return stats;
}
// The copied app is still being modified. Executing inside it before sealing
// lets Gatekeeper assess the old signature against new resources. Probe a
// standalone copy instead, leaving every app-owned binary unexecuted until signed.
export function probeApplicationNode(node,probe,{temporaryRoot=os.tmpdir()}={}){
  const directory=fs.mkdtempSync(path.join(temporaryRoot,'own-node-probe-'));
  try{const copy=path.join(directory,path.basename(node));fs.copyFileSync(node,copy,fs.constants.COPYFILE_EXCL);return probe(copy);}
  finally{fs.rmSync(directory,{recursive:true,force:true});}
}
export function bundleUpdater(resources,{version=process.env.OWN_VERSION||JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,node=process.env.OWN_UPDATER_NODE||process.execPath}={}) {
  if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Updater requires a stable desktop version');
  const dest=path.join(resources,'own-updater');if(fs.existsSync(dest))throw Error('Updater bundle already exists');
  const env={...process.env};for(const key of ['NODE_OPTIONS','NODE_PATH','ELECTRON_RUN_AS_NODE'])delete env[key];
  const probe=file=>JSON.parse(execFileSync(file,['-p','JSON.stringify({platform:process.platform,arch:process.arch,version:process.versions.node})'],{encoding:'utf8',env,timeout:10000}));
  const shared=path.join(resources,'cua_node','bin',process.platform==='win32'?'node.exe':'node');let sharedRuntime=false,actual;
  if(fs.existsSync(shared)&&!fs.lstatSync(shared).isSymbolicLink())try{const p=probeApplicationNode(shared,probe);if(p.platform===process.platform&&p.arch===process.arch&&Number(p.version.split('.')[0])>=22){node=shared;actual=p;sharedRuntime=true;}}catch{}
  actual ||= probe(node);
  if(actual.platform!==process.platform||actual.arch!==process.arch||Number(actual.version.split('.')[0])<22)throw Error('Incompatible updater Node runtime');
  if(process.platform==='darwin'){
    const libraries=execFileSync('otool',['-L',node],{encoding:'utf8'}).trim().split('\n').slice(1);
    if(libraries.some(line=>!/^\s*\/(usr\/lib|System\/Library)\//.test(line)))throw Error('Updater needs a standalone Node distribution; set OWN_UPDATER_NODE to an official Node binary');
  }
  fs.mkdirSync(dest,{recursive:true});
  for(const folder of ['desktop','lib','defaults'])fs.cpSync(path.join(root,folder),path.join(dest,folder),{recursive:true,force:false,errorOnExist:true});
  const dependencies=copyRuntimeDependencies(['undici','smol-toml','tar','adm-zip','@anthropic-ai/sdk','@petercjl/toapiscli'],require,dest);
  const tuda=bundleTuda(dest,{copyDependencies:copyRuntimeDependencies});
  if(sharedRuntime)fs.writeFileSync(path.join(dest,'node-runtime.json'),JSON.stringify({schema:1,source:'application-cua-node',binary:'../cua_node/bin/'+(process.platform==='win32'?'node.exe':'node'),version:actual.version}),{flag:'wx'});
  else{fs.copyFileSync(node,path.join(dest,process.platform==='win32'?'node.exe':'node'),fs.constants.COPYFILE_EXCL);if(process.platform==='darwin')fs.chmodSync(path.join(dest,'node'),0o755);}
  fs.writeFileSync(path.join(dest,'package.json'),JSON.stringify({name:'@petercjl/codex-own',version,type:'module'}),{flag:'wx'});
  const defaults=JSON.parse(fs.readFileSync(path.join(root,'release.json')));
  const runtimes=process.env.OWN_DEVELOPMENT==='1'&&process.platform==='darwin'?JSON.parse(fs.readFileSync(path.join(root,'runtime','mac-development.json'))):defaults.runtimes;
  if(process.platform==='win32')runtimes.platforms={'win32-x64':runtimes.platforms['win32-x64']};
  fs.writeFileSync(path.join(dest,'release.json'),JSON.stringify({schema:2,repository:'petercjl/codex-own',version,runtimes}),{flag:'wx'});
  const toolRuntimeVersion=runtimes.version;
  fs.writeFileSync(path.join(dest,'desktop-version.json'),JSON.stringify({schema:1,version,updaterContract:2,runtimeContract:1,toolRuntimeVersion,source:'https://registry.npmjs.org/@petercjl%2fcodex-own/latest'}),{flag:'wx'});
  return {dest,version,nodeVersion:actual.version,sharedRuntime,dependencies,tuda};
}
export function verifyUpdater(resources){
  const dest=path.join(resources,'own-updater'),meta=JSON.parse(fs.readFileSync(path.join(dest,'desktop-version.json')));
  fs.statSync(path.join(dest,'desktop/product-mode.cjs'));
  fs.statSync(path.join(dest,'lib/ui-locale.cjs'));
  fs.statSync(path.join(dest,'lib/image-provider.cjs'));
  for(const file of ['desktop/tuda-host.cjs','lib/tuda-plugin.cjs','lib/tuda-package.mjs','lib/tuda-connection.mjs','lib/tuda-contract.cjs','defaults/tuda-inputs.json'])fs.statSync(path.join(dest,file));
  const scan=dir=>{for(const name of fs.readdirSync(dir)){const file=path.join(dir,name);if(/\.app$|^Tuda\.exe$|^tuda-desktop$/i.test(name))throw Error('Tuda desktop found in connector bundle');if(fs.lstatSync(file).isDirectory())scan(file);}};scan(dest);
  if(!require('../lib/tuda-plugin.cjs').registration(dest,path.join(dest,'verification-core')))throw Error('Bundled Tuda registration missing');
  if(meta.schema!==1||meta.updaterContract!==2||meta.runtimeContract!==1||!/^\d+\.\d+\.\d+$/.test(meta.version)||meta.source!=='https://registry.npmjs.org/@petercjl%2fcodex-own/latest')throw Error('Invalid own update source or component contract');
  for(const f of ['defaults/company-auth.json','desktop/account-display-preload.js','desktop/account.cjs','desktop/account.html','desktop/account-ui.js','desktop/account-preload.cjs','lib/managed-login.mjs','lib/bundled-image.cjs','node_modules/@petercjl/toapiscli/bin/toapiscli.mjs','node_modules/@petercjl/toapiscli/skills/toapiscli/SKILL.md','node_modules/@petercjl/toapiscli/skills/toapiscli/.runtime/dist/cli.mjs','desktop/thread-titles.cjs','lib/api-input-compat.cjs','lib/subagent-bridge.cjs','lib/subagent-bridge-runner.cjs','desktop/controller.cjs','desktop/preload.cjs','desktop/update.html','desktop/update-ui.js','desktop/worker.mjs','desktop/bootstrap-tools.mjs','desktop/tool-bootstrap.cjs','lib/app-update.mjs','lib/cleanup.mjs','lib/manager.mjs','lib/model-configuration.mjs','lib/windows-agent-shell.cjs','lib/tool-runtime.mjs','lib/tool-env.cjs','lib/archive-inventory.mjs','node_modules/tar/package.json','node_modules/adm-zip/package.json','node_modules/undici/package.json','node_modules/smol-toml/package.json','lib/bundled-node.cjs'])fs.statSync(path.join(dest,f));
  const node=resolveBundledNode(dest);fs.statSync(node);
  execFileSync(node,['--input-type=module','-e',"await import('./lib/managed-login.mjs'); await import('./lib/app-update.mjs'); await import('./lib/model-access.mjs'); await import('./lib/model-router.cjs'); await import('@anthropic-ai/sdk')"],{cwd:dest,stdio:'pipe'});
  return {version:meta.version,source:'npm',bundledNode:true};
}
