import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import {fileHash, verifiedDownload, progress} from './network.mjs';

export const payloadVersion = sha => `0.0.0-payload.h${sha}`;
export const payloadURL = sha => `https://registry.npmjs.org/@petercjl/codex-own/-/codex-own-${payloadVersion(sha)}.tgz`;
export function validateParts(asset) {
  const fail = () => { throw Object.assign(new Error('Invalid npm asset manifest'), {code:'INVALID_MANIFEST'}); };
  if (!Array.isArray(asset.parts) || asset.parts.length < 1 || asset.parts.length > 64) fail();
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
export async function assembleNpmAsset(asset, dest, cache, tar, {download = verifiedDownload, report = progress} = {}) {
  validateParts(asset);
  fs.mkdirSync(cache, {recursive:true, mode:0o700});
  const files = [];
  for (const [i, part] of asset.parts.entries()) {
    report(`npm 资源分片 ${i+1}/${asset.parts.length}`);
    const file = path.join(cache, `${part.sha256}.bin`);
    safeCache(file);
    if (fs.existsSync(file) && fs.statSync(file).size === part.size && await fileHash(file) === part.sha256) {
      report('复用已校验分片'); files.push(file); continue;
    }
    if (fs.existsSync(file)) fs.unlinkSync(file);
    const scratch = fs.mkdtempSync(path.join(cache, 'fetch-'));
    try {
      const archive = path.join(scratch, 'package.tgz');
      await download(part.url, archive, {size:part.archiveSize, sha256:part.archiveSha256});
      // Extract only the fixed payload entry, never arbitrary paths from a package tarball.
      execFileSync(tar, ['-xf', archive, '-C', scratch, 'package/payload.bin'], {stdio:'pipe'});
      const payload = path.join(scratch, 'package', 'payload.bin');
      safeCache(payload);
      if (fs.statSync(payload).size !== part.size || await fileHash(payload) !== part.sha256)
        throw Object.assign(new Error('npm payload checksum mismatch'), {code:'CHECKSUM_MISMATCH'});
      fs.renameSync(payload, file); files.push(file);
    } finally { fs.rmSync(scratch, {recursive:true,force:true}); }
  }
  report('合并并校验完整桌面安装包');
  const output = fs.createWriteStream(dest, {flags:'wx',mode:0o600});
  async function* chunks() { for (const f of files) yield* fs.createReadStream(f); }
  await pipeline(chunks(), output);
  if (fs.statSync(dest).size !== asset.size || await fileHash(dest) !== asset.sha256)
    throw Object.assign(new Error('Assembled desktop checksum mismatch'), {code:'CHECKSUM_MISMATCH'});
}
