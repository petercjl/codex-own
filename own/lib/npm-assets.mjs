import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import {fileHash, verifiedDownload, progress} from './network.mjs';
import {TRANSPORT} from './content-blocks.mjs';

export const payloadVersion = sha => `0.0.0-payload.h${sha}`;
export const payloadURL = sha => `https://registry.npmjs.org/@petercjl/codex-own/-/codex-own-${payloadVersion(sha)}.tgz`;
export function validateParts(asset) {
  const fail = () => { throw Object.assign(new Error('Invalid npm asset manifest'), {code:'INVALID_MANIFEST'}); };
  if (asset.transport !== undefined && asset.transport !== TRANSPORT) fail();
  if (!Array.isArray(asset.parts) || asset.parts.length < 1 || asset.parts.length > 1024) fail();
  let size = 0;
  for (const p of asset.parts) {
    if (!/^[a-f0-9]{64}$/.test(p.sha256) || !/^[a-f0-9]{64}$/.test(p.archiveSha256)
      || !Number.isSafeInteger(p.size) || p.size < 1 || p.size > 128*1048576
      || !Number.isSafeInteger(p.archiveSize) || p.archiveSize < 1 || p.archiveSize > 130*1048576
      || p.url !== payloadURL(p.sha256)) fail();
    size += p.size;
  }
  if (size !== asset.size) fail();
  return asset;
}
function safeCache(file) {
  if (fs.existsSync(file) && (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()))
    throw Object.assign(new Error('Unexpected npm asset cache entry'), {code:'UNSAFE_PATH'});
}
export async function assembleNpmAsset(asset, dest, cache, tar, {download = verifiedDownload, report = progress, concurrency = 4,signal} = {}) {
  validateParts(asset);
  fs.mkdirSync(cache, {recursive:true, mode:0o700});
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('Invalid download concurrency');
  const controller = new AbortController();
  const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});
  if(signal?.aborted)controller.abort();
  try{
  const cached = new Set();
  for(const part of asset.parts){
    const file=path.join(cache,part.sha256+'.bin');safeCache(file);
    if(fs.existsSync(file)&&fs.statSync(file).size===part.size&&await fileHash(file)===part.sha256)cached.add(part.sha256);
  }
  const uniqueParts=[...new Map(asset.parts.map(part=>[part.sha256,part])).values()];
  const stats={transport:asset.transport||'legacy',totalBlocks:asset.parts.length,reusedBlocks:asset.parts.filter(p=>cached.has(p.sha256)).length,
    downloadBlocks:uniqueParts.filter(p=>!cached.has(p.sha256)).length,
    downloadBytes:uniqueParts.filter(p=>!cached.has(p.sha256)).reduce((n,p)=>n+p.archiveSize,0),
    fullDownloadBytes:uniqueParts.reduce((n,p)=>n+p.archiveSize,0)};
  report(`更新资源：复用 ${stats.reusedBlocks}/${stats.totalBlocks} 块 · 需下载 ${(stats.downloadBytes/1048576).toFixed(1)} MiB / 全量 ${(stats.fullDownloadBytes/1048576).toFixed(1)} MiB`);
  async function fetchPart(part, i) {
    report(`npm 资源分片 ${i+1}/${asset.parts.length}`);
    const file = path.join(cache, `${part.sha256}.bin`);
    safeCache(file);
    if (cached.has(part.sha256)) {
      report(`[${i+1}/${asset.parts.length}] 复用已校验分片`); return file;
    }
    if (fs.existsSync(file)) fs.unlinkSync(file);
    const scratch = fs.mkdtempSync(path.join(cache, 'fetch-'));
    try {
      const archive = path.join(scratch, 'package.tgz');
      await download(part.url, archive, {size:part.archiveSize, sha256:part.archiveSha256}, {signal:controller.signal, report:message=>report(`[${i+1}/${asset.parts.length}] ${message}`)});
      // Extract only the fixed payload entry, never arbitrary paths from a package tarball.
      execFileSync(tar, ['-xf', archive, '-C', scratch, 'package/payload.bin'], {stdio:'pipe'});
      const payload = path.join(scratch, 'package', 'payload.bin');
      safeCache(payload);
      if (fs.statSync(payload).size !== part.size || await fileHash(payload) !== part.sha256)
        throw Object.assign(new Error('npm payload checksum mismatch'), {code:'CHECKSUM_MISMATCH'});
      fs.renameSync(payload, file); return file;
    } finally { fs.rmSync(scratch, {recursive:true,force:true}); }
  }
  const unique = [...new Map(asset.parts.map((part,i)=>[part.sha256,{part,i}])).values()];
  const completed = new Map(); let cursor = 0, failure;
  async function worker() {
    while(!controller.signal.aborted && cursor < unique.length) {
      const {part,i}=unique[cursor++];
      try { completed.set(part.sha256,await fetchPart(part,i)); }
      catch(e) { if(!failure)failure=e;controller.abort();throw e; }
    }
  }
  await Promise.allSettled(Array.from({length:Math.min(concurrency,unique.length)},worker));
  if(failure)throw failure;
  if(controller.signal.aborted)throw Object.assign(Error('Download cancelled'),{code:'CANCELLED'});
  const files=asset.parts.map(part=>completed.get(part.sha256));
  report('在本地重建并校验完整桌面安装包');
  const output = fs.createWriteStream(dest, {flags:'wx',mode:0o600});
  async function* chunks() { for (const f of files) yield* fs.createReadStream(f); }
  await pipeline(chunks(), output,{signal:controller.signal});
  if (fs.statSync(dest).size !== asset.size || await fileHash(dest) !== asset.sha256)
    throw Object.assign(new Error('Assembled desktop checksum mismatch'), {code:'CHECKSUM_MISMATCH'});
  return stats;
  }finally{signal?.removeEventListener('abort',cancel);}
}
