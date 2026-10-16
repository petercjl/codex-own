import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {parse} from 'smol-toml';
import {configure} from '../lib/manager.mjs';

function fixture(text){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'own-model-config-'))),p={root,core:path.join(root,'core'),manager:path.join(root,'manager'),target:path.join(root,'app')};fs.mkdirSync(p.core);const keyFile=path.join(root,'key.txt');fs.writeFileSync(keyFile,'sk-fixture-key-not-real-12345',{flag:'wx',mode:0o600});fs.writeFileSync(path.join(p.core,'auth.json'),JSON.stringify({auth_mode:'apikey',OPENAI_API_KEY:'sk-previous-fixture-12345'}),{flag:'wx',mode:0o600});if(text!==undefined)fs.writeFileSync(path.join(p.core,'config.toml'),text,{flag:'wx',mode:0o600});return{p,keyFile};}
test('configuring after first GUI startup replaces GPT defaults with DeepSeek while preserving desktop preferences',async()=>{
 const original='model = "gpt-6.1-sol"\nmodel_reasoning_effort = "medium"\n[desktop]\nsansFontSize = 14\nconversationDetailMode = "STEPS_PROSE"\n[plugins.example]\nenabled = true\n',a=fixture(original);
 const result=await configure(a.keyFile,{p:a.p,isRunning:()=>[]}),config=parse(fs.readFileSync(path.join(a.p.core,'config.toml'),'utf8'));
 assert.equal(config.model,'deepseek-v4.1-flash');assert.equal(config.model_provider,'dashscope_deepseek');assert.equal(config.forced_login_method,'api');assert.equal(config.model_reasoning_effort,'medium');assert.equal(config.desktop.sansFontSize,14);assert.equal(config.desktop.conversationDetailMode,'STEPS_PROSE');assert.equal(config.plugins.example.enabled,true);assert.equal(config.model_providers.dashscope_deepseek.base_url,'https://dashscope.aliyuncs.com/compatible-mode/v1');assert.equal(fs.readFileSync(result.configBackup,'utf8'),original);
});
test('invalid existing TOML cannot change credentials or configuration',async()=>{
 const a=fixture('model = [broken'),file=path.join(a.p.core,'auth.json'),auth=fs.readFileSync(file);
 await assert.rejects(configure(a.keyFile,{p:a.p,isRunning:()=>[]}),{code:'CONFIG_INVALID'});
 assert.deepEqual(fs.readFileSync(file),auth);assert.equal(fs.readFileSync(path.join(a.p.core,'config.toml'),'utf8'),'model = [broken');
});
test('repeat configure retains an explicitly selected DeepSeek model and custom provider options',async()=>{
 const a=fixture('model = "deepseek-v4-pro"\nmodel_provider = "dashscope_deepseek"\n[model_providers.dashscope_deepseek]\nbase_url = "https://gateway.example/v1"\nrequest_max_retries = 4\n');
 await configure(a.keyFile,{p:a.p,isRunning:()=>[]});const first=fs.readFileSync(path.join(a.p.core,'config.toml'),'utf8');
 const result=await configure(a.keyFile,{p:a.p,isRunning:()=>[]}),config=parse(fs.readFileSync(path.join(a.p.core,'config.toml'),'utf8'));
 assert.equal(config.model,'deepseek-v4-pro');assert.equal(config.model_providers.dashscope_deepseek.base_url,'https://gateway.example/v1');assert.equal(config.model_providers.dashscope_deepseek.request_max_retries,4);assert.equal(result.configPreserved,true);assert.equal(result.configBackup,null);assert.equal(fs.readFileSync(path.join(a.p.core,'config.toml'),'utf8'),first);
});
test('fresh configure creates a DeepSeek catalogue binding and refuses a running app',async()=>{
 const a=fixture();await assert.rejects(configure(a.keyFile,{p:a.p,isRunning:()=>[123]}),{code:'APP_RUNNING'});assert.equal(fs.existsSync(path.join(a.p.core,'config.toml')),false);
 await configure(a.keyFile,{p:a.p,isRunning:()=>[]});const config=parse(fs.readFileSync(path.join(a.p.core,'config.toml'),'utf8'));
 assert.equal(config.model,'deepseek-v4.1-flash');assert.equal(config.model_catalog_json,path.join(a.p.core,'models.json').replaceAll('\\','/'));assert.ok(fs.existsSync(config.model_catalog_json));
});
test('Windows user-facing configure command repairs first-start defaults through the installed CLI',{skip:process.platform!=='win32'},()=>{
 const original='model = "gpt-6.1-sol"\n[desktop]\nsansFontSize = 14\n',a=fixture(),core=path.join(a.p.root,'codex-own-independent','core');
 fs.mkdirSync(core,{recursive:true});fs.writeFileSync(path.join(core,'config.toml'),original,{flag:'wx',mode:0o600});
 const cli=process.env.OWN_MODEL_CONFIG_CLI||path.resolve(import.meta.dirname,'../bin/codex-own.mjs');
 const run=()=>JSON.parse(execFileSync(process.execPath,[cli,'configure','--api-key-file',a.keyFile,'--yes'],{encoding:'utf8',timeout:60000,windowsHide:true,env:{...process.env,LOCALAPPDATA:a.p.root}}));
 const result=run(),config=parse(fs.readFileSync(path.join(core,'config.toml'),'utf8'));
 assert.equal(result.ok,true);assert.equal(config.model,'deepseek-v4.1-flash');assert.equal(config.model_provider,'dashscope_deepseek');assert.equal(config.desktop.sansFontSize,14);assert.equal(fs.readFileSync(result.configBackup,'utf8'),original);assert.equal(config.model_catalog_json,path.join(core,'models.json').replaceAll('\\','/'));assert.equal(run().configPreserved,true);
});
