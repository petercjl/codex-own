import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {bundleUpdater} from './updater.mjs';
import {isolateRuntimeSource} from './runtime-isolation.mjs';
import {gateToolStartup} from './tool-gate.mjs';
import {isolateShellImport} from './shell-environment.mjs';
import {productModeChanges} from './product-mode.mjs';
import {titleChanges} from './thread-titles.mjs';
import {launcherScript} from './mac-launcher.mjs';
import {macSigningArguments,withMacSigning} from './mac-signing.mjs';
const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const plist = require('plist');
const {Pickle}=await import(pathToFileURL(path.join(path.dirname(require.resolve('@electron/asar')),'pickle.js')));
const root = path.resolve(import.meta.dirname, '../..');
const output = path.resolve(process.argv[2] || path.join(root, 'out', 'own-build'));
const development=process.env.OWN_DEVELOPMENT==='1';
if(process.env.OWN_DEVELOPMENT&&!development)throw Error('OWN_DEVELOPMENT must be 1 when selected');
const productName=development?'codex-own 开发版':'codex-own',scheme=development?'codex-own-dev':'codex-own';
const source = process.env.OWN_PREPARED_APP; if (!source) throw Error('Prepared upstream app required');
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw Error('This build is verified for macOS ARM64 only');
macSigningArguments(development);
if (fs.existsSync(output)) throw Error(`Output already exists: ${output}. Choose a fresh output directory.`);
for (const file of [source, path.join(root,'resources/own/codex-own.icns'), path.join(root,'resources/own/codex-own.png')]) fs.statSync(file);
fs.mkdirSync(output, {recursive:true});
const app = path.join(output,productName+'.app');
execFileSync('ditto',[source,app]);
const resources=path.join(app,'Contents/Resources');
bundleUpdater(resources);
if(development)fs.writeFileSync(path.join(resources,'own-development.json'),JSON.stringify({schema:1,channel:'development',name:productName,automaticUpdates:false,sourceRef:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()}),{flag:'wx'});
fs.writeFileSync(path.join(resources,'codex-own-cli'),'#!/bin/sh\nset -eu\nown_resources="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nexec "$own_resources/codex" "$@"\n',{flag:'wx',mode:0o755});
const work=path.join(output,'asar-source');
const originalArchive=path.join(resources,'app.asar'),header=asar.getRawHeader(originalArchive).header;
function unpackPacked(dir,prefix=''){for(const [name,e]of Object.entries(dir.files)){const n=prefix+name;if(e.files){unpackPacked(e,n+'/');continue;}if(e.unpacked||e.link)continue;const file=path.join(work,n);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,asar.extractFile(originalArchive,n),{flag:'wx'});}}
unpackPacked(header);
const ownChanges=productModeChanges(asar,originalArchive);
for(const [name,data]of titleChanges(asar,originalArchive,{priorChanges:ownChanges}))ownChanges.set(name,data);
for(const [name,data]of ownChanges)fs.writeFileSync(path.join(work,name),data);
const pkgPath=path.join(work,'package.json');
const pkg=JSON.parse(fs.readFileSync(pkgPath,'utf8'));
const entry=path.join(work,pkg.main);
if (!fs.readFileSync(entry,'utf8').startsWith('require(')) throw Error('Unknown bootstrap contract');
const runtime=path.join(path.dirname(entry),'own-runtime.cjs');
if(fs.existsSync(runtime))throw Error('Runtime already present');
fs.copyFileSync(path.join(root,'own/runtime/mac.cjs'),runtime);
fs.writeFileSync(entry,gateToolStartup('require("./own-runtime.cjs");\n'+fs.readFileSync(entry,'utf8'),'own-runtime.cjs'));
const startupFiles=fs.readdirSync(path.dirname(entry)).filter(n=>/^startup-requirements-.*\.js$/.test(n));
if(startupFiles.length!==1)throw Error('Ambiguous startup module');
const startup=path.join(path.dirname(entry),startupFiles[0]);
const before=fs.readFileSync(startup,'utf8');
fs.writeFileSync(startup,isolateShellImport(before,'own-runtime.cjs').source);
// All app-owned deep links use the personal scheme; web/service URLs stay intact.
function patchLinks(dir){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
 const file=path.join(dir,ent.name);if(ent.isDirectory()){if(ent.name!=='node_modules')patchLinks(file);}
  else if(/\.(js|html)$/.test(ent.name)){const a=fs.readFileSync(file,'utf8'),b=isolateRuntimeSource(a.replaceAll('codex://',scheme+'://'));if(a!==b)fs.writeFileSync(file,b);}
}}
patchLinks(work);
pkg.name=development?'codex-own-development':'codex-own';pkg.productName=productName;
fs.writeFileSync(pkgPath,JSON.stringify(pkg,null,2)+'\n');
header.files['.vite'].files.build.files['own-runtime.cjs']={size:0,offset:'0'};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');let offset=0;const packed=[];
function pack(dir,prefix=''){for(const[name,e]of Object.entries(dir.files)){const n=prefix+name;if(e.files){pack(e,n+'/');continue;}if(e.unpacked||e.link)continue;const b=fs.readFileSync(path.join(work,n));e.size=b.length;e.offset=String(offset);offset+=b.length;const blockSize=4194304,blocks=[];for(let i=0;i<b.length;i+=blockSize)blocks.push(sha(b.subarray(i,i+blockSize)));e.integrity={algorithm:'SHA256',hash:sha(b),blockSize,blocks};packed.push(b);}}
pack(header);const hp=new Pickle();hp.writeString(JSON.stringify(header));const hb=hp.toBuffer(),sp=new Pickle();sp.writeUInt32(hb.length);fs.writeFileSync(originalArchive,Buffer.concat([sp.toBuffer(),hb,...packed]));
const archive=fs.readFileSync(path.join(resources,'app.asar'));
const hash=crypto.createHash('sha256').update(archive.subarray(16,16+archive.readUInt32LE(12))).digest('hex');
const infoFile=path.join(app,'Contents/Info.plist');
const info=plist.parse(fs.readFileSync(infoFile,'utf8'));
Object.assign(info,{CFBundleIdentifier:development?'local.codex-own.development':'local.codex-own',CFBundleName:productName,CFBundleDisplayName:productName,CFBundleExecutable:'codex-own-launch',CFBundleIconFile:'codex-own.icns',CFBundleAlternateNames:[productName],CrProductDirName:'codex-own-independent',CFBundleURLTypes:[{CFBundleURLName:scheme,CFBundleURLSchemes:[scheme]}],ElectronAsarIntegrity:{'Resources/app.asar':{algorithm:'SHA256',hash}}});
delete info.CFBundleIconName;delete info.CodexAppIconBaseName;delete info.CFBundleIconAssets;
fs.writeFileSync(infoFile,plist.build(info));
for(const ext of ['png','icns'])fs.copyFileSync(path.join(root,`resources/own/codex-own.${ext}`),path.join(resources,`codex-own.${ext}`));
// Force the known runtime icon filenames to the new asset as well.
for(const name of fs.readdirSync(resources).filter(n=>/^icon-(chatgpt|codex|space).*\.png$/.test(n)))fs.copyFileSync(path.join(resources,'codex-own.png'),path.join(resources,name));
const launcher=path.join(app,'Contents/MacOS/codex-own-launch');
fs.writeFileSync(launcher,launcherScript(development),{flag:'wx',mode:0o755});
const framework=fs.realpathSync(path.join(app,'Contents/Frameworks/Codex Framework.framework/Codex Framework'));
const bytes=fs.readFileSync(framework),sentinel=Buffer.from('AGbevlPCksUGKNL8TSn7wGmJEuJsXb2A');
const index=bytes.indexOf(sentinel);
if(index<0||bytes.lastIndexOf(sentinel)!==index||bytes[index+32]!==1||bytes[index+33]!==1)throw Error('Unknown framework integrity contract');
crypto.createHash('sha256').update('Resources/app.asarSHA256'+hash).digest().copy(bytes,index+34);
fs.writeFileSync(framework,bytes);
// Resources is not a nested-code directory for codesign --deep. The copied
// standalone CLI needs its own signature before sealing the parent app.
const standaloneCli=path.join(resources,'codex');
withMacSigning(development,signing=>{
execFileSync('codesign',['--force',...signing,standaloneCli],{stdio:'inherit'});
execFileSync('codesign',['--verify','--strict',standaloneCli],{stdio:'inherit'});
execFileSync('codesign',['--force','--deep',...signing,app],{stdio:'inherit'});
execFileSync('codesign',['--verify','--deep','--strict',app],{stdio:'inherit'});
});
fs.writeFileSync(path.join(output,'build-manifest.json'),JSON.stringify({app,source,version:pkg.version,asarHeaderHash:hash,identity:info.CFBundleIdentifier,stateRoot:'~/Library/Application Support/codex-own-independent',created:new Date().toISOString()},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({ok:true,app,version:pkg.version}));
