import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
for(const kind of ['mac','windows'])test(`${kind} runtime isolates home, inherited credentials, identity and shell reimport`,()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'own-runtime-')),resources=path.join(home,'resources');fs.mkdirSync(resources);
 fs.writeFileSync(path.join(resources,kind==='mac'?'codex-own-cli':'codex.exe'),'');if(kind==='windows')fs.writeFileSync(path.join(resources,'codex-own-runtime.json'),'{"cli":"codex.exe"}');
 const calls={},app={setName:n=>calls.name=n,setPath:(k,v)=>calls[k]=v,setAppUserModelId:n=>calls.appId=n,whenReady:()=>({then:()=>{}})};
 const processMock={platform:kind==='mac'?'darwin':'win32',resourcesPath:resources,env:{CODEX_HOME:'original-home',OPENAI_API_KEY:'original-token',CHATGPT_TOKEN:'other',NODE_REPL_PORT:'1',LOCALAPPDATA:path.join(home,'Local')}};
 const module={exports:{}};vm.runInNewContext(fs.readFileSync(new URL(`../runtime/${kind}.cjs`,import.meta.url),'utf8'),{process:processMock,module,require:n=>n.endsWith('controller.cjs')?{start:(_electron,root)=>{calls.updaterRoot=root;}}:({'node:fs':fs,'node:path':path,'node:os':{homedir:()=>home},electron:{app,nativeImage:{}}}[n])});
 assert.ok(calls.updaterRoot.includes('codex-own-independent'));
 assert.equal(calls.name,'codex-own');assert.ok(processMock.env.CODEX_HOME.includes('codex-own-independent'));assert.equal(processMock.env.OPENAI_API_KEY,undefined);assert.equal(processMock.env.CODEX_TPP_LOCAL_EXECUTOR_ENABLED,'0');
 processMock.env.CODEX_HOME='shell-original';processMock.env.OPENAI_API_KEY='shell-token';module.exports.apply();assert.equal(processMock.env.CODEX_HOME,module.exports.paths.core);assert.equal(processMock.env.OPENAI_API_KEY,undefined);assert.equal(app.setAsDefaultProtocolClient(),false);
 app.setName('Codex');assert.equal(calls.name,'codex-own');if(kind==='windows'){app.setAppUserModelId('original');assert.equal(calls.appId,'local.codex-own');}
});
