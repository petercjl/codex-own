// Upgrade only a fresh copy of a previously verified codex-own build.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {bundleUpdater,verifyUpdater} from './updater.mjs';
import {updateMenuChanges} from './update-menu.mjs';
const require=createRequire(import.meta.url),asar=require('@electron/asar');
const root=path.resolve(import.meta.dirname,'..');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
export async function upgradeUpdater(app,{version,node}={}){
 const mac=process.platform==='darwin';
 const resources=path.join(app,mac?'Contents/Resources':'resources'),archive=path.join(resources,'app.asar');
 const plist=mac?require('plist'):null,infoFile=path.join(app,'Contents/Info.plist');
 const info=mac?plist.parse(fs.readFileSync(infoFile,'utf8')):JSON.parse(fs.readFileSync(path.join(app,'codex-own-build.json')));
 if((mac?info.CFBundleIdentifier:info.identity)!=='local.codex-own')throw Error('Only verified codex-own builds can receive this overlay');
 const bundled=path.join(resources,'own-updater');
 asar.uncache(archive);const header=asar.getRawHeader(archive).header;
 const menuChanges=mac?new Map():updateMenuChanges(asar,archive);
 const runtimeFile='.vite/build/'+(mac?'own-runtime.cjs':'own-runtime-win.cjs');
 if(!asar.extractFile(archive,runtimeFile.replaceAll('/',path.sep)).toString().includes('codex-own-independent'))throw Error('Independent bootstrap missing');
 if(fs.existsSync(bundled)){
   const meta=JSON.parse(fs.readFileSync(path.join(bundled,'desktop-version.json')));
   const same=folder=>fs.readdirSync(path.join(root,folder)).every(name=>fs.readFileSync(path.join(root,folder,name)).equals(fs.readFileSync(path.join(bundled,folder,name))));
   if(!menuChanges.size&&meta.version===version&&same('desktop')&&same('lib')&&asar.extractFile(archive,runtimeFile.replaceAll('/',path.sep)).equals(fs.readFileSync(path.join(root,'runtime',mac?'mac.cjs':'windows.cjs'))))return {ok:true,unchanged:true,...verifyUpdater(resources)};
 }
 // Keep a recovery point even though this is a fresh candidate, not the installed app.
 const backup=fs.mkdtempSync(path.join(path.dirname(app),'before-npm-updater-'));
 if(fs.existsSync(bundled))fs.renameSync(bundled,path.join(backup,'own-updater'));
 fs.copyFileSync(archive,path.join(backup,'app.asar'),fs.constants.COPYFILE_EXCL);
 if(mac)fs.copyFileSync(infoFile,path.join(backup,'Info.plist'),fs.constants.COPYFILE_EXCL);
 else for(const f of ['codex-own.exe','codex-own-build.json'])fs.copyFileSync(path.join(app,f),path.join(backup,f),fs.constants.COPYFILE_EXCL);
 const {Pickle}=await import(pathToFileURL(path.join(path.dirname(require.resolve('@electron/asar')),'pickle.js')));
 let offset=0;const buffers=[];
 function pack(dir,prefix=''){for(const[name,e]of Object.entries(dir.files)){
   const file=prefix+name;if(e.files){pack(e,file+'/');continue;}if(e.unpacked||e.link)continue;
   const b=file===runtimeFile?fs.readFileSync(path.join(root,'runtime',mac?'mac.cjs':'windows.cjs')):menuChanges.get(file)||asar.extractFile(archive,file.replaceAll('/',path.sep));
   e.size=b.length;e.offset=String(offset);offset+=b.length;const blockSize=4194304,blocks=[];for(let i=0;i<b.length;i+=blockSize)blocks.push(sha(b.subarray(i,i+blockSize)));e.integrity={algorithm:'SHA256',hash:sha(b),blockSize,blocks};buffers.push(b);
 }}pack(header);
 const hp=new Pickle();hp.writeString(JSON.stringify(header));const hb=hp.toBuffer(),sp=new Pickle();sp.writeUInt32(hb.length);
 const data=Buffer.concat([sp.toBuffer(),hb,...buffers]),headerHash=sha(data.subarray(16,16+data.readUInt32LE(12)));
 const next=archive+'.npm-updater-new';fs.writeFileSync(next,data,{flag:'wx'});fs.renameSync(next,archive);
 bundleUpdater(resources,{version,node});
 if(mac){
   info.ElectronAsarIntegrity={'Resources/app.asar':{algorithm:'SHA256',hash:headerHash}};fs.writeFileSync(infoFile,plist.build(info));
   const framework=fs.realpathSync(path.join(app,'Contents/Frameworks/Codex Framework.framework/Codex Framework'));
   fs.copyFileSync(framework,path.join(backup,'Codex Framework'),fs.constants.COPYFILE_EXCL);
   const bytes=fs.readFileSync(framework),sentinel=Buffer.from('AGbevlPCksUGKNL8TSn7wGmJEuJsXb2A'),i=bytes.indexOf(sentinel);
   if(i<0||bytes.lastIndexOf(sentinel)!==i||bytes[i+32]!==1||bytes[i+33]!==1)throw Error('Unknown framework integrity contract');
   crypto.createHash('sha256').update('Resources/app.asarSHA256'+headerHash).digest().copy(bytes,i+34);fs.writeFileSync(framework,bytes);
   execFileSync('codesign',['--force','--deep','--sign','-',app],{stdio:'pipe'});execFileSync('codesign',['--verify','--deep','--strict',app],{stdio:'pipe'});
 }else{
   const PE=require('pe-library'),exeFile=path.join(app,'codex-own.exe'),exe=PE.NtExecutable.from(fs.readFileSync(exeFile),{ignoreCert:true}),res=PE.NtExecutableResource.from(exe);
   const integrity=res.entries.find(e=>e.type==='INTEGRITY'&&e.id==='ELECTRONASAR');if(!integrity)throw Error('PE integrity resource missing');
   const values=JSON.parse(Buffer.from(integrity.bin).toString());if(values.length!==1||values[0].file!=='resources\\app.asar')throw Error('Unknown integrity layout');values[0].value=headerHash;integrity.bin=Buffer.from(JSON.stringify(values));res.outputResource(exe);
   fs.writeFileSync(exeFile,Buffer.from(exe.generate()));Object.assign(info,{asarHeaderHash:headerHash,asarSha256:sha(data),exeSha256:sha(fs.readFileSync(exeFile)),npmUpdater:true});fs.writeFileSync(path.join(app,'codex-own-build.json'),JSON.stringify(info,null,2));
 }
 return {ok:true,backup,...verifyUpdater(resources)};
}
const normalized=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
if(process.argv[1]&&normalized(process.argv[1])===normalized(import.meta.filename))console.log(JSON.stringify(await upgradeUpdater(path.resolve(process.argv[2]),{version:process.env.OWN_VERSION})));
