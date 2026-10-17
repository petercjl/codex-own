import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const root=path.resolve(import.meta.dirname,'..');
export function bundleUpdater(resources,{version=process.env.OWN_VERSION||JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,node=process.env.OWN_UPDATER_NODE||process.execPath}={}) {
  if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Updater requires a stable desktop version');
  const dest=path.join(resources,'own-updater');if(fs.existsSync(dest))throw Error('Updater bundle already exists');
  const actual=JSON.parse(execFileSync(node,['-p','JSON.stringify({platform:process.platform,arch:process.arch,version:process.versions.node})'],{encoding:'utf8'}));
  if(actual.platform!==process.platform||actual.arch!==process.arch||Number(actual.version.split('.')[0])<22)throw Error('Incompatible updater Node runtime');
  if(process.platform==='darwin'){
    const libraries=execFileSync('otool',['-L',node],{encoding:'utf8'}).trim().split('\n').slice(1);
    if(libraries.some(line=>!/^\s*\/(usr\/lib|System\/Library)\//.test(line)))throw Error('Updater needs a standalone Node distribution; set OWN_UPDATER_NODE to an official Node binary');
  }
  fs.mkdirSync(dest,{recursive:true});
  for(const folder of ['desktop','lib'])fs.cpSync(path.join(root,folder),path.join(dest,folder),{recursive:true,force:false,errorOnExist:true});
  function copyDependency(name,resolver,parent){
    let dependency=path.dirname(resolver.resolve(name));
    while(!fs.existsSync(path.join(dependency,'package.json'))||JSON.parse(fs.readFileSync(path.join(dependency,'package.json'))).name!==name){
      const parent=path.dirname(dependency);if(parent===dependency)throw Error('Updater dependency package missing: '+name);dependency=parent;
    }
    const target=path.join(parent,'node_modules',name),metadata=JSON.parse(fs.readFileSync(path.join(dependency,'package.json')));
    if(fs.existsSync(target)){if(JSON.parse(fs.readFileSync(path.join(target,'package.json'))).version!==metadata.version)throw Error('Updater dependency conflict: '+name);return;}
    fs.mkdirSync(path.dirname(target),{recursive:true});fs.cpSync(dependency,target,{recursive:true,force:false,errorOnExist:true});
    const childRequire=createRequire(path.join(dependency,'package.json'));
    for(const child of Object.keys(metadata.dependencies||{}))copyDependency(child,childRequire,target);
  }
  for(const name of ['undici','smol-toml','tar','adm-zip'])copyDependency(name,require,dest);
  fs.copyFileSync(node,path.join(dest,process.platform==='win32'?'node.exe':'node'),fs.constants.COPYFILE_EXCL);
  if(process.platform==='darwin')fs.chmodSync(path.join(dest,'node'),0o755);
  fs.writeFileSync(path.join(dest,'package.json'),JSON.stringify({name:'@petercjl/codex-own',version,type:'module'}),{flag:'wx'});
  const defaults=JSON.parse(fs.readFileSync(path.join(root,'release.json')));
  fs.writeFileSync(path.join(dest,'release.json'),JSON.stringify({schema:2,repository:'petercjl/codex-own',version,runtimes:defaults.runtimes}),{flag:'wx'});
  const toolRuntimeVersion=JSON.parse(fs.readFileSync(path.join(root,'runtime','sources.json'))).version;
  fs.writeFileSync(path.join(dest,'desktop-version.json'),JSON.stringify({schema:1,version,updaterContract:2,runtimeContract:1,toolRuntimeVersion,source:'https://registry.npmjs.org/@petercjl%2fcodex-own/latest'}),{flag:'wx'});
  return {dest,version,nodeVersion:actual.version};
}
export function verifyUpdater(resources){
  const dest=path.join(resources,'own-updater'),meta=JSON.parse(fs.readFileSync(path.join(dest,'desktop-version.json')));
  fs.statSync(path.join(dest,'desktop/product-mode.cjs'));
  if(meta.schema!==1||meta.updaterContract!==2||meta.runtimeContract!==1||!/^\d+\.\d+\.\d+$/.test(meta.version)||meta.source!=='https://registry.npmjs.org/@petercjl%2fcodex-own/latest')throw Error('Invalid own update source or component contract');
  for(const f of ['desktop/controller.cjs','desktop/preload.cjs','desktop/update.html','desktop/update-ui.js','desktop/worker.mjs','desktop/bootstrap-tools.mjs','desktop/tool-bootstrap.cjs','lib/app-update.mjs','lib/cleanup.mjs','lib/manager.mjs','lib/model-configuration.mjs','lib/windows-agent-shell.cjs','lib/tool-runtime.mjs','lib/tool-env.cjs','lib/archive-inventory.mjs','node_modules/tar/package.json','node_modules/adm-zip/package.json','node_modules/undici/package.json','node_modules/smol-toml/package.json',process.platform==='win32'?'node.exe':'node'])fs.statSync(path.join(dest,f));
  const node=path.join(dest,process.platform==='win32'?'node.exe':'node');
  execFileSync(node,['--input-type=module','-e',"await import('./lib/app-update.mjs')"],{cwd:dest,stdio:'pipe'});
  return {version:meta.version,source:'npm',bundledNode:true};
}
