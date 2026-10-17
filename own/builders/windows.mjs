import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {verifyTranslations} from './i18n.mjs';
import {bundleUpdater} from './updater.mjs';
import {updateMenuChanges} from './update-menu.mjs';
import {isolateRuntimeSource} from './runtime-isolation.mjs';
import {gateToolStartup} from './tool-gate.mjs';
import {isolateShellImport} from './shell-environment.mjs';
import {productModeChanges} from './product-mode.mjs';
const require=createRequire(import.meta.url);
const asar=require('@electron/asar'),PE=require('pe-library'),RE=require('resedit'),acorn=require('acorn');
const {Pickle}=await import(pathToFileURL(path.join(path.dirname(require.resolve('@electron/asar')),'pickle.js')));
const root=path.resolve(import.meta.dirname,'../..');
const source=process.env.OWN_PREPARED_APP;if(!source)throw Error('Prepared upstream app required');
const out=path.resolve(process.argv[2]||'out/codex-own-windows-x64');
if(fs.existsSync(out))throw Error('Choose a fresh output directory');
fs.statSync(path.join(source,'ChatGPT.exe'));fs.mkdirSync(out,{recursive:true});
const app=path.join(out,'app');fs.cpSync(source,app,{recursive:true,errorOnExist:true,force:false});
const resources=path.join(app,'resources'),archive=path.join(resources,'app.asar');
bundleUpdater(resources);
const header=asar.getRawHeader(archive).header;
const pkg=JSON.parse(asar.extractFile(archive,'package.json'));
const changes=updateMenuChanges(asar,archive);
for(const [name,data]of productModeChanges(asar,archive,{priorChanges:changes}))changes.set(name,data);
pkg.name='codex-own';pkg.productName='codex-own';pkg.description='Independent DeepSeek desktop';
changes.set('package.json',Buffer.from(JSON.stringify(pkg,null,2)));
changes.set(pkg.main,Buffer.from(gateToolStartup('require("./own-runtime-win.cjs");\n'+asar.extractFile(archive,pkg.main.replaceAll('/',path.sep)).toString(),'own-runtime-win.cjs')));
changes.set('.vite/build/own-runtime-win.cjs',fs.readFileSync(path.join(root,'own/runtime/windows.cjs')));
let shellPatches=0,updaterPatches=0;
function walk(node,fn){if(!node||typeof node!=='object')return;fn(node);for(const v of Object.values(node)){if(Array.isArray(v))for(const x of v)walk(x,fn);else if(v&&typeof v==='object')walk(v,fn)}}
for(const name of asar.listPackage(archive).map(n=>n.replaceAll('\\','/').replace(/^\//,'')).filter(n=>n.startsWith('.vite/build/')&&n.endsWith('.js'))){
 let s=changes.has(name)?changes.get(name).toString():asar.extractFile(archive,name.replaceAll('/',path.sep)).toString(),before=s;
 if(name.includes('startup-requirements-')){const result=isolateShellImport(s,'own-runtime-win.cjs');s=result.source;shellPatches+=result.patches;}
 if(s.includes('shouldIncludeUpdater')){
  const edits=[];walk(acorn.parse(s,{ecmaVersion:'latest',sourceType:'module'}),n=>{
   if(n.type==='Property'&&['shouldIncludeSparkle','shouldIncludeWindowsUpdater','shouldIncludeWindowsMsixUpdater','shouldIncludeUpdater'].includes(n.key?.name||n.key?.value)&&n.value?.body?.type==='BlockStatement')edits.push([n.value.body.start,n.value.body.end,'{return false}']);
  });for(const [a,b,v] of edits.sort((a,b)=>b[0]-a[0])){s=s.slice(0,a)+v+s.slice(b);updaterPatches++}
 }
 s=isolateRuntimeSource(s.replaceAll('codex://','codex-own://'));if(s!==before)changes.set(name,Buffer.from(s));
}
if(shellPatches!==1||updaterPatches===0)throw Error('Required Windows isolation patch missing');
// Rebuild packed data while preserving every original unpacked/link entry.
// Some optional device native bindings are absent in the upstream MSIX itself.
const runtimeEntry=header.files['.vite'].files.build.files;
runtimeEntry['own-runtime-win.cjs']={size:0,offset:'0'};
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
let offset=0;const buffers=[];
function pack(dir,prefix=''){
 for(const [name,entry] of Object.entries(dir.files)){
  const file=prefix+name;
  if(entry.files){pack(entry,file+'/');continue}
  if(entry.unpacked||entry.link)continue;
  const data=changes.get(file)||asar.extractFile(archive,file.replaceAll('/',path.sep));
  entry.size=data.length;entry.offset=String(offset);offset+=data.length;
  const blockSize=4194304,blocks=[];for(let i=0;i<data.length;i+=blockSize)blocks.push(hash(data.subarray(i,i+blockSize)));
  entry.integrity={algorithm:'SHA256',hash:hash(data),blockSize,blocks};buffers.push(data);
 }
}
pack(header);
const hp=new Pickle();hp.writeString(JSON.stringify(header));const hb=hp.toBuffer();const sp=new Pickle();sp.writeUInt32(hb.length);
fs.writeFileSync(archive,Buffer.concat([sp.toBuffer(),hb,...buffers]));
const updated=fs.readFileSync(archive);const headerHash=hash(updated.subarray(16,16+updated.readUInt32LE(12)));
fs.writeFileSync(path.join(resources,'owl-app.ini'),`[Owl]\r\nUserDataDirectoryName=codex-own-independent\\desktop\r\nAppVersion=${pkg.version}\r\n`);
fs.writeFileSync(path.join(resources,'codex-own-runtime.json'),JSON.stringify({cli:'codex.exe'}),{flag:'wx'});
const png=fs.readFileSync(path.join(root,'resources/own/codex-own-windows.png'));
// Windows icon uses a 256px PNG generated from our existing editable icon.
const icoPath=path.join(root,'resources/own/codex-own-windows.ico');fs.statSync(icoPath);
const icon=RE.Data.IconFile.from(fs.readFileSync(icoPath));
fs.copyFileSync(path.join(root,'resources/own/codex-own-windows.png'),path.join(resources,'codex-own.png'),fs.constants.COPYFILE_EXCL);
for(const n of fs.readdirSync(resources).filter(n=>/\.ico$/.test(n)))fs.copyFileSync(icoPath,path.join(resources,n));
const exe=PE.NtExecutable.from(fs.readFileSync(path.join(app,'ChatGPT.exe')),{ignoreCert:true});
const res=PE.NtExecutableResource.from(exe);
const integrity=res.entries.find(e=>e.type==='INTEGRITY'&&e.id==='ELECTRONASAR');if(!integrity)throw Error('PE integrity resource missing');
const values=JSON.parse(Buffer.from(integrity.bin).toString());if(values.length!==1||values[0].file!=='resources\\app.asar')throw Error('Unexpected PE integrity layout');values[0].value=headerHash;integrity.bin=Buffer.from(JSON.stringify(values));
for(const group of RE.Resource.IconGroupEntry.fromEntries(res.entries))RE.Resource.IconGroupEntry.replaceIconsForResource(res.entries,group.id,group.lang,icon.icons.map(i=>i.data));
for(const vi of RE.Resource.VersionInfo.fromEntries(res.entries)){
 for(const lang of vi.getAvailableLanguages())vi.setStringValues(lang,{FileDescription:'codex-own',ProductName:'codex-own',InternalName:'codex-own',OriginalFilename:'codex-own.exe'});
 vi.outputToResourceEntries(res.entries);
}
res.outputResource(exe);const outputExe=path.join(app,'codex-own.exe');fs.writeFileSync(outputExe,Buffer.from(exe.generate()),{flag:'wx'});
// These are the upstream launch entries in our fresh output copy only.
for(const n of ['ChatGPT.exe','Codex.exe'])fs.unlinkSync(path.join(app,n));
fs.copyFileSync(path.join(root,'scripts/Install-CodexOwn.ps1'),path.join(out,'Install-CodexOwn.ps1'),fs.constants.COPYFILE_EXCL);
fs.copyFileSync(path.join(root,'resources/own/deepseek-models.json'),path.join(out,'models.json'),fs.constants.COPYFILE_EXCL);
fs.writeFileSync(path.join(out,'api-key.example.txt'),'Replace this line with your DashScope API key.\r\n',{flag:'wx'});
const manifest={identity:'local.codex-own',version:pkg.version,architecture:'x64',exeSha256:hash(fs.readFileSync(outputExe)),asarSha256:hash(updated),asarHeaderHash:headerHash,windowsRuntimeTested:false,shellPatches,updaterPatches};
fs.writeFileSync(path.join(app,'codex-own-build.json'),JSON.stringify(manifest,null,2),{flag:'wx'});
verifyTranslations(app);
console.log(JSON.stringify({ok:true,out,...manifest}));
