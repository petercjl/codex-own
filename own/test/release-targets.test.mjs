import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {assertReleaseTargets,releaseTargets} from '../ci/release-targets.mjs';
import {bindArtifacts} from '../ci/artifact-record.mjs';
import {releasePlan,verifyBuildRun} from '../ci/release-plan.mjs';
import {identity,validateBinding} from '../lib/binding.mjs';
const source={repository:'petercjl/codex-own',ref:'a'.repeat(40),run:'123',workflow:'.github/workflows/own-release.yml'};
const inputs={entries:{},native:'b'.repeat(64),runtime:'c'.repeat(64),release:'d'.repeat(64),upstream:'e'.repeat(64),unknown:[]};
function fixture(){
 const manifest=JSON.parse(fs.readFileSync(new URL('../release.json',import.meta.url)));delete manifest.binding;
 for(const asset of Object.values(manifest.platforms))asset.probe={offset:512,size:8,sha256:'a'.repeat(64)};
 const proofs=Object.fromEntries(Object.entries(manifest.runtimes.platforms).map(([p,a])=>[p,{node:{identity:a.node.sha256},python:{identity:a.python.sha256},npm:{identity:identity('npm'),version:'11.19.1'}}]));
 const plan={inputs,managerVersion:'9.0.0',components:{desktop:'build',runtimes:'build'}};
 return {manifest,proofs,plan};
}
test('release boundary accepts Windows only and rejects desktop or runtime Mac resources',()=>{
 assert.deepEqual(releaseTargets,['win32-x64']);
 const m={platforms:{'win32-x64':{}},runtimes:{platforms:{'win32-x64':{}}}};assert.equal(assertReleaseTargets(m),true);
 for(const component of [m,m.runtimes]){component.platforms['darwin-arm64']={};assert.throws(()=>assertReleaseTargets(m),/platforms must be win32-x64/);delete component.platforms['darwin-arm64'];}
 assert.throws(()=>assertReleaseTargets({platforms:{}}));
});
test('Windows release migration preserves historical dual-platform proof and retained tool bytes',()=>{
 const {manifest,proofs,plan}=fixture();
 const historical=bindArtifacts(manifest,plan,null,source,proofs);validateBinding(historical,{requireProof:true});
 const previous={manifest:historical,inputs,registry:{version:'9.0.0'}};
 const next=releasePlan({inputs,previous,managerVersion:'9.0.1',provenanceVerified:true});
 assert.deepEqual(next.components,{desktop:'build',runtimes:'build'});assert.deepEqual(next.targets,['win32-x64']);
 const candidate=structuredClone(historical);candidate.version='9.0.1';delete candidate.platforms['darwin-arm64'];delete candidate.runtimes.platforms['darwin-arm64'];
 const result=bindArtifacts(candidate,next,previous,{...source,run:'124'}, {'win32-x64':proofs['win32-x64']});
 assert.equal(assertReleaseTargets(result),true);assert.deepEqual(result.binding.desktop.verifiedPlatforms,['win32-x64']);
 assert.equal(result.runtimes.version,historical.runtimes.version);assert.deepEqual(result.runtimes.platforms['win32-x64'],historical.runtimes.platforms['win32-x64']);
 assert.ok(historical.platforms['darwin-arm64'],'Historical source remains intact');
 const jobs=[{name:'native win32-x64',conclusion:'success',steps:[{name:'Verify canonical archive and local incremental reuse',conclusion:'success'}]}];
 assert.equal(verifyBuildRun(source,{conclusion:'success',head_sha:source.ref,path:source.workflow},jobs,'desktop'),true);
 assert.throws(()=>verifyBuildRun(source,{conclusion:'success',head_sha:source.ref,path:source.workflow},jobs,'desktop',{platforms:['darwin-arm64','win32-x64']}),/Missing successful/);
});
test('all automated build matrices target Windows; Mac development retains its own runtime source',()=>{
 for(const name of ['own-build.yml','own-release.yml','own-installers.yml']){
  const workflow=fs.readFileSync(new URL('../../.github/workflows/'+name,import.meta.url),'utf8');
  assert.doesNotMatch(workflow,/os: macos-15|os: \[macos-15/);
  assert.match(workflow,/windows-latest/);
 }
 const runtime=JSON.parse(fs.readFileSync(new URL('../runtime/mac-development.json',import.meta.url)));
 assert.deepEqual(Object.keys(runtime.platforms),['darwin-arm64']);
 assert.ok(runtime.platforms['darwin-arm64'].node.parts.length);
});
