import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {verifiedDownload} from '../lib/network.mjs';
import {assembleNpmAsset, payloadURL, validateParts} from '../lib/npm-assets.mjs';
import {validateManifest, tarExecutable} from '../lib/manager.mjs';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const temp=t=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'own-npm-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;};
async function server(t,handler){const s=http.createServer(handler);await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>{s.closeAllConnections();s.close();});return `http://127.0.0.1:${s.address().port}`;}
test('download reports progress, verifies bytes, and preserves existing destination',async t=>{
  const data=Buffer.from('test payload'),messages=[],dest=path.join(temp(t),'part');
  const url=await server(t,(_,r)=>r.end(data));
  await verifiedDownload(url,dest,{size:data.length,sha256:hash(data)},{fetcher:fetch,report:s=>messages.push(s)});
  assert.deepEqual(fs.readFileSync(dest),data);assert.ok(messages.some(s=>s.includes('100%')));
  await assert.rejects(verifiedDownload(url,dest,{size:1,sha256:'a'.repeat(64)}),{code:'TARGET_EXISTS'});
});
test('stalled download retries boundedly and leaves no incomplete file',async t=>{
  const dest=path.join(temp(t),'part');let calls=0;
  const url=await server(t,(_,r)=>{calls++;r.writeHead(200);r.flushHeaders();r.write('x');});
  await assert.rejects(verifiedDownload(url,dest,{size:5,sha256:'a'.repeat(64)},{fetcher:fetch,report:()=>{},idleMs:80,attempts:2}),{code:'DOWNLOAD_FAILED'});
  assert.equal(calls,2);assert.equal(fs.existsSync(dest),false);
});
test('checksum mismatch never becomes a successful download',async t=>{
  const dest=path.join(temp(t),'part'),url=await server(t,(_,r)=>r.end('x'));
  await assert.rejects(verifiedDownload(url,dest,{size:1,sha256:'a'.repeat(64)},{fetcher:fetch,report:()=>{}}),{code:'CHECKSUM_MISMATCH'});
  assert.equal(fs.existsSync(dest),false);
});
function fixture(t, suffix=''){
  const dir=temp(t),payload=Buffer.from('a reproducible desktop archive fixture'+suffix),sha256=hash(payload);
  fs.mkdirSync(path.join(dir,'package'));fs.writeFileSync(path.join(dir,'package','payload.bin'),payload);
  const tar=tarExecutable(),tgz=path.join(dir,'package.tgz');execFileSync(tar,['-czf',tgz,'-C',dir,'package']);
  const data=fs.readFileSync(tgz),part={sha256,size:payload.length,url:payloadURL(sha256),archiveSize:data.length,archiveSha256:hash(data)};
  return {dir,payload,data,tar,asset:{entry:'app',size:payload.length,sha256,parts:[part]}};
}
test('npm manifest rejects GitHub, alternate registry, part size and checksum tampering',t=>{
  const {asset}=fixture(t),m={schema:2,version:'0.2.0',repository:'petercjl/codex-own',platforms:{'win32-x64':asset}};
  assert.ok(validateManifest(m,'win32-x64'));
  for(const url of ['https://github.com/archive','https://example.com/file',asset.parts[0].url+'?mirror=1'])assert.throws(()=>validateParts({...asset,parts:[{...asset.parts[0],url}]}),{code:'INVALID_MANIFEST'});
  assert.throws(()=>validateParts({...asset,size:asset.size+1}),{code:'INVALID_MANIFEST'});
});
test('npm payload assembly verifies parts and reuses only hash-verified cache',async t=>{
  const {dir,payload,data,tar,asset}=fixture(t);let requests=0;const cache=path.join(dir,'cache');
  const download=async(url,file,expected)=>{requests++;assert.equal(url,asset.parts[0].url);assert.equal(hash(data),expected.sha256);fs.writeFileSync(file,data,{flag:'wx'});};
  await assembleNpmAsset(asset,path.join(dir,'one'),cache,tar,{download,report:()=>{}});
  await assembleNpmAsset(asset,path.join(dir,'two'),cache,tar,{download:()=>{throw Error('Cache should be reused')},report:()=>{}});
  assert.deepEqual(fs.readFileSync(path.join(dir,'two')),payload);assert.equal(requests,1);
  fs.writeFileSync(path.join(cache,asset.sha256+'.bin'),'corrupt');
  await assembleNpmAsset(asset,path.join(dir,'three'),cache,tar,{download,report:()=>{}});assert.equal(requests,2);
});

test('temporary npm HTTP failure retries successfully and reports the HTTP status',async t=>{
  let calls=0;const data=Buffer.from('ready'),messages=[],dest=path.join(temp(t),'part');
  const url=await server(t,(_,r)=>{if(++calls===1){r.writeHead(404);r.end();}else r.end(data);});
  await verifiedDownload(url,dest,{size:data.length,sha256:hash(data)},{fetcher:fetch,report:s=>messages.push(s),retryMs:1});
  assert.equal(calls,2);assert.deepEqual(fs.readFileSync(dest),data);assert.ok(messages.some(s=>s.includes('HTTP 404')));
});
test('persistent npm HTTP failure preserves status in the final error',async t=>{
  const dest=path.join(temp(t),'part'),url=await server(t,(_,r)=>{r.writeHead(503);r.end();});
  await assert.rejects(verifiedDownload(url,dest,{size:1,sha256:'a'.repeat(64)},{fetcher:fetch,report:()=>{},retryMs:1}),e=>e.code==='DOWNLOAD_FAILED'&&e.message.includes('HTTP 503'));
  assert.equal(fs.existsSync(dest),false);
});

test('parallel assembly bounds downloads, preserves order, and cancels peers on failure',async t=>{
  const fixtures=Array.from({length:6},(_,i)=>fixture(t,String(i))),dir=temp(t),data=Buffer.concat(fixtures.map(f=>f.payload));
  const asset={entry:'app',size:data.length,sha256:hash(data),parts:fixtures.flatMap(f=>f.asset.parts)};
  let active=0,peak=0;
  const download=async(url,file)=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,15));fs.writeFileSync(file,fixtures.find(f=>f.asset.parts[0].url===url).data,{flag:'wx'});active--;};
  await assembleNpmAsset(asset,path.join(dir,'archive'),path.join(dir,'cache'),tarExecutable(),{download,report:()=>{},concurrency:3});
  assert.equal(peak,3);assert.deepEqual(fs.readFileSync(path.join(dir,'archive')),data);
  let cancelled=0;
  const broken=async(url,file,expected,{signal})=>{
    if(url===asset.parts[0].url){await new Promise(r=>setTimeout(r,10));throw Object.assign(Error('broken'),{code:'DOWNLOAD_FAILED'});}
    await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{cancelled++;reject(Error('cancelled'));},{once:true}));
  };
  await assert.rejects(assembleNpmAsset(asset,path.join(dir,'bad'),path.join(dir,'bad-cache'),tarExecutable(),{download:broken,report:()=>{},concurrency:3}),{code:'DOWNLOAD_FAILED'});
  assert.equal(cancelled,2);assert.equal(fs.existsSync(path.join(dir,'bad')),false);
});
