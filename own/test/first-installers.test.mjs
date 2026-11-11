import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {compareVersions,validateInfo,validateBundle,hashFile,checkExisting} from '../installers/offline-install.mjs';
import {validateInstallerRecovery} from '../installers/recovery.mjs';
const zero='0'.repeat(64),manifest=()=>({repository:'petercjl/codex-own',version:'0.6.7',binding:{managerVersion:'0.6.8'},platforms:{'win32-x64':{}},runtimes:{platforms:{'win32-x64':{node:{format:'zip'},python:{format:'tar.gz'}}}}});
const info=()=>({schema:1,package:'@petercjl/codex-own',managerVersion:'0.6.8',desktopVersion:'0.6.7',platform:'win32-x64',runtimeFiles:{node:'node.zip',python:'python.tar.gz'},files:['release.json','desktop.tar.gz','node.zip','python.tar.gz','engine/node.exe','engine/lib/manager.mjs','engine/lib/tool-runtime.mjs'].map(path=>({path,size:0,sha256:zero}))});
test('publication recovery requires exact trusted source, successful native QA and unchanged installer inputs',()=>{
 const fixture=()=>({id:'42',run:{id:42,path:'.github/workflows/own-installers.yml',head_branch:'own-main',event:'workflow_dispatch',status:'completed',head_sha:'a'.repeat(40)},jobs:[{name:'build (windows-latest, win32-x64)',status:'completed',conclusion:'success',steps:[{name:'Verify offline first install repeat install and npm update adoption',conclusion:'success'}]}],artifacts:[{name:'first-installer-win32-x64',expired:false,size_in_bytes:123}],changed:['.github/workflows/own-installers.yml','own/installers/recovery.mjs']});
 assert.equal(validateInstallerRecovery(fixture()).sourceRun,'42');
 for(const mutate of [f=>f.id='43',f=>f.run.head_branch='other',f=>f.run.path='.github/workflows/own-release.yml',f=>f.jobs[0].conclusion='failure',f=>f.jobs[0].steps=[],f=>f.artifacts[0].expired=true,f=>f.artifacts.push(f.artifacts[0]),f=>f.changed.push('own/installers/build.mjs'),f=>f.changed.push('own/lib/manager.mjs')]){const f=fixture();mutate(f);assert.throws(()=>validateInstallerRecovery(f));}
});
test('offline installer accepts independent manager and desktop versions but rejects wrong identity, architecture and unsafe paths',()=>{
 assert.equal(validateInfo(info(),manifest(),'win32-x64').managerVersion,'0.6.8');
 for(const change of [i=>i.platform='darwin-arm64',i=>i.package='other',i=>i.managerVersion='0.6.9',i=>i.files[0].path='../secret',i=>i.files[0].path='/absolute',i=>i.files[0].path='engine//file',i=>i.runtimeFiles.node='../node',i=>i.files.push(i.files[0])]){const i=info();change(i);assert.throws(()=>validateInfo(i,manifest(),'win32-x64'));}
});
test('first-install guard allows repeat installs and compatible upgrades, preserves newer and unmanaged installations',()=>{
 assert.equal(compareVersions('0.6.10','0.6.8'),1);assert.equal(compareVersions('1.0.0','1.0.0'),0);
 assert.throws(()=>compareVersions('latest','1.0.0'));
 checkExisting(null,manifest());checkExisting({identity:'local.codex-own',version:'0.6.7',releaseManifest:{binding:{managerVersion:'0.6.8'}}},manifest());
 assert.throws(()=>checkExisting({identity:'local.codex-own',version:'0.6.9'},manifest()),{code:'INSTALLER_OLDER'});
 assert.throws(()=>checkExisting({identity:'local.codex-own.development',version:'0.6.7'},manifest()),{code:'UNMANAGED_TARGET'});
});
test('complete local inventory detects changed resources and directory-link escapes before installation',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'own-offline-inventory-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const i=info(),m=manifest();
 for(const f of i.files){const p=path.join(root,f.path);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,f.path==='release.json'?JSON.stringify(m):'fixture',{flag:'wx'});f.size=fs.statSync(p).size;f.sha256=await hashFile(p);}
 fs.writeFileSync(path.join(root,'installer.json'),JSON.stringify(i),{flag:'wx'});assert.equal((await validateBundle(root,'win32-x64')).info.managerVersion,'0.6.8');
 const changed=path.join(root,'desktop.tar.gz');fs.appendFileSync(changed,'corruption');await assert.rejects(validateBundle(root,'win32-x64'),{code:'CHECKSUM_MISMATCH'});
 if(process.platform!=='win32'){fs.truncateSync(changed,'fixture'.length);fs.renameSync(path.join(root,'engine'),path.join(root,'engine-outside'));fs.symlinkSync('engine-outside',path.join(root,'engine'));await assert.rejects(validateBundle(root,'win32-x64'),{code:'UNSAFE_PATH'});}
});
