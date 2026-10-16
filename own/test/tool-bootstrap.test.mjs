import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {EventEmitter} from 'node:events';
import {StringDecoder} from 'node:string_decoder';
import {gateToolStartup} from '../builders/tool-gate.mjs';
const version='node24.22.0-python3.12.15-r1';
function fixture(t,installed=false){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'own-bootstrap-'))),bundle=path.join(root,'bundle');fs.mkdirSync(path.join(bundle,'desktop'),{recursive:true});fs.writeFileSync(path.join(bundle,'desktop-version.json'),JSON.stringify({version:'0.5.0',toolRuntimeVersion:version}),{flag:'wx'});
 t.after(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
 const state={installed,applied:0,spawned:0,errors:0,windows:[]},app=new EventEmitter();app.whenReady=async()=>{};
 class Window extends EventEmitter{constructor(){super();this.destroyed=false;state.windows.push(this);this.webContents={executeJavaScript:async text=>{state.lastProgress=text;}};}async loadURL(url){assert.match(url,/data:text\/html/);}setMenuBarVisibility(){}isDestroyed(){return this.destroyed;}destroy(){this.destroyed=true;this.emit('closed');}}
 const electron={app,BrowserWindow:Window,dialog:{showErrorBox:()=>state.errors++}},child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.connected=true;child.send=message=>{state.cancel=message;queueMicrotask(()=>child.emit('close',1));};
 const module={exports:{}};vm.runInNewContext(fs.readFileSync(new URL('../desktop/tool-bootstrap.cjs',import.meta.url),'utf8'),{module,__dirname:path.join(bundle,'desktop'),process:{platform:process.platform,env:{NODE_OPTIONS:'unsafe',ELECTRON_RUN_AS_NODE:'1'}},require:n=>({'node:fs':fs,'node:path':path,'node:crypto':crypto,'node:child_process':{},'node:string_decoder':{StringDecoder},'../lib/tool-env.cjs':{active:()=>state.installed?{version}:null}}[n])});
 const start=action=>module.exports.ensureTools(electron,root,()=>state.applied++,{launch:(node,args,options)=>{state.spawned++;assert.ok(node.startsWith(bundle));assert.equal(options.env.NODE_OPTIONS,undefined);assert.equal(options.env.ELECTRON_RUN_AS_NODE,undefined);assert.equal(options.stdio.at(-1),'ipc');queueMicrotask(()=>action(child,state));return child;}});
 return {state,child,start,root};
}
test('old updater migration gates async desktop startup and fails on changed upstream entry',()=>{
 const source='setBrowserFlags();d();async function d(){let{initializeNodeNetworkPermissions:e}=await load();await e();}';
 const gated=gateToolStartup(source,'own-runtime-win.cjs');assert.ok(gated.includes('async function d(){await require("./own-runtime-win.cjs").ensureTools();'));assert.equal(gateToolStartup(gated,'own-runtime-win.cjs'),gated);assert.throws(()=>gateToolStartup('startImmediately();','own-runtime.cjs'),/bootstrap contract/);
});
test('valid installed tools allow offline startup without launching a helper or window',async t=>{
 const {state,start}=fixture(t,true);assert.equal((await start()).unchanged,true);assert.equal(state.applied,1);assert.equal(state.spawned,0);assert.equal(state.windows.length,0);
});
test('migration waits for verified receipt, decodes split Chinese progress and reapplies environment',async t=>{
 const {state,start}=fixture(t);const result=await start((child,state)=>{const bytes=Buffer.from('下载独立工具\n');child.stderr.emit('data',bytes.subarray(0,5));child.stderr.emit('data',bytes.subarray(5));state.installed=true;child.stdout.emit('data',Buffer.from('{"ok":true}\n'));child.emit('close',0);});
 assert.equal(result.ok,true);assert.equal(state.applied,1);assert.equal(state.errors,0);assert.ok(state.lastProgress.includes('下载独立工具'));assert.equal(state.windows[0].destroyed,true);
});
test('migration cancellation cooperates over IPC and never activates an unverified runtime',async t=>{
 const {state,start}=fixture(t);await assert.rejects(start((_child,state)=>state.windows[0].emit('closed')),{code:'CANCELLED'});assert.equal(state.cancel.cancel,true);assert.equal(state.applied,0);assert.equal(state.errors,0);
});
test('failed preparation preserves existing environment and reports its diagnostic log',async t=>{
 const {state,start}=fixture(t);await assert.rejects(start(child=>child.emit('close',1)),/Runtime preparation failed/);assert.equal(state.applied,0);assert.equal(state.errors,1);
});
