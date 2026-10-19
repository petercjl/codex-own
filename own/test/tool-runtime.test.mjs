import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {validateRuntime,toolEnv,runtimeDoctor,installRuntime} from '../lib/tool-runtime.mjs';
import {payloadURL} from '../lib/npm-assets.mjs';
import {isolateRuntimeSource} from '../builders/runtime-isolation.mjs';
const version='node24.22.0-python3.12.15-r1',key=`${process.platform}-${process.arch}`;
function asset(entry='python'){const sha='a'.repeat(64);return {entry,format:'tar.gz',size:4,sha256:sha,parts:[{size:4,sha256:sha,archiveSize:4,archiveSha256:sha,url:payloadURL(sha)}]};}
test('managed runtime metadata is npm-only and rejects incompatible identity, traversal and unsupported platform',()=>{
 const m={schema:1,version,platforms:{[key]:{node:asset('node-v24.22.0'),python:asset()}}};assert.ok(validateRuntime(m,key));
 for(const mutate of [m=>m.version='../original',m=>m.platforms[key].node.entry='../node',m=>m.platforms[key].python.parts[0].url='https://github.com/runtime.tgz',m=>m.platforms[key].python.size=129*1048576]){const bad=structuredClone(m);mutate(bad);assert.throws(()=>validateRuntime(bad,key));}
 assert.throws(()=>validateRuntime(m,'linux-x64'),{code:'RUNTIME_UNAVAILABLE'});
});
test('managed runtime discovery builds a private child environment without mutating parent or leaking npm/Python system configuration',t=>{
 const base=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'own-env-')));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const dir=path.join(base,'versions',version),win=process.platform==='win32',node=path.join(dir,'node',...(win?[]:['bin']),'node'+(win?'.exe':'')),python=path.join(dir,'python',...(win?[]:['bin']),win?'python.exe':'python3'),npm=path.join(dir,'node',win?'node_modules':'lib/node_modules','npm','bin','npm-cli.js');
 for(const file of [node,python,npm]){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'fixture',{flag:'wx'});}
 fs.writeFileSync(path.join(base,'active.json'),JSON.stringify({schema:1,version,platform:key}),{flag:'wx'});
 const sep=win?';':':',inherited={PATH:['system-tools',path.join(os.homedir(),'.cache','codex-runtimes','bin'),'project-tools'].join(sep),NODE_OPTIONS:'--import=/original/private.mjs',NODE_PATH:'/original/node_modules',PYTHONPATH:'/system/python',VIRTUAL_ENV:'project-venv',NPM_CONFIG_USERCONFIG:'system-npmrc',OPENAI_API_KEY:'private-fixture'};
 const before=structuredClone(inherited),env=toolEnv.environment(base,inherited);assert.deepEqual(inherited,before);
 assert.equal(toolEnv.active(base).node,node);assert.equal(env.NODE_OPTIONS,undefined);assert.equal(env.NODE_PATH,undefined);assert.equal(env.PYTHONPATH,undefined);assert.equal(env.VIRTUAL_ENV,undefined);assert.equal(env.OPENAI_API_KEY,inherited.OPENAI_API_KEY);
 assert.ok(env.NPM_CONFIG_PREFIX.startsWith(base));assert.ok(env.NPM_CONFIG_USERCONFIG.startsWith(base));assert.equal(env.PYTHONNOUSERSITE,'1');assert.equal(env.PIP_REQUIRE_VIRTUALENV,'true');assert.equal(env.PATH.includes('codex-runtimes'),false);assert.equal(env.PATH.includes('project-tools'),false);
 const receipt=path.join(base,'active.json');fs.copyFileSync(receipt,receipt+'.backup',fs.constants.COPYFILE_EXCL);fs.writeFileSync(receipt,JSON.stringify({schema:1,version:'../../original',platform:key}));assert.equal(runtimeDoctor(base).ok,false);
});
test('failed runtime installation releases shared lock and preserves active state',async t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'own-tools-fail-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const p={root,manager:path.join(root,'manager'),platform:key},m={schema:1,version,platforms:{[key]:{node:asset('node-v24.22.0'),python:asset()}}};
 await assert.rejects(installRuntime(m,{p,assemble:async()=>{throw Object.assign(Error('cancelled'),{code:'CANCELLED'});}}),{code:'CANCELLED'});
 assert.equal(fs.existsSync(path.join(p.manager,'operation.lock')),false);assert.equal(fs.existsSync(path.join(root,'runtimes','active.json')),false);assert.deepEqual(fs.readdirSync(path.join(root,'runtimes')).filter(n=>n.startsWith('stage-')),[]);
});
test('upstream cache defaults and optional runtime downloader are isolated while suffix directories are preserved',()=>{
 const s='var a=p.default.join(o.default.homedir(),`.cache`,`codex-runtimes`,`language-servers`);async function x(e){let m=await fetchManifest();return {desiredBundleVersion:m}}async function y(){log("primary_runtime_bundle_install_started");}';
 const patched=isolateRuntimeSource(s);assert.ok(patched.includes('CODEX_OWN_LEGACY_RUNTIME_ROOT'));assert.ok(patched.includes('`language-servers`'));assert.equal(patched.includes('`.cache`,`codex-runtimes`'),false);assert.ok(patched.includes('status:"unsupported"'));assert.ok(patched.includes('codex-own tools are managed through npm'));assert.equal(isolateRuntimeSource(patched),patched);
});
