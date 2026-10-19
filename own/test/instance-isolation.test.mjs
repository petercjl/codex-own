import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {launcherScript} from '../builders/mac-launcher.mjs';
import vm from 'node:vm';
const require=createRequire(import.meta.url),tools=require('../lib/tool-env.cjs');
const version='node24.22.0-python3.12.15-r1';
function fixture(t){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'own-relocated-'))),base=path.join(root,'runtimes'),dir=path.join(base,'versions',version);
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const rel of ['node/bin/node','python/bin/python3','node/lib/node_modules/npm/bin/npm-cli.js']){const p=path.join(dir,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,'fixture',{flag:'wx'});}
 fs.writeFileSync(path.join(base,'active.json'),JSON.stringify({schema:1,version,platform:`${process.platform}-${process.arch}`}));
 return {root,base,dir};
}
test('relocated runtime repairs copied shell files and isolates real login Bash and zsh', {skip:process.platform!=='darwin'},t=>{
 const {base,root,dir}=fixture(t),shell=path.join(dir,'shell');fs.mkdirSync(shell);
 fs.writeFileSync(path.join(shell,'bash-env.sh'),"export CODEX_HOME='/foreign-agent/core'\nexport NPM_CONFIG_PREFIX='/foreign-agent/npm'\n");
 const env={...process.env,HOME:'/foreign-agent',CODEX_HOME:'/foreign-agent/core',CODEX_SKILLS_DIR:'/foreign-agent/skills',NPM_CONFIG_PREFIX:'/foreign-agent/npm',BASH_ENV:path.join(shell,'bash-env.sh'),CLAUDE_CONFIG_DIR:'/foreign-agent/config',XDG_CONFIG_HOME:'/foreign-agent/xdg',PATH:'/foreign-agent/bin:/usr/bin:/bin'};
 tools.apply(base,env);
 const probe='printf "%s\\n" "$HOME" "$CODEX_HOME" "$CODEX_SKILLS_DIR" "$NPM_CONFIG_PREFIX" "$XDG_CONFIG_HOME" "${CLAUDE_CONFIG_DIR-unset}" "$PATH"';
 for(const binary of ['/bin/bash','/bin/zsh']){
  const lines=execFileSync(binary,['-lc',probe],{env,encoding:'utf8'}).trim().split('\n');
  assert.equal(lines[0],path.join(root,'home'));assert.equal(lines[1],path.join(root,'core'));assert.equal(lines[2],path.join(root,'core','skills'));assert.equal(lines[3],path.join(base,'npm-global'));assert.equal(lines[4],path.join(root,'home','.config'));assert.equal(lines[5],'unset');assert.ok(!lines[6].includes('/foreign-agent/'));
 }
 const backups=fs.readdirSync(shell).filter(n=>n.startsWith('bash-env.sh.backup-'));assert.equal(backups.length,1);assert.match(fs.readFileSync(path.join(shell,backups[0]),'utf8'),/foreign-agent/);
 tools.apply(base,env);assert.equal(fs.readdirSync(shell).filter(n=>n.startsWith('bash-env.sh.backup-')).length,1);
});
test('backend environment ignores inherited Agent configuration and keeps explicit task identity', {skip:process.platform!=='darwin'},t=>{
 const {base,root}=fixture(t),source={HOME:'/foreign',CODEX_HOME:'/foreign/core',CODEX_THREAD_ID:'thread-preserved',CLAUDE_CONFIG_DIR:'/foreign',SEALSEEK_HOME:'/foreign',OPENCLAW_HOME:'/foreign',GEMINI_CLI_HOME:'/foreign',VIRTUAL_ENV:'/foreign/venv',PYTHONPATH:'/foreign/python',NODE_PATH:'/foreign/node',PATH:'/foreign/bin:/usr/bin:/bin'};
 const next=tools.environment(base,source);
 assert.equal(next.HOME,path.join(root,'home'));assert.equal(next.CODEX_HOME,path.join(root,'core'));assert.equal(next.CODEX_THREAD_ID,'thread-preserved');
 for(const k of ['CLAUDE_CONFIG_DIR','SEALSEEK_HOME','OPENCLAW_HOME','GEMINI_CLI_HOME','VIRTUAL_ENV','NODE_PATH','PYTHONPATH'])assert.equal(next[k],undefined,k);
 assert.equal(source.CODEX_HOME,'/foreign/core');
});
test('desktop spawn boundary gives the backend a private home even in subscription mode', {skip:process.platform!=='darwin'},t=>{
 const {base,root}=fixture(t),adapter=require('../lib/api-input-compat.cjs');let received;
 const api={spawn(file,args,options){received=options;return {};}};
 adapter.install({cli:'/fixture/owned-cli',core:path.join(root,'core'),processApi:api});t.after(()=>api[adapter.HOOK].restore());
 api.spawn('/fixture/owned-cli',['app-server'],{env:{HOME:'/foreign',CODEX_HOME:'/foreign/core',PATH:'/foreign/bin:/usr/bin'}});
 assert.equal(received.env.HOME,path.join(root,'home'));assert.equal(received.env.CODEX_HOME,path.join(root,'core'));assert.equal(received.env.NPM_CONFIG_PREFIX,path.join(base,'npm-global'));
});
test('development identity disables updates without relying on the app filename',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'own-identity-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const {identity}=require('../lib/instance.cjs');assert.equal(identity(root).identifier,'local.codex-own');
 const marker=path.join(root,'own-development.json');fs.writeFileSync(marker,JSON.stringify({schema:1,channel:'development',automaticUpdates:false}));
 assert.equal(identity(root).identifier,'local.codex-own.development');assert.equal(identity(root).automaticUpdates,false);
 fs.writeFileSync(marker,'{}');assert.throws(()=>identity(root),/Invalid development identity/);
});
test('both launchers resolve the OS account home instead of inheriting a foreign Agent home', {skip:process.platform!=='darwin'},t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'own-launch-home-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const resolver=path.join(root,'account-home');fs.writeFileSync(resolver,'#!/bin/sh\nprintf "NFSHomeDirectory: %s\\n" '+JSON.stringify(root)+'\n',{flag:'wx',mode:0o755});
 const app=path.join(root,'ChatGPT');fs.writeFileSync(app,'#!/bin/sh\nprintf "%s\\n" "$HOME" "$CFFIXED_USER_HOME" "$USERPROFILE" "$@"\n',{flag:'wx',mode:0o755});
 for(const dev of [false,true]){
  const launcher=path.join(root,dev?'development-launch':'stable-launch');fs.writeFileSync(launcher,launcherScript(dev).replace('/usr/bin/dscl',resolver),{flag:'wx',mode:0o755});
  const expected=dev?path.join(root,'.codex-own-dev'):root;
  const lines=execFileSync(launcher,[],{env:{...process.env,HOME:'/foreign-agent/private-home'},encoding:'utf8'}).trim().split('\n');
  assert.deepEqual(lines.slice(0,3),[root,root,root]);assert.equal(lines[3],'--user-data-dir='+path.join(expected,'Library/Application Support/codex-own-independent/desktop'));
 }
});
test('foreign home or npm configuration symlinks fail before environment activation', {skip:process.platform!=='darwin'},t=>{
 const {base,root}=fixture(t),foreign=path.join(root,'foreign');fs.mkdirSync(foreign);
 fs.symlinkSync(foreign,path.join(root,'home'));assert.throws(()=>tools.apply(base,{}),/symbolic link/);fs.unlinkSync(path.join(root,'home'));
 fs.writeFileSync(path.join(foreign,'npmrc'),'fixture',{flag:'wx'});fs.symlinkSync(path.join(foreign,'npmrc'),path.join(base,'npmrc'));assert.throws(()=>tools.environment(base,{}),/symbolic link/);
});
test('Mac native desktop keeps the OS home while development data and task homes are independent',t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'own-native-home-')),resources=path.join(home,'resources');fs.mkdirSync(resources);t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 fs.writeFileSync(path.join(resources,'codex-own-cli'),'fixture',{flag:'wx'});
 const nativeEnv={HOME:home,CFFIXED_USER_HOME:home,USERPROFILE:home},processMock={env:nativeEnv,platform:'darwin',resourcesPath:resources};let selection;
 const app={setName(){},setPath(){},whenReady:()=>({then(){}})},module={exports:{}};
 const stubs={'node:fs':fs,'node:path':path,'node:os':{homedir:()=>home},electron:{app,nativeImage:{}}};
 vm.runInNewContext(fs.readFileSync(new URL('../runtime/mac.cjs',import.meta.url),'utf8'),{module,process:processMock,require:n=>{
  if(n.endsWith('instance.cjs'))return {identity:()=>({name:'codex-own 开发版',channel:'development'})};
  if(n.endsWith('tool-env.cjs'))return {apply:(base,_env,_platform,options)=>{selection={base,options};}};
  if(n.endsWith('api-input-compat.cjs')||n.endsWith('product-mode.cjs')||n.endsWith('thread-titles.cjs'))return {install(){}};
  if(n.endsWith('controller.cjs'))return {start(){}};
  return stubs[n];
 }});
 assert.equal(nativeEnv.HOME,home);assert.equal(nativeEnv.CFFIXED_USER_HOME,home);assert.equal(nativeEnv.USERPROFILE,home);
 assert.equal(module.exports.paths.root,path.join(home,'.codex-own-dev/Library/Application Support/codex-own-independent'));assert.equal(selection.base,path.join(module.exports.paths.root,'runtimes'));assert.equal(selection.options.host,true);
});
