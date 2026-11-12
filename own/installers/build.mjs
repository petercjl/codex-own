// Repackage an exact public npm release as a full, offline native installer.
// Desktop application bytes and their npm update binding remain unchanged.
import crypto from 'node:crypto';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {execFileSync} from 'node:child_process';import {createRequire} from 'node:module';
import {pipeline} from 'node:stream/promises';import {createGzip} from 'node:zlib';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {hashFile} from './offline-install.mjs';
import {networkFetch} from '../lib/network.mjs';
import {assembleNpmAsset} from '../lib/npm-assets.mjs';
import {validateManifest,unpack,tarExecutable} from '../lib/manager.mjs';
import {packageManifest} from '../lib/binding.mjs';
import {verifyPackageProvenance} from '../ci/npm-provenance.mjs';
import {copyRuntimeDependencies} from '../builders/updater.mjs';
import {localInstallerVersion} from './local-input.mjs';
import {withMacSigning} from '../builders/mac-signing.mjs';

const source=path.dirname(fileURLToPath(import.meta.url)),platform=process.platform+'-'+process.arch;
const [version,destination,...options]=process.argv.slice(2),mode=options.includes('--online')?'online':'offline',keepPayload=options.includes('--keep-payload');
const localIndex=options.indexOf('--local-input'),localInput=localIndex<0?null:path.resolve(options[localIndex+1]||'');
if(!/^\d+\.\d+\.\d+$/.test(version||'')||!destination||platform!=='win32-x64'||options.some((x,i)=>!['--online','--keep-payload','--local-input'].includes(x)&&!(localIndex>=0&&i===localIndex+1))||localIndex>=0&&(!options[localIndex+1]||options[localIndex+1].startsWith('--'))||localInput&&mode!=='offline')throw Error('Usage: build.mjs <exact-version> <new-output-directory> [--online] [--keep-payload] [--local-input <directory>] on Windows x64');
const output=path.resolve(destination);if(fs.existsSync(output))throw Error('Output already exists');fs.mkdirSync(output,{recursive:true});
const work=fs.mkdtempSync(path.join(os.tmpdir(),'own-full-installer-build-'));
function write(file,data,mode=0o644){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,data,{flag:'wx',mode});}
function npm(args){const base=path.dirname(process.execPath),cli=[process.env.npm_execpath,path.join(base,'node_modules/npm/bin/npm-cli.js'),path.resolve(base,'../lib/node_modules/npm/bin/npm-cli.js')].find(p=>p&&fs.existsSync(p));if(!cli)throw Error('Build-time npm CLI missing');execFileSync(process.execPath,[cli,...args],{stdio:'inherit',windowsHide:true});}
async function inventory(root){const files=[];async function visit(dir,prefix=''){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const rel=prefix+e.name,p=path.join(dir,e.name);if(e.isSymbolicLink())throw Error('Installer payload must not contain links');if(e.isDirectory())await visit(p,rel+'/');else if(e.isFile()&&rel!=='installer.json')files.push({path:rel,size:fs.statSync(p).size,sha256:await hashFile(p)});}}await visit(root);return files.sort((a,b)=>a.path.localeCompare(b.path));}
try{
 let manifest;
 if(localInput){manifest=JSON.parse(fs.readFileSync(path.join(localInput,'release.json')));if(localInstallerVersion(manifest)!==version)throw Error('Local candidate version mismatch');validateManifest(manifest,platform);}
 else{const response=await networkFetch(`https://registry.npmjs.org/@petercjl%2fcodex-own/${version}`,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Exact public release unavailable: '+response.status);
 const published=await response.json();manifest=packageManifest(published,version);validateManifest(manifest,platform);await verifyPackageProvenance(published,manifest.binding.managerSource);}
 const payload=path.join(work,'payload');fs.mkdirSync(payload);write(path.join(payload,'release.json'),JSON.stringify(manifest,null,2)+'\n');
 const archive=path.join(work,'desktop.tar'),cache=path.join(work,'cache');
 if(localInput)fs.copyFileSync(path.join(localInput,'desktop.tar.gz'),path.join(payload,'desktop.tar.gz'),fs.constants.COPYFILE_EXCL);
 else if(mode==='offline'){
  await assembleNpmAsset(manifest.platforms[platform],archive,cache,tarExecutable());
  await pipeline(fs.createReadStream(archive),createGzip({level:6}),fs.createWriteStream(path.join(payload,'desktop.tar.gz'),{flags:'wx'}));fs.unlinkSync(archive);
 }
 const runtimeFiles={};for(const name of ['node','python']){const a=manifest.runtimes.platforms[platform][name];runtimeFiles[name]=name+'.'+a.format;if(localInput)fs.copyFileSync(path.join(localInput,runtimeFiles[name]),path.join(payload,runtimeFiles[name]),fs.constants.COPYFILE_EXCL);else await assembleNpmAsset(a,path.join(payload,runtimeFiles[name]),cache,tarExecutable());}
 const nodeSource=path.join(work,'node-source');unpack(path.join(payload,runtimeFiles.node),nodeSource);
 const nodeBinary=path.join(nodeSource,manifest.runtimes.platforms[platform].node.entry,process.platform==='win32'?'node.exe':'bin/node');
 const engine=path.join(payload,'engine');
 if(localInput){
  const packageDir=path.join(localInput,'manager'),metadata=JSON.parse(fs.readFileSync(path.join(packageDir,'package.json')));if(metadata.name!=='@petercjl/codex-own'||metadata.version!==version)throw Error('Local manager identity mismatch');
  fs.cpSync(packageDir,engine,{recursive:true,force:false,errorOnExist:true,filter:f=>!path.relative(packageDir,f).split(path.sep).includes('node_modules')});
  copyRuntimeDependencies(Object.keys(metadata.dependencies||{}),createRequire(path.join(packageDir,'package.json')),engine);
 }else{
 const packages=path.join(work,'packages');fs.mkdirSync(packages);write(path.join(packages,'package.json'),JSON.stringify({private:true,dependencies:{'@petercjl/codex-own':version}}));
 npm(['install','--prefix',packages,'--omit=dev','--ignore-scripts','--no-audit','--no-fund','--registry=https://registry.npmjs.org']);
 const packageDir=path.join(packages,'node_modules/@petercjl/codex-own');fs.cpSync(packageDir,engine,{recursive:true,force:false,errorOnExist:true});
 if(JSON.parse(fs.readFileSync(path.join(engine,'package.json'))).version!==version)throw Error('Installed manager version mismatch');
 fs.mkdirSync(path.join(engine,'node_modules'));for(const entry of fs.readdirSync(path.join(packages,'node_modules'),{withFileTypes:true})){if(entry.name.startsWith('.')||entry.name==='@petercjl')continue;fs.cpSync(path.join(packages,'node_modules',entry.name),path.join(engine,'node_modules',entry.name),{recursive:true,force:false,errorOnExist:true});}
 }
 fs.copyFileSync(nodeBinary,path.join(engine,process.platform==='win32'?'node.exe':'node'),fs.constants.COPYFILE_EXCL);if(process.platform==='darwin')fs.chmodSync(path.join(engine,'node'),0o755);
 for(const file of ['offline-install.mjs','uninstall-check.cjs','bootstrap-node.ps1','local-input.mjs'])fs.copyFileSync(path.join(source,file),path.join(payload,file),fs.constants.COPYFILE_EXCL);
 const info={schema:2,mode,package:'@petercjl/codex-own',managerVersion:version,desktopVersion:manifest.version,platform,runtimeFiles,...(localInput?{channel:'local-candidate'}:{}),bootstrap:{nodeEntry:manifest.runtimes.platforms[platform].node.entry+'/node.exe'}};
 let artifact;
 if(process.platform==='win32'){
  write(path.join(payload,'installer.json'),JSON.stringify({...info,files:await inventory(payload)},null,2)+'\n');
  // The same verified node.zip starts the installer and supplies private tools.
  // NSIS prepares engine/node.exe after extraction; do not ship it a second time.
  fs.unlinkSync(path.join(engine,'node.exe'));
  artifact=path.join(output,`codex-own-${version}-windows-x64-${mode==='online'?'online-':''}setup.exe`);
  const nsis=process.env.OWN_MAKENSIS||path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','NSIS','makensis.exe');
  execFileSync(nsis,['/VERSION'],{stdio:'inherit'});
  execFileSync(nsis,['/V3','/INPUTCHARSET','UTF8',`/DPAYLOAD=${payload}`,`/DOUTPUT=${artifact}`,`/DVERSION=${version}`,`/DMODE=${mode}`,path.join(source,'windows.nsi')],{stdio:'inherit',windowsHide:true});
 }else{
  const imageRoot=path.join(work,'dmg-root'),app=path.join(imageRoot,'codex-own 安装器.app'),contents=path.join(app,'Contents'),resources=path.join(contents,'Resources');fs.mkdirSync(path.join(contents,'MacOS'),{recursive:true});fs.renameSync(payload,resources);
  write(path.join(contents,'Info.plist'),`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>local.codex-own.installer</string><key>CFBundleName</key><string>codex-own 安装器</string><key>CFBundleDisplayName</key><string>codex-own 安装器</string><key>CFBundleExecutable</key><string>codex-own-install</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>${version}</string><key>CFBundleVersion</key><string>${version}</string><key>LSMinimumSystemVersion</key><string>13.0</string><key>NSHighResolutionCapable</key><true/></dict></plist>`);
  execFileSync('xcrun',['swiftc','-O','-framework','Cocoa','-target','arm64-apple-macos13.0',path.join(source,'mac.swift'),'-o',path.join(contents,'MacOS/codex-own-install')],{stdio:'inherit'});
  withMacSigning(false,signing=>{execFileSync('codesign',['--force',...signing,path.join(resources,'engine/node')],{stdio:'inherit'});});
  write(path.join(resources,'installer.json'),JSON.stringify({...info,files:await inventory(resources)},null,2)+'\n');
  withMacSigning(false,signing=>{execFileSync('codesign',['--force',...signing,app],{stdio:'inherit'});});execFileSync('codesign',['--verify','--deep','--strict',app],{stdio:'inherit'});
  write(path.join(imageRoot,'安装说明.txt'),'打开“codex-own 安装器”，点击“安装”。可选择自己的 API 配置 txt 文件。安装后从“应用程序”打开 codex-own。后续在应用内使用“更新”菜单。\n');
  artifact=path.join(output,`codex-own-${version}-mac-arm64.dmg`);execFileSync('hdiutil',['create','-volname',`codex-own ${version}`,'-srcfolder',imageRoot,'-format','UDZO',artifact],{stdio:'inherit'});
 }
 const installerSources={};for(const file of ['build.mjs','offline-install.mjs','local-input.mjs','windows.nsi','bootstrap-node.ps1','uninstall-check.cjs'])installerSources[file]=await hashFile(path.join(source,file));
 const installerSourceFingerprint=crypto.createHash('sha256').update(JSON.stringify(installerSources)).digest('hex');
 const record={schema:1,mode,version,...(localInput?{channel:'local-candidate',published:false,sourceFingerprint:manifest.localCandidate.sourceFingerprint,desktopSourceFingerprint:manifest.localCandidate.sourceFingerprint,installerSourceFingerprint,installerSources}:{}),desktopVersion:manifest.version,platform,artifact:path.basename(artifact),size:fs.statSync(artifact).size,sha256:await hashFile(artifact),sourceRun:process.env.GITHUB_RUN_ID||null,sourceRef:process.env.GITHUB_SHA||null,desktopIdentity:manifest.platforms[platform].sha256,runtimeVersion:manifest.runtimes.version,offline:mode==='offline',updateSource:'https://registry.npmjs.org/@petercjl%2fcodex-own/latest',macSigning:process.platform==='darwin'?'self-signed; not notarized':undefined};
 write(path.join(output,`installer-${platform}.json`),JSON.stringify(record,null,2)+'\n');write(path.join(output,`SHA256-${platform}.txt`),record.sha256+'  '+record.artifact+'\n');console.log(JSON.stringify(record));
 if(keepPayload)fs.renameSync(payload,path.join(output,'test-payload'));
}finally{fs.rmSync(work,{recursive:true,force:true});}
