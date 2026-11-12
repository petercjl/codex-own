import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import vm from 'node:vm';
import {nativeWindowsSource,nativeWindowsChanges,optimizeWindowsPayload,disableUpstreamUpdates} from '../builders/windows-payload.mjs';
test('upstream updater isolation covers expression and block functions while retaining unrelated policies',()=>{
 for(const value of ['()=>true','()=>{return true}','function(){return true}']){
  const source=`const p={shouldIncludeSparkle:${value},shouldIncludeWindowsUpdater:${value},shouldIncludeWindowsMsixUpdater:${value},shouldIncludeUpdater:${value},shouldIncludeBrowserUsePeerAuthorization:()=>true};this.policy=p;`;
  const patched=disableUpstreamUpdates(source),context={};vm.runInNewContext(patched.source,context);assert.equal(patched.patches,4);
  for(const name of ['shouldIncludeSparkle','shouldIncludeWindowsUpdater','shouldIncludeWindowsMsixUpdater','shouldIncludeUpdater'])assert.equal(context.policy[name](),false);
  assert.equal(context.policy.shouldIncludeBrowserUsePeerAuthorization(),true);
 }
 assert.equal(disableUpstreamUpdates('const unrelated=1;').patches,0);
});
test('both the main-process and worker WSL policies receive the native override',()=>{
 const source='function w(){throw Error(`shouldSpawnInsideWsl not set`)}';
 const asar={listPackage:()=>['/.vite/build/application-network-startup-fixture.js','/.vite/build/worker.js'],extractFile:()=>Buffer.from(source)};
 const changed=nativeWindowsChanges(asar,'unused');assert.equal(changed.size,2);for(const b of changed.values())assert.match(b.toString(),/return false/);
});
test('native execution ignores both stored WSL preferences and explicit WSL overrides, preserving unrelated process choices',()=>{
 const original='function w(){throw Error(`shouldSpawnInsideWsl not set`)}function run(p){return (p.spawnInsideWsl??w())?"wsl":"windows"}function mode({spawnInsideWsl:s}){return(s??w())?"wsl":"windows"}function remote(){return "ssh"}';
 const patched=nativeWindowsSource(original);assert(patched.patches>=3);const ctx={};vm.runInNewContext(patched.source+';this.run=run;this.mode=mode;this.remote=remote',ctx);assert.equal(ctx.run({spawnInsideWsl:true}),'windows');assert.equal(ctx.mode({spawnInsideWsl:true}),'windows');assert.equal(ctx.run({}),'windows');assert.equal(ctx.remote(),'ssh');assert.equal(nativeWindowsSource(patched.source).patches,0);assert.throws(()=>nativeWindowsSource('function unknown(){return true}'),/anchor missing/);
});
test('reused minifier bindings in sibling modules retain path resolver values',()=>{
 const source='const modules={policy:function(){function v(){throw Error("shouldSpawnInsideWsl not set")}return (p)=>(p.spawnInsideWsl??v())?"wsl":"windows"},paths:function(){function v(){return "C:/app/resources/codex.exe"}return (custom)=>(custom??v())}};this.modules=modules;';
 const result=nativeWindowsSource(source),context={};vm.runInNewContext(result.source,context);
 assert.equal(context.modules.policy()({spawnInsideWsl:true}),'windows');assert.equal(context.modules.paths()(),'C:/app/resources/codex.exe');assert.equal(context.modules.paths()('explicit.exe'),'explicit.exe');
});
test('Windows payload retains native programs and removes only checked Linux helpers and foreign prebuilds',t=>{
 const app=fs.mkdtempSync(path.join(os.tmpdir(),'own-native-payload-'));t.after(()=>fs.rmSync(app,{recursive:true,force:true}));const resources=path.join(app,'resources');fs.mkdirSync(resources);
 for(const n of ['codex.exe','codex-code-mode-host.exe','rg.exe'])fs.writeFileSync(path.join(resources,n),'MZnative',{flag:'wx'});
 for(const n of ['codex','codex-code-mode-host','rg'])fs.writeFileSync(path.join(resources,n),Buffer.concat([Buffer.from([127,69,76,70]),Buffer.from(n)]),{flag:'wx'});
 const base=path.join(resources,'cua_node/bin/node_modules/classic-level/prebuilds');for(const arch of ['win32-x64','linux-x64','darwin-arm64']){fs.mkdirSync(path.join(base,arch),{recursive:true});fs.writeFileSync(path.join(base,arch,'binding.node'),arch,{flag:'wx'});}
 const r=optimizeWindowsPayload(app);assert.equal(r.removed.length,5);assert(r.removedBytes>0);assert(fs.existsSync(path.join(base,'win32-x64/binding.node')));assert(!fs.existsSync(path.join(base,'linux-x64')));for(const n of ['codex.exe','codex-code-mode-host.exe','rg.exe'])assert.equal(fs.readFileSync(path.join(resources,n),'utf8'),'MZnative');assert.equal(optimizeWindowsPayload(app).removedBytes,0);
 fs.writeFileSync(path.join(resources,'codex'),'MZunexpected');assert.throws(()=>optimizeWindowsPayload(app),/Unexpected Linux executable identity/);assert(fs.existsSync(path.join(resources,'codex')));
 fs.unlinkSync(path.join(resources,'rg.exe'));assert.throws(()=>optimizeWindowsPayload(app),/Required native Windows/);
});
