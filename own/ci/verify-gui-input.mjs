import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
import {snapshot} from './artifact-inputs.mjs';import {digestFile,unpack} from '../lib/manager.mjs';
const [id,platform,version]=process.argv.slice(2);if(!/^\d+$/.test(id)||!['darwin-arm64','win32-x64'].includes(platform))throw Error('Invalid verified run input');
const repo=process.env.GITHUB_REPOSITORY;if(repo!=='petercjl/codex-own')throw Error('Unexpected verification repository');
const run=JSON.parse(execFileSync('gh',['api',`repos/${repo}/actions/runs/${id}`],{encoding:'utf8'}));
assert.equal(run.conclusion,'success');assert.equal(run.path,'.github/workflows/own-build.yml');assert.equal(run.head_branch,'codex/official-desktop-compat-20261018');
const buildTree=snapshot(process.cwd(),{ref:run.head_sha}),currentTree=snapshot(process.cwd(),{ref:'HEAD'});
assert.equal(buildTree.native,currentTree.native,'GUI evidence must use the same native source as its verified build');
const folder=path.resolve('out/gui-input');if(fs.existsSync(folder))throw Error('GUI input directory exists');
execFileSync('gh',['run','download',id,'--repo',repo,'--name',`own-${platform}`,'--dir',folder],{stdio:'inherit'});
const files=fs.readdirSync(folder,{recursive:true}).map(p=>path.join(folder,p));const manifests=files.filter(p=>path.basename(p)===`manifest-${platform}.json`);assert.equal(manifests.length,1);
const manifest=JSON.parse(fs.readFileSync(manifests[0]));assert.equal(manifest.version,version);const asset=manifest.platforms[platform];
const archives=files.filter(p=>path.basename(p)===`codex-own-${platform}.tar.gz`);assert.equal(archives.length,1);assert.equal(await digestFile(archives[0]),asset.sha256);
const target=path.resolve('out/gui-app');assert.ok(!fs.existsSync(target));unpack(archives[0],target);const app=path.join(target,asset.entry);
try{execFileSync(process.execPath,['own/ci/test-desktop-startup.mjs',app,'out/gui-smoke'],{stdio:'inherit'});}
finally{
 if(fs.existsSync('out/gui-smoke'))fs.writeFileSync('out/gui-smoke/verified-input.json',JSON.stringify({buildRun:id,buildSource:run.head_sha,verificationSource:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),nativeFingerprint:currentTree.native,manifest},null,2),{flag:'wx'});
}
