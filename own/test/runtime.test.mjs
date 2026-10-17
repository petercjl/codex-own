import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const productPolicy=createRequire(import.meta.url)('../desktop/product-mode.cjs');
for(const kind of ['mac','windows'])test(`${kind} runtime isolates home, inherited credentials, identity and shell reimport`,t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'own-runtime-')),resources=path.join(home,'resources');fs.mkdirSync(resources);
 t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 fs.writeFileSync(path.join(resources,kind==='mac'?'codex-own-cli':'codex.exe'),'');if(kind==='windows')fs.writeFileSync(path.join(resources,'codex-own-runtime.json'),'{"cli":"codex.exe"}');
 const calls={},app={setName:n=>calls.name=n,setPath:(k,v)=>{if(kind==='windows')assert.ok(fs.statSync(v).isDirectory(),'Windows app paths must exist before setPath');calls[k]=v;},setAppUserModelId:n=>calls.appId=n,whenReady:()=>({then:()=>{}})};
 const processMock={platform:kind==='mac'?'darwin':'win32',resourcesPath:resources,env:{CODEX_HOME:'original-home',OPENAI_API_KEY:'original-token',CHATGPT_TOKEN:'other',NODE_REPL_PORT:'1',LOCALAPPDATA:path.join(home,'Local')}};
 const module={exports:{}};vm.runInNewContext(fs.readFileSync(new URL(`../runtime/${kind}.cjs`,import.meta.url),'utf8'),{process:processMock,module,require:n=>n.endsWith('product-mode.cjs')?productPolicy:n.endsWith('windows-agent-shell.cjs')?{install:options=>{calls.agentShell=options;}}:n.endsWith('tool-env.cjs')?{apply:base=>{calls.toolRoot=base;}}:n.endsWith('controller.cjs')?{start:(_electron,root)=>{calls.updaterRoot=root;}}:({'node:fs':fs,'node:path':path,'node:os':{homedir:()=>home},electron:{app,nativeImage:{},ipcMain:{on:(channel,handler)=>{calls.productPolicy={channel,handler};}}}}[n])});
 assert.equal(calls.productPolicy.channel,productPolicy.CHANNEL);const event={};calls.productPolicy.handler(event);assert.deepEqual(event.returnValue,{contract:1,apiMode:false});
 fs.writeFileSync(path.join(module.exports.paths.core,'auth.json'),'{"auth_mode":"apikey","OPENAI_API_KEY":"sk-test-private"}');calls.productPolicy.handler(event);assert.deepEqual(event.returnValue,{contract:1,apiMode:true});
 assert.ok(calls.updaterRoot.includes('codex-own-independent'));
 assert.ok(calls.toolRoot.includes('codex-own-independent'));assert.equal(processMock.env.CODEX_OWN_LEGACY_RUNTIME_ROOT,path.join(module.exports.paths.root,'runtimes','upstream-disabled'));
 assert.equal(calls.name,'codex-own');assert.ok(processMock.env.CODEX_HOME.includes('codex-own-independent'));assert.equal(processMock.env.OPENAI_API_KEY,undefined);assert.equal(processMock.env.CODEX_TPP_LOCAL_EXECUTOR_ENABLED,'0');
 processMock.env.CODEX_HOME='shell-original';processMock.env.OPENAI_API_KEY='shell-token';module.exports.apply();assert.equal(processMock.env.CODEX_HOME,module.exports.paths.core);assert.equal(processMock.env.OPENAI_API_KEY,undefined);assert.equal(app.setAsDefaultProtocolClient(),false);
 app.setName('Codex');assert.equal(calls.name,'codex-own');if(kind==='windows'){app.setAppUserModelId('original');assert.equal(calls.appId,'local.codex-own');assert.equal(calls.agentShell.core,module.exports.paths.core);assert.equal(calls.agentShell.cli,path.join(resources,'codex.exe'));}
});
