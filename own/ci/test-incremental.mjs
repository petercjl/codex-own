import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {unpack,digestFile} from '../lib/manager.mjs';
import {writeCanonicalArchive,reuseInstalledBlocks,TRANSPORT} from '../lib/content-blocks.mjs';

const platform=process.env.OWN_PLATFORM,version=process.env.OWN_VERSION;
const dir=path.resolve('out',`own-release-${version}-${platform}.noindex`);
const manifest=JSON.parse(fs.readFileSync(path.join(dir,`manifest-${platform}.json`)));
const asset=manifest.platforms[platform].incremental;
assert.equal(asset.transport,TRANSPORT);
const archive=path.join(dir,`codex-own-${platform}.tar`);
assert.equal(fs.statSync(archive).size,asset.size);assert.equal(await digestFile(archive),asset.sha256);
const dest=path.join(dir,'incremental-roundtrip');unpack(archive,dest);
const app=path.join(dest,asset.entry);
execFileSync(process.execPath,['own/test-app.mjs',app],{stdio:'inherit'});
if(platform==='darwin-arm64')execFileSync('codesign',['--verify','--deep','--strict',app],{stdio:'inherit'});
const second=path.join(dir,'incremental-roundtrip.tar');
const rebuilt=await writeCanonicalArchive(app,asset.entry,second);
assert.equal(rebuilt.sha256,asset.sha256,'Installed/extracted files must reproduce exactly the published canonical archive');
assert.deepEqual(rebuilt.blocks,asset.blocks);
if(platform==='win32-x64'){
  const input=manifest.platforms[platform];
  const localManifest=path.join(dir,'canonical-install.json');
  fs.writeFileSync(localManifest,JSON.stringify({...manifest,platforms:{[platform]:{entry:asset.entry,url:input.url.replace(/\.tar\.gz$/,'.tar'),size:asset.size,sha256:asset.sha256}}}),{flag:'wx'});
  execFileSync(process.execPath,['own/ci/test-windows-install.mjs',archive,localManifest],{stdio:'inherit'});
}
const cache=path.join(dir,'incremental-local-cache');
const reuse=await reuseInstalledBlocks({...asset,parts:asset.blocks},app,cache);
assert.equal(reuse.seededBlocks,new Set(asset.blocks.map(b=>b.sha256)).size);
fs.rmSync(cache,{recursive:true});fs.rmSync(second);fs.rmSync(dest,{recursive:true});
console.log(JSON.stringify({ok:true,platform,canonicalRoundtrip:true,localReuse:true,blocks:asset.blocks.length,rawBytes:asset.size}));
