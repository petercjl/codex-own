import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url),asar=require('@electron/asar'),plist=require('plist');
const {Pickle}=await import(pathToFileURL(path.join(path.dirname(require.resolve('@electron/asar')),'pickle.js')));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export function updateMacRuntime(app,output,runtime){
 const resources=path.join(app,'Contents/Resources'),archive=path.join(resources,'app.asar'),name='.vite/build/own-runtime.cjs';
 const header=asar.getRawHeader(archive).header,oldRuntime=asar.extractFile(archive,name),infoPath=path.join(app,'Contents/Info.plist'),info=plist.parse(fs.readFileSync(infoPath,'utf8'));
 if(!oldRuntime.toString().includes('codex-own-independent')||info.CFBundleIdentifier!=='local.codex-own.development')throw Error('Unknown development runtime contract');
 const old=fs.readFileSync(archive),oldHash=sha(old.subarray(16,16+old.readUInt32LE(12)));
 if(info.ElectronAsarIntegrity?.['Resources/app.asar']?.hash!==oldHash)throw Error('Candidate ASAR header integrity mismatch');
 const blocks=[];let offset=0;
 function pack(dir,prefix=''){for(const [key,entry]of Object.entries(dir.files)){
  const current=prefix+key;if(entry.files){pack(entry,current+'/');continue;}if(entry.unpacked||entry.link)continue;
  const bytes=current===name?runtime:asar.extractFile(archive,current);entry.offset=String(offset);entry.size=bytes.length;offset+=bytes.length;
  if(current===name){const size=4194304,hashes=[];for(let i=0;i<bytes.length;i+=size)hashes.push(sha(bytes.subarray(i,i+size)));entry.integrity={algorithm:'SHA256',hash:sha(bytes),blockSize:size,blocks:hashes};}
  blocks.push(bytes);
 }}pack(header);
 const hp=new Pickle();hp.writeString(JSON.stringify(header));const hb=hp.toBuffer(),sp=new Pickle();sp.writeUInt32(hb.length);const packed=Buffer.concat([sp.toBuffer(),hb,...blocks]);
 const hash=sha(packed.subarray(16,16+packed.readUInt32LE(12))),backup=path.join(output,'previous-app.asar');if(fs.existsSync(backup))throw Error('ASAR backup exists');fs.renameSync(archive,backup);fs.writeFileSync(archive,packed,{flag:'wx'});
 const infoBackup=path.join(output,'previous-info.plist');fs.copyFileSync(infoPath,infoBackup,fs.constants.COPYFILE_EXCL);info.ElectronAsarIntegrity['Resources/app.asar'].hash=hash;fs.writeFileSync(infoPath,plist.build(info));
 const framework=fs.realpathSync(path.join(app,'Contents/Frameworks/Codex Framework.framework/Codex Framework')),bytes=fs.readFileSync(framework),sentinel=Buffer.from('AGbevlPCksUGKNL8TSn7wGmJEuJsXb2A'),index=bytes.indexOf(sentinel);
 if(index<0||bytes.lastIndexOf(sentinel)!==index||bytes[index+32]!==1||bytes[index+33]!==1)throw Error('Unknown framework integrity contract');
 fs.copyFileSync(framework,path.join(output,'previous-framework'),fs.constants.COPYFILE_EXCL);crypto.createHash('sha256').update('Resources/app.asarSHA256'+hash).digest().copy(bytes,index+34);fs.writeFileSync(framework,bytes);
 return {runtimeUpdated:true,asarHeaderHash:hash};
}
