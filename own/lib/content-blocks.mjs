// Versioned, deterministic transport shared by build, local reuse and release.
// npm compresses each raw block; compressing the whole app first destroys reuse.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pipeline} from 'node:stream/promises';

export const TRANSPORT = 'canonical-tar-cdc-v1';
export const BLOCKS = Object.freeze({min:16*1048576, mask:0x1ffffff, max:64*1048576});
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const abort = signal => { if(signal?.aborted) throw Object.assign(Error('Update cancelled'), {code:'CANCELLED'}); };
const gear = Array.from({length:256},(_,i)=>crypto.createHash('sha256').update(`codex-own-cdc-v1:${i}`).digest().readUInt32LE(0));
const fileBoundary=()=>Object.assign(Buffer.alloc(0),{canonicalFileBoundary:true});

function header(name, size, type, mode, link='') {
  const b=Buffer.alloc(512);
  const text=(s,at,len)=>{if(Buffer.byteLength(s)>len)throw Error('Tar field overflow');b.write(s,at,len,'utf8');};
  const oct=(n,at,len)=>text(n.toString(8).padStart(len-1,'0')+'\0',at,len);
  text(name,0,100);oct(mode,100,8);oct(0,108,8);oct(0,116,8);
  oct(size,124,12);oct(0,136,12);b.fill(32,148,156);text(type,156,1);
  text(link,157,100);text('ustar\0',257,6);text('00',263,2);
  const sum=b.reduce((a,v)=>a+v,0);text(sum.toString(8).padStart(6,'0')+'\0 ',148,8);
  return b;
}
function paxRecord(key,value) {
  const body=` ${key}=${value}\n`;let n=Buffer.byteLength(body)+1;
  while(String(n).length+Buffer.byteLength(body)!==n)n=String(n).length+Buffer.byteLength(body);
  return Buffer.from(String(n)+body);
}
function* entryHeaders(name,size,type,mode,link='') {
  const records=[];
  if(Buffer.byteLength(name)>100)records.push(paxRecord('path',name));
  if(Buffer.byteLength(link)>100)records.push(paxRecord('linkpath',link));
  if(records.length){
    const data=Buffer.concat(records),id=sha(Buffer.from(name));
    yield header('PaxHeaders/'+id,data.length,'x',0o644);yield data;
    if(data.length%512)yield Buffer.alloc(512-data.length%512);
    name='entry-'+id;
  }
  yield header(name,size,type,mode,Buffer.byteLength(link)>100?'':link);
}

// Stable order, permissions and timestamps across CI and an installed app.
// Links are recorded, never traversed. No host metadata or user data is bundled.
export async function* canonicalTar(root,entry,{signal}={}) {
  if(!['app','codex-own.app'].includes(entry))throw Error('Unexpected application entry');
  root=path.resolve(root);
  if(!fs.lstatSync(root).isDirectory()||fs.lstatSync(root).isSymbolicLink())throw Error('Expected a real application directory');
  async function* walk(file,name){
    abort(signal);const st=fs.lstatSync(file);
    if(st.isSymbolicLink()){
      const link=fs.readlinkSync(file),resolved=path.resolve(path.dirname(file),link);
      if(path.isAbsolute(link)||(resolved!==root&&!resolved.startsWith(root+path.sep)))throw Object.assign(Error('Escaping application symlink'),{code:'UNSAFE_PATH'});
      yield* entryHeaders(name,0,'2',0o777,link);
    }else if(st.isDirectory()){
      yield* entryHeaders(name+'/',0,'5',0o755);
      for(const n of fs.readdirSync(file).sort())yield* walk(path.join(file,n),name+'/'+n);
    }else if(st.isFile()){
      // A changed file must not shift the block grid of the next large binary.
      if(st.size>=BLOCKS.min)yield fileBoundary();
      const mode=entry==='codex-own.app'&&(st.mode&0o111)?0o755:0o644;
      yield* entryHeaders(name,st.size,'0',mode);let size=0;
      for await(const b of fs.createReadStream(file)){abort(signal);size+=b.length;yield b;}
      if(size!==st.size)throw Object.assign(Error('Application changed during local scan'),{code:'LOCAL_APP_CHANGED'});
      if(size%512)yield Buffer.alloc(512-size%512);
      if(st.size>=BLOCKS.min)yield fileBoundary();
    }else throw Object.assign(Error('Unsupported application file'),{code:'UNSAFE_PATH'});
  }
  yield* walk(root,entry);yield Buffer.alloc(1024);
}

// Boundaries depend on content, so insertion in an asar does not shift all blocks.
export async function* contentBlocks(stream,{min=BLOCKS.min,mask=BLOCKS.mask,max=BLOCKS.max,signal}={}) {
  if(!Number.isInteger(min)||min<1||!Number.isInteger(max)||max<min||max>128*1048576||!Number.isInteger(mask)||mask<1)throw Error('Invalid block parameters');
  let pieces=[],size=0,h=0;
  for await(const buffer of stream){
    abort(signal);
    if(buffer.canonicalFileBoundary){if(size)yield Buffer.concat(pieces,size);pieces=[];size=0;h=0;continue;}
    let start=0;
    for(let i=0;i<buffer.length;i++){
      h=((h<<1)+gear[buffer[i]])>>>0;size++;
      if(size>=min&&((h&mask)===0||size>=max)){
        pieces.push(buffer.subarray(start,i+1));yield Buffer.concat(pieces,size);
        pieces=[];size=0;h=0;start=i+1;
      }
    }
    if(start<buffer.length)pieces.push(buffer.subarray(start));
  }
  if(size)yield Buffer.concat(pieces,size);
}

export async function writeCanonicalArchive(root,entry,dest,{signal}={}) {
  const blocks=[],digest=crypto.createHash('sha256');let size=0;
  async function* bytes(){
    for await(const b of contentBlocks(canonicalTar(root,entry,{signal}),{signal})){
      blocks.push({sha256:sha(b),size:b.length,offset:size});size+=b.length;digest.update(b);yield b;
    }
  }
  await pipeline(bytes(),fs.createWriteStream(dest,{flags:'wx',mode:0o600}),...(signal?[{signal}]:[]));
  return {transport:TRANSPORT,size,sha256:digest.digest('hex'),blocks};
}

export async function reuseInstalledBlocks(asset,root,cache,{signal,report=()=>{}}={}) {
  if(asset.transport!==TRANSPORT||!root||!fs.existsSync(root))return {seededBlocks:0,seededBytes:0};
  fs.mkdirSync(cache,{recursive:true,mode:0o700});
  const wanted=new Map(asset.parts.map(p=>[p.sha256,p.size]));
  let seededBlocks=0,seededBytes=0,scanned=0,last=0;
  report('正在扫描已安装程序，匹配可复用的内容块');
  for await(const b of contentBlocks(canonicalTar(root,asset.entry,{signal}),{signal})){
    scanned+=b.length;const hash=sha(b);
    if(wanted.get(hash)===b.length){
      const file=path.join(cache,hash+'.bin');
      // Never replace an existing cache entry here. Assembly verifies it again.
      if(!fs.existsSync(file))fs.writeFileSync(file,b,{flag:'wx',mode:0o600});
      wanted.delete(hash);seededBlocks++;seededBytes+=b.length;
    }
    if(Date.now()-last>2000){report(`本地扫描 ${Math.round(scanned/1048576)} MiB · 匹配 ${seededBlocks} 个内容块`);last=Date.now();}
  }
  report(`本地匹配完成：可复用 ${seededBlocks} 个内容块`);
  return {seededBlocks,seededBytes};
}
