import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {canonicalTar,contentBlocks,writeCanonicalArchive,reuseInstalledBlocks,TRANSPORT} from '../lib/content-blocks.mjs';
import {assembleNpmAsset,payloadURL,validateParts} from '../lib/npm-assets.mjs';
import {tarExecutable,unpack} from '../lib/manager.mjs';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function temp(t){const d=fs.mkdtempSync(path.join(os.tmpdir(),'own-cdc-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;}
async function bytes(stream){const b=[];for await(const x of stream)b.push(x);return Buffer.concat(b);}

test('canonical archive ignores host timestamps/order and preserves native contents, executable modes and long Unicode paths',async t=>{
  const d=temp(t),root=path.join(d,'source');fs.mkdirSync(root);
  fs.writeFileSync(path.join(root,'z'),'last');fs.writeFileSync(path.join(root,'a'),'first');
  const long='中文路径'.repeat(15);fs.mkdirSync(path.join(root,long));fs.writeFileSync(path.join(root,long,'文件.txt'),'长路径 UTF-8');
  fs.chmodSync(path.join(root,'a'),0o755);
  if(process.platform!=='win32')fs.symlinkSync('a',path.join(root,'link'));
  const one=await bytes(canonicalTar(root,'codex-own.app'));
  fs.utimesSync(path.join(root,'a'),new Date(),new Date());fs.utimesSync(root,new Date(),new Date());
  const two=await bytes(canonicalTar(root,'codex-own.app'));assert.deepEqual(one,two);
  const archive=path.join(d,'app.tar');fs.writeFileSync(archive,one);const dest=path.join(d,'extract');unpack(archive,dest);
  assert.equal(fs.readFileSync(path.join(dest,'codex-own.app',long,'文件.txt'),'utf8'),'长路径 UTF-8');
  if(process.platform!=='win32'){
    assert.equal(fs.statSync(path.join(dest,'codex-own.app','a')).mode&0o777,0o755);
    assert.equal(fs.readlinkSync(path.join(dest,'codex-own.app','link')),'a');
  }
});
test('content boundaries resynchronize after insertion instead of invalidating every later block',async()=>{
  const input=crypto.randomBytes(8*1048576),changed=Buffer.concat([input.subarray(0,1024),Buffer.from('a small edit'),input.subarray(1024)]);
  const options={min:32*1024,mask:0xffff,max:256*1024};
  async function* stream(b,width){for(let i=0;i<b.length;i+=width)yield b.subarray(i,i+width);}
  const original=[];for await(const b of contentBlocks(stream(input,8191),options))original.push(b);
  const next=[];for await(const b of contentBlocks(stream(changed,65536),options))next.push(b);
  const known=new Set(original.map(hash)),reused=next.filter(b=>known.has(hash(b))).reduce((n,b)=>n+b.length,0);
  assert.ok(reused>input.length*.85,`reuse ${(reused/input.length*100).toFixed(1)}%`);
  assert.deepEqual(Buffer.concat(next),changed);
  const again=[];for await(const b of contentBlocks(stream(input,513),options))again.push(hash(b));
  assert.deepEqual(again,original.map(hash));
});
test('canonical transport seeds an existing app and completes with zero network bytes; clean install downloads and corrupted cache is repaired',async t=>{
  const d=temp(t),root=path.join(d,'app');fs.mkdirSync(root);fs.writeFileSync(path.join(root,'data'),crypto.randomBytes(256*1024));
  const archive=path.join(d,'archive.tar'),index=await writeCanonicalArchive(root,'app',archive);
  const payload=fs.readFileSync(archive),part=index.blocks[0];assert.equal(index.blocks.length,1);
  const pd=path.join(d,'package');fs.mkdirSync(pd);fs.writeFileSync(path.join(pd,'payload.bin'),payload);
  const tgz=path.join(d,'npm.tgz');execFileSync(tarExecutable(),['-czf',tgz,'-C',d,'package']);const packed=fs.readFileSync(tgz);
  const asset={entry:'app',transport:TRANSPORT,size:index.size,sha256:index.sha256,parts:[{sha256:part.sha256,size:part.size,url:payloadURL(part.sha256),archiveSize:packed.length,archiveSha256:hash(packed)}]};
  const cache=path.join(d,'cache');await reuseInstalledBlocks(asset,root,cache);
  const stats=await assembleNpmAsset(asset,path.join(d,'reused.tar'),cache,tarExecutable(),{download:()=>{throw Error('unexpected download');},report:()=>{}});
  assert.equal(stats.downloadBytes,0);assert.equal(stats.reusedBlocks,1);assert.deepEqual(fs.readFileSync(path.join(d,'reused.tar')),payload);
  let downloads=0;const download=async(_url,f)=>{downloads++;fs.writeFileSync(f,packed,{flag:'wx'});};
  const fresh=await assembleNpmAsset(asset,path.join(d,'fresh.tar'),path.join(d,'fresh-cache'),tarExecutable(),{download,report:()=>{}});
  assert.equal(fresh.downloadBytes,packed.length);assert.equal(downloads,1);
  fs.writeFileSync(path.join(cache,part.sha256+'.bin'),'corrupt');
  await assembleNpmAsset(asset,path.join(d,'repaired.tar'),cache,tarExecutable(),{download,report:()=>{}});assert.equal(downloads,2);
});
test('cancelled local scan and escaping links never become trusted cached content',async t=>{
  const d=temp(t),root=path.join(d,'app');fs.mkdirSync(root);fs.writeFileSync(path.join(root,'x'),'x');
  const controller=new AbortController();controller.abort();
  await assert.rejects(bytes(canonicalTar(root,'app',{signal:controller.signal})),{code:'CANCELLED'});
  if(process.platform!=='win32'){
    fs.symlinkSync('../outside',path.join(root,'bad'));
    await assert.rejects(bytes(canonicalTar(root,'app')),{code:'UNSAFE_PATH'});
  }
});
test('production block rules isolate unchanged large binaries from earlier small-file edits',async t=>{
  const d=temp(t),base=path.join(d,'base'),next=path.join(d,'next');fs.mkdirSync(base);
  const size=20*1048576;
  fs.writeFileSync(path.join(base,'engine.bin'),crypto.randomBytes(size));fs.writeFileSync(path.join(base,'a.txt'),'before');
  fs.cpSync(base,next,{recursive:true});fs.writeFileSync(path.join(next,'a.txt'),'a longer own application edit');
  fs.writeFileSync(path.join(next,'b.txt'),'a newly added file');
  const index=await writeCanonicalArchive(next,'app',path.join(d,'next.tar'));
  const cache=path.join(d,'cache');const r=await reuseInstalledBlocks({...index,entry:'app',parts:index.blocks},base,cache);
  assert.ok(r.seededBytes>=size,'The complete unchanged engine must be reused with production block parameters');
  const missing=index.blocks.filter(p=>!fs.existsSync(path.join(cache,p.sha256+'.bin'))).reduce((n,p)=>n+p.size,0);
  assert.ok(missing<64*1024,`only small changed files should be missing, got ${missing}`);
});
test('incremental manifests accept more than 64 content blocks but reject an unknown algorithm',()=>{
  const sha='a'.repeat(64),part={sha256:sha,size:1,url:payloadURL(sha),archiveSize:1,archiveSha256:sha};
  const asset={transport:TRANSPORT,parts:Array(100).fill(part),size:100};assert.ok(validateParts(asset));
  assert.throws(()=>validateParts({...asset,transport:'unknown'}),{code:'INVALID_MANIFEST'});
});
