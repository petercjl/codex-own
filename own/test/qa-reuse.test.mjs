import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyQAReuse} from '../ci/verify-qa-reuse.mjs';
const fixture=()=>({run:{head_branch:'own-main',head_sha:'a'.repeat(40),path:'.github/workflows/own-release.yml'},jobs:['qa / qa (macos-15, darwin-arm64)','qa / qa (windows-latest, win32-x64)'].map(name=>({name,status:'completed',conclusion:'success'})),artifacts:['own-darwin-arm64','own-win32-x64'].map(name=>({name,size_in_bytes:100,expired:false})),changed:['.github/workflows/own-release.yml']});
test('publication recovery accepts passed platform jobs only when app inputs are identical',()=>{assert.equal(verifyQAReuse(fixture()).appCodeUnchanged,true);});
test('changed runtime, packaging, tests, missing artifacts or failed QA require a full build',()=>{
 for(const mutate of [f=>f.changed.push('own/lib/tool-runtime.mjs'),f=>f.changed.push('own/ci/publish-npm-assets.mjs'),f=>f.changed.push('own/test/runtime.test.mjs'),f=>f.jobs[1].conclusion='failure',f=>f.jobs[0].status='in_progress',f=>f.artifacts[0].expired=true,f=>f.artifacts.pop(),f=>f.run.head_branch='other']){const f=fixture();mutate(f);assert.throws(()=>verifyQAReuse(f));}
});
