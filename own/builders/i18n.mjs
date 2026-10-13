// Build-time verification and migration of previously prepared own artifacts.
// The upstream AST patch remains the single implementation of the i18n gate.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url);
const asar=require('@electron/asar'),acorn=require('acorn');
const {collectPatches}=require('../../scripts/patch-i18n.js');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const extract=(archive,file)=>asar.extractFile(archive,file.replaceAll('/',path.sep));

export function patchTranslationGate(source) {
  if(!source.includes('enable_i18n'))return {source,count:0};
  const patches=collectPatches(acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'}),source);
  for(const p of patches.sort((a,b)=>b.start-a.start))source=source.slice(0,p.start)+p.replacement+source.slice(p.end);
  return {source,count:patches.length};
}
export function inspectTranslations(archive) {
  // ASAR caches headers by filename; a repaired archive has a new header.
  asar.uncache(archive);
  const files=asar.listPackage(archive).map(n=>n.replaceAll('\\','/').replace(/^\//,''));
  const gates=[];
  for(const name of files.filter(n=>n.startsWith('webview/assets/')&&n.endsWith('.js'))){
    const source=extract(archive,name).toString('utf8');
    const {count}=patchTranslationGate(source);
    if(count)gates.push({name,count});
  }
  const chinese=files.filter(n=>/^webview\/assets\/zh-(?:CN|Hans)-.*\.js$/.test(n));
  const nativeChinese=files.includes('native-menu-locales/zh-CN.json');
  return {gates,chinese,nativeChinese};
}
export function verifyTranslations(app) {
  const resources=fs.existsSync(path.join(app,'Contents','Resources'))?path.join(app,'Contents','Resources'):path.join(app,'resources');
  const result=inspectTranslations(path.join(resources,'app.asar'));
  if(result.gates.length||result.chinese.length<2||!result.nativeChinese)
    throw Object.assign(Error('Desktop translation verification failed: '+JSON.stringify(result)),{code:'I18N_NOT_READY'});
  return {ok:true,chineseResources:result.chinese.length,nativeChinese:true};
}
export async function repairWindowsTranslations(app,{backupRoot=os.tmpdir()}={}) {
  const resources=path.join(app,'resources'),archive=path.join(resources,'app.asar');
  const exeFile=path.join(app,'codex-own.exe'),manifestFile=path.join(app,'codex-own-build.json');
  const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
  if(manifest.identity!=='local.codex-own')throw Error('Refusing unrelated application');
  const before=inspectTranslations(archive);
  if(!before.chinese.length||!before.nativeChinese)throw Error('Missing translation resources');
  if(!before.gates.length)return {ok:true,unchanged:true,...verifyTranslations(app)};
  const backup=fs.mkdtempSync(path.join(backupRoot,'own-i18n-backup-'));
  const targets=[archive,exeFile,manifestFile];
  for(const [i,file] of targets.entries()){
    if(!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink())throw Error('Unsafe repair target');
    fs.copyFileSync(file,path.join(backup,String(i)),fs.constants.COPYFILE_EXCL);
  }
  const header=asar.getRawHeader(archive).header;
  const {Pickle}=await import(pathToFileURL(path.join(path.dirname(require.resolve('@electron/asar')),'pickle.js')));
  let offset=0,count=0;const buffers=[];
  function pack(dir,prefix=''){
    for(const [name,e] of Object.entries(dir.files)){
      const file=prefix+name;if(e.files){pack(e,file+'/');continue;}if(e.unpacked||e.link)continue;
      let data=extract(archive,file);
      if(file.startsWith('webview/assets/')&&file.endsWith('.js')){
        const patched=patchTranslationGate(data.toString('utf8'));count+=patched.count;
        if(patched.count)data=Buffer.from(patched.source);
      }
      e.size=data.length;e.offset=String(offset);offset+=data.length;
      const blockSize=4194304,blocks=[];for(let i=0;i<data.length;i+=blockSize)blocks.push(sha(data.subarray(i,i+blockSize)));
      e.integrity={algorithm:'SHA256',hash:sha(data),blockSize,blocks};buffers.push(data);
    }
  }
  pack(header);
  const hp=new Pickle();hp.writeString(JSON.stringify(header));const hb=hp.toBuffer();const sp=new Pickle();sp.writeUInt32(hb.length);
  const updated=Buffer.concat([sp.toBuffer(),hb,...buffers]),headerHash=sha(updated.subarray(16,16+updated.readUInt32LE(12)));
  const PE=require('pe-library'),exe=PE.NtExecutable.from(fs.readFileSync(exeFile),{ignoreCert:true}),res=PE.NtExecutableResource.from(exe);
  const integrity=res.entries.find(e=>e.type==='INTEGRITY'&&e.id==='ELECTRONASAR');if(!integrity)throw Error('PE integrity resource missing');
  const values=JSON.parse(Buffer.from(integrity.bin).toString());
  if(values.length!==1||values[0].file!=='resources\\app.asar')throw Error('Unknown PE integrity layout');
  values[0].value=headerHash;integrity.bin=Buffer.from(JSON.stringify(values));res.outputResource(exe);
  const executable=Buffer.from(exe.generate());
  Object.assign(manifest,{asarSha256:sha(updated),asarHeaderHash:headerHash,exeSha256:sha(executable),i18nPatches:count});
  const data=[updated,executable,Buffer.from(JSON.stringify(manifest,null,2))];
  try{
    for(const [i,file] of targets.entries()){
      const temp=file+'.new-'+crypto.randomUUID();fs.writeFileSync(temp,data[i],{flag:'wx'});fs.renameSync(temp,file);
    }
    verifyTranslations(app);
  }catch(e){for(const [i,file] of targets.entries())fs.copyFileSync(path.join(backup,String(i)),file);throw e;}
  return {ok:true,patches:count,backup,headerHash};
}
