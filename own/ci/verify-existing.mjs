import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {validateManifest,digestFile,unpack} from '../lib/manager.mjs';
import {repairWindowsTranslations,verifyTranslations} from '../builders/i18n.mjs';
import {tarExecutable} from '../lib/manager.mjs';
import {upgradeUpdater} from '../builders/upgrade-updater.mjs';
const version=process.env.OWN_VERSION,key=process.env.OWN_PLATFORM;
const dir=path.resolve('out',`own-release-${version}-${key}`);fs.mkdirSync(dir,{recursive:true});
const gh=(args)=>execFileSync('gh',args,{stdio:'inherit'});
gh(['release','download',`own-v${version}`,'--repo','petercjl/codex-own','--pattern','manifest.json','--dir',dir]);
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));
if(!manifest.platforms[key])throw Error('Missing platform '+key);
const a=validateManifest(manifest,key),file=path.join(dir,path.basename(new URL(a.url).pathname));
const sourceVersion=a.sourceVersion||version;
if(!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(sourceVersion))throw Error('Invalid prepared source version');
gh(['release','download',`own-v${sourceVersion}`,'--repo','petercjl/codex-own','--pattern',path.basename(file),'--dir',dir]);
if(fs.statSync(file).size!==a.size||await digestFile(file)!==a.sha256)throw Error('Artifact mismatch');
const dest=path.join(dir,'unpacked');unpack(file,dest);
if(key==='win32-x64'&&manifest.provenance?.repairWindowsI18n===true){
  console.log(JSON.stringify(await repairWindowsTranslations(path.join(dest,a.entry))));
  // Preserve the verified input before repacking the repaired candidate.
  fs.copyFileSync(file,path.join(dir,'original-before-i18n.bin'),fs.constants.COPYFILE_EXCL);
  const next=file+'.new';
  execFileSync(tarExecutable(),['-czf',next,'-C',dest,a.entry],{stdio:'inherit'});
  fs.renameSync(next,file);
  a.sha256=await digestFile(file);a.size=fs.statSync(file).size;delete a.sourceVersion;
  const inputManifest=path.join(dir,'manifest.json');
  fs.copyFileSync(inputManifest,inputManifest+'.before-i18n',fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(inputManifest,JSON.stringify(manifest,null,2));
}
verifyTranslations(path.join(dest,a.entry));
if(manifest.provenance?.upgradeNpmUpdater===true||fs.existsSync(path.join(dest,a.entry,key==='darwin-arm64'?'Contents/Resources':'resources','own-updater'))){
  const upgraded=await upgradeUpdater(path.join(dest,a.entry),{version});console.log(JSON.stringify(upgraded));
  if(!upgraded.unchanged){
    fs.copyFileSync(file,file+'.before-npm-updater',fs.constants.COPYFILE_EXCL);
    const next=file+'.npm-updater-new';execFileSync(tarExecutable(),['-czf',next,'-C',dest,a.entry],{stdio:'inherit'});fs.renameSync(next,file);
    a.sha256=await digestFile(file);a.size=fs.statSync(file).size;delete a.sourceVersion;
    const inputManifest=path.join(dir,'manifest.json');fs.copyFileSync(inputManifest,inputManifest+'.before-npm-updater',fs.constants.COPYFILE_EXCL);fs.writeFileSync(inputManifest,JSON.stringify(manifest,null,2));
  }
}
if(key==='win32-x64')execFileSync(process.execPath,['own/ci/test-windows-install.mjs',file,path.join(dir,'manifest.json')],{stdio:'inherit'});
execFileSync(process.execPath,['own/test-app.mjs',path.join(dest,a.entry)],{stdio:'inherit'});
if(key==='darwin-arm64')execFileSync('codesign',['--verify','--deep','--strict',path.join(dest,a.entry)],{stdio:'inherit'});
fs.writeFileSync(path.join(dir,`manifest-${key}.json`),JSON.stringify({...manifest,platforms:{[key]:a}}),{flag:'wx'});
