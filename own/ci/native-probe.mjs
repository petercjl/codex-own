// Locate the CLI in the already verified canonical archive. Manager QA fetches
// only intersecting npm blocks, never the full desktop or an expiring CI cache.
import fs from'node:fs';import path from'node:path';import crypto from'node:crypto';import{execFileSync}from'node:child_process';
import{assembleNpmAsset}from'../lib/npm-assets.mjs';import{tarExecutable}from'../lib/manager.mjs';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
export function indexProbe(archive,platform){
 const name=platform==='darwin-arm64'?'codex-own.app/Contents/Resources/codex':'app/resources/codex.exe',fd=fs.openSync(archive,'r'),header=Buffer.alloc(512);let offset=0;
 try{while(fs.readSync(fd,header,0,512,offset)===512){if(header.every(n=>n===0))break;const file=header.subarray(0,100).toString().split('\0')[0],size=parseInt(header.subarray(124,136).toString().replaceAll('\0','').trim(),8)||0;
  if(file===name){if(header[156]!==48||size<1)throw Error('Native probe must be a packed file');const bytes=Buffer.alloc(size);let done=0;while(done<size){const n=fs.readSync(fd,bytes,done,size-done,offset+512+done);if(!n)throw Error('Truncated native probe');done+=n;}return{path:name,offset:offset+512,size,sha256:hash(bytes)};}
  offset+=512+Math.ceil(size/512)*512;
 }}finally{fs.closeSync(fd);}throw Error('Native CLI missing from canonical artifact');
}
export async function invokeProbe(asset,probe,dir,{assemble=assembleNpmAsset,execute=execFileSync,cache=path.join(dir,'cache')}={}){
 if(!probe||!Number.isSafeInteger(probe.offset)||!Number.isSafeInteger(probe.size)||probe.offset<0||probe.size<1||probe.offset+probe.size>asset.size||!/^[a-f0-9]{64}$/.test(probe.sha256))throw Error('Invalid native probe');
 const buffers=[];let offset=0,downloadBytes=0;for(const part of asset.parts){const end=offset+part.size;
  if(offset<probe.offset+probe.size&&end>probe.offset){const output=path.join(dir,'probe-block-'+offset);const result=await assemble({size:part.size,sha256:part.sha256,parts:[part]},output,cache,tarExecutable(),{report:()=>{}});downloadBytes+=result?.downloadBytes||0;const bytes=fs.readFileSync(output);buffers.push(bytes.subarray(Math.max(0,probe.offset-offset),Math.min(part.size,probe.offset+probe.size-offset)));fs.unlinkSync(output);}offset=end;
 }
 const binary=Buffer.concat(buffers);if(binary.length!==probe.size||hash(binary)!==probe.sha256)throw Object.assign(Error('Native probe checksum mismatch'),{code:'CHECKSUM_MISMATCH'});
 const executable=path.join(dir,process.platform==='win32'?'pinned-codex.exe':'pinned-codex');fs.writeFileSync(executable,binary,{flag:'wx',mode:0o755});
 const version=execute(executable,['--version'],{encoding:'utf8',timeout:30000,windowsHide:true}).trim();if(!/^codex(?:-cli)?\s+/.test(version))throw Error('Unexpected pinned native CLI');
 return{ok:true,version,sha256:probe.sha256,downloadBytes,desktopDownloaded:false};
}
