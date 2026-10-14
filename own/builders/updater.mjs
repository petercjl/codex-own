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
  const dependency=path.dirname(require.resolve('undici/package.json'));
  fs.cpSync(dependency,path.join(dest,'node_modules','undici'),{recursive:true,force:false,errorOnExist:true});
  fs.copyFileSync(node,path.join(dest,process.platform==='win32'?'node.exe':'node'),fs.constants.COPYFILE_EXCL);
  if(process.platform==='darwin')fs.chmodSync(path.join(dest,'node'),0o755);
  fs.writeFileSync(path.join(dest,'package.json'),JSON.stringify({name:'@petercjl/codex-own',version,type:'module'}),{flag:'wx'});
  fs.copyFileSync(path.join(root,'release.json'),path.join(dest,'release.json'),fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(dest,'desktop-version.json'),JSON.stringify({schema:1,version,source:'https://registry.npmjs.org/@petercjl%2fcodex-own/latest'}),{flag:'wx'});
  return {dest,version,nodeVersion:actual.version};
}
export function verifyUpdater(resources){
  const dest=path.join(resources,'own-updater'),meta=JSON.parse(fs.readFileSync(path.join(dest,'desktop-version.json')));
  if(meta.schema!==1||!/^\d+\.\d+\.\d+$/.test(meta.version)||meta.source!=='https://registry.npmjs.org/@petercjl%2fcodex-own/latest')throw Error('Invalid own update source');
  for(const f of ['desktop/controller.cjs','desktop/preload.cjs','desktop/update.html','desktop/update-ui.js','desktop/worker.mjs','lib/app-update.mjs','lib/manager.mjs','node_modules/undici/package.json',process.platform==='win32'?'node.exe':'node'])fs.statSync(path.join(dest,f));
  const node=path.join(dest,process.platform==='win32'?'node.exe':'node');
  execFileSync(node,['--input-type=module','-e',"await import('./lib/app-update.mjs')"],{cwd:dest,stdio:'pipe'});
  return {version:meta.version,source:'npm',bundledNode:true};
}
