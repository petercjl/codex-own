// Build/release side only. End users fetch the resulting immutable npm parts.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileHash,networkFetch} from '../lib/network.mjs';
import {pipeline} from 'node:stream/promises';
import {assembleNpmAsset,validateParts} from '../lib/npm-assets.mjs';
import {tarExecutable} from '../lib/manager.mjs';
const dir=path.resolve(process.argv[2]),sources=JSON.parse(fs.readFileSync(new URL('../runtime/sources.json',import.meta.url)));
const reuseFile=process.argv[4],previous=reuseFile&&fs.existsSync(reuseFile)?JSON.parse(fs.readFileSync(reuseFile)).manifest?.runtimes:null;
const out=path.join(dir,'runtime-input.json');if(fs.existsSync(out))throw Error('Runtime output exists');
const result={schema:1,version:sources.version,platforms:{}};
for(const [platform,items] of Object.entries(sources.platforms).filter(([key])=>!process.argv[3]||key===process.argv[3])){
 result.platforms[platform]={};
 for(const [name,a] of Object.entries(items)){
  const file=path.join(dir,`runtime-${platform}-${name}.bin`);
  console.log(`Preparing ${platform} ${name}`);
  const old=previous?.platforms?.[platform]?.[name];
  if(old?.sha256===a.sha256&&old.entry===a.entry&&old.format===a.format){
   validateParts(old);if(!fs.existsSync(file))await assembleNpmAsset(old,file,path.join(dir,'reused-runtime-cache'),tarExecutable());if(await fileHash(file)!==a.sha256)throw Error('Reused runtime checksum mismatch');
   result.platforms[platform][name]=structuredClone(old);console.log(`Reused immutable npm ${platform} ${name}`);continue;
  }
  if(!fs.existsSync(file)){
   const response=await networkFetch(a.url,{redirect:'follow',signal:AbortSignal.timeout(300000)});if(!response.ok)throw Error(`Upstream HTTP ${response.status}`);
   await pipeline(response.body,fs.createWriteStream(file,{flags:'wx'}));
  }
  if(await fileHash(file)!==a.sha256)throw Error('Pinned upstream runtime checksum mismatch');
  const size=fs.statSync(file).size,blocks=[];const fd=fs.openSync(file,'r');
  try{for(let offset=0;offset<size;offset+=32*1048576){const bytes=Buffer.alloc(Math.min(size-offset,32*1048576));let n=0;while(n<bytes.length){const got=fs.readSync(fd,bytes,n,bytes.length-n,offset+n);if(!got)throw Error('Unexpected EOF');n+=got;}blocks.push({offset,size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}}finally{fs.closeSync(fd);}
  result.platforms[platform][name]={entry:a.entry,format:a.format,size,sha256:a.sha256,incremental:{size,sha256:a.sha256,blocks}};
 }
}
fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
// Only changed component bytes are handed to the publisher. QA may download a
// pinned unchanged companion to verify Node/Python integration on a clean host.
const publish=path.join(dir,'publish');fs.mkdirSync(publish);fs.copyFileSync(out,path.join(publish,'runtime-input.json'),fs.constants.COPYFILE_EXCL);
for(const [platform,items]of Object.entries(result.platforms))for(const [name,a]of Object.entries(items))if(a.incremental){const file=`runtime-${platform}-${name}.bin`;fs.copyFileSync(path.join(dir,file),path.join(publish,file),fs.constants.COPYFILE_EXCL);}
