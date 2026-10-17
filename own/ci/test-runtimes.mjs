import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {installRuntime,runtimeDoctor,toolEnv,rollbackRuntime} from '../lib/tool-runtime.mjs';
import {payloadURL} from '../lib/npm-assets.mjs';
import {sourceTree} from './source-tree.mjs';
import {fileHash} from '../lib/network.mjs';
const dir=path.resolve(process.argv[2]),key=`${process.platform}-${process.arch}`;
const m=JSON.parse(fs.readFileSync(path.join(dir,'runtime-input.json'))),assets=m.platforms[key];
for(const a of Object.values(assets))if(a.incremental)a.parts=a.incremental.blocks.map(b=>({...b,url:payloadURL(b.sha256),archiveSha256:b.sha256,archiveSize:b.size}));
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'own-tools-中文-'))),p={root,manager:path.join(root,'manager'),platform:key};
const localAssets=Object.fromEntries(['node','python'].map(n=>[n,path.join(dir,`runtime-${key}-${n}.bin`)]));
const protectedPath=process.env.PATH;
const first=await installRuntime(m,{p,localAssets});assert.equal(first.ok,true);
const base=path.join(root,'runtimes'),env=toolEnv.environment(base),r=toolEnv.active(base);
assert.equal(process.env.PATH,protectedPath);
const run=(file,args,options={})=>execFileSync(file,args,{env,encoding:'utf8',windowsHide:true,timeout:120000,...options}).trim();
assert.equal(run(r.node,['-p','process.execPath']),r.node);
// Exercise installation semantics under the distributed Node, not only its
// version string. Node 24.22 on Windows differs from the build Node 24.15.
execFileSync(r.node,['--test',path.resolve(import.meta.dirname,'../test/installation-recovery.test.mjs')],{encoding:'utf8',env,windowsHide:true,timeout:120000});
assert.match(run(r.node,[r.npm,'--version']),/^\d+\.\d+\.\d+$/);
assert.equal(run(r.python,['-c','import sys; print(sys.executable)']),r.python);
assert.ok(run(r.node,[r.npm,'config','get','prefix']).startsWith(base));
if(process.platform==='darwin')for(const shell of ['/bin/zsh','/bin/bash']){
 const output=run(shell,['-lc','command -v node; command -v npm; command -v python3']);
 assert.ok(output.split('\n').every(p=>p.startsWith(r.directory)),`Login shell escaped private toolchain: ${output}`);
}
const venv=path.join(root,'测试项目','.venv');run(r.python,['-m','venv',venv]);
const py=path.join(venv,process.platform==='win32'?'Scripts/python.exe':'bin/python');
assert.equal(run(py,['-c','import sys; print(sys.prefix)']),venv);
assert.match(run(py,['-m','pip','--version']),/pip /);
const wheel=path.join(root,'own_fixture-1.0-py3-none-any.whl');
run(r.python,['-c',"import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w'); z.writestr('own_fixture.py','VALUE = 42\\n'); z.writestr('own_fixture-1.0.dist-info/METADATA','Metadata-Version: 2.1\\nName: own-fixture\\nVersion: 1.0\\n'); z.writestr('own_fixture-1.0.dist-info/WHEEL','Wheel-Version: 1.0\\nGenerator: codex-own-test\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n'); z.writestr('own_fixture-1.0.dist-info/RECORD',''); z.close()",wheel]);
run(py,['-m','pip','install','--no-index',wheel]);assert.equal(run(py,['-c','import own_fixture; print(own_fixture.VALUE)']),'42');
// Offline real package installation, using the project's venv and npm prefix.
const npmFixture=path.join(root,'npm-fixture');fs.mkdirSync(npmFixture);fs.writeFileSync(path.join(npmFixture,'package.json'),JSON.stringify({name:'own-tools-fixture',version:'1.0.0',bin:{'own-fixture':'index.cjs'}}),{flag:'wx'});fs.writeFileSync(path.join(npmFixture,'index.cjs'),'#!/usr/bin/env node\nconsole.log("private runtime ok");\n',{flag:'wx',mode:0o755});
run(r.node,[r.npm,'install','--prefix',path.join(root,'测试项目'),npmFixture,'--ignore-scripts','--no-audit','--no-fund','--offline']);
assert.ok(fs.existsSync(path.join(root,'测试项目','node_modules','own-tools-fixture')));
assert.equal((await installRuntime(m,{p,localAssets})).unchanged,true);
const before=fs.readFileSync(path.join(base,'active.json'));
const corrupt=structuredClone(m);corrupt.version=m.version.replace('-r1','-r2');corrupt.platforms[key].node.sha256='0'.repeat(64);
await assert.rejects(installRuntime(corrupt,{p,localAssets}),{code:'CHECKSUM_MISMATCH'});
assert.deepEqual(fs.readFileSync(path.join(base,'active.json')),before);assert.equal(runtimeDoctor(base).ok,true);
const upgraded=structuredClone(m);upgraded.version=m.version.replace('-r1','-r2');
assert.equal((await installRuntime(upgraded,{p,localAssets})).version,upgraded.version);
assert.equal((await rollbackRuntime({p})).version,m.version);
assert.ok(fs.existsSync(path.join(base,'versions',upgraded.version)));
assert.equal(fs.existsSync(path.join(p.manager,'operation.lock')),false);
const output={ok:true,platform:key,versions:{node:first.node.version,npm:first.npm.version,python:first.python.version},venv:true,pipOfflineInstall:true,npmLocalInstall:true,checksumFailurePreservesActive:true,rollback:true,systemPathPreserved:true,root};
const components={node:{identity:assets.node.sha256,binarySha256:await fileHash(r.node),version:first.node.version.replace(/^v/,'')},npm:{identity:(await sourceTree(path.dirname(path.dirname(r.npm)),{modes:false})).sha256,version:first.npm.version,bundledWith:'node'},python:{identity:assets.python.sha256,binarySha256:await fileHash(r.python),version:first.python.version.replace(/^Python /,'')}};
fs.writeFileSync(path.join(dir,'publish',`runtime-components-${key}.json`),JSON.stringify({schema:1,platform:key,version:m.version,components},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(output));
