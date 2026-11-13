import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import {spawn} from 'node:child_process';import {once} from 'node:events';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),router=require('../lib/model-router.cjs');
test('legacy and signed-out profiles retain a startup backend while model traffic remains blocked',async t=>{
 const core=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'own-direct-startup-')));t.after(()=>fs.rmSync(core,{recursive:true,force:true}));
 const token='fixture-local-auth-'.repeat(3),config={model_providers:{codex_own_imported:{experimental_bearer_token:token}}};
 fs.writeFileSync(path.join(core,'model-access.json'),JSON.stringify({schema:1,model:'fixture/test',providers:{fixture:{baseURL:'https://model.example/v1',apiKey:'sk-codex-own-protected-local-only',protocol:'responses',models:{test:{context:128000,maxOutput:1000,modalities:['text']}}}}}),{flag:'wx'});
 for(const metadata of [{contract:1,active:true},{contract:2,active:false},{contract:2,active:true,credentialFile:'direct-credentials-unavailable.bin'}]){
  const file=path.join(core,'managed-login.json');if(fs.existsSync(file))fs.unlinkSync(file);fs.writeFileSync(file,JSON.stringify(metadata),{flag:'wx'});
  let calls=0;const server=await router.start({core,config,fetch:async()=>{calls++;return new Response('{}');}});
  try{const response=await fetch(server.url+'/responses',{method:'POST',headers:{authorization:'Bearer '+token},body:'{"model":"fixture/test","input":[]}'});assert.equal(response.status,401);await response.text();assert.equal(calls,0);}finally{await server.close();}
 }
});
test('separate runtime receives secrets only over its private pipe, authenticates and calls the direct endpoint',{skip:process.platform==='win32'},async t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'own-direct-runtime-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let authCalls=0,modelCalls=0;
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/api/codex-own/session'){authCalls++;assert.equal(req.headers.authorization,'Bearer cow-private-fixture');res.end(JSON.stringify({ok:true,data:{authenticated:true,subject:'employee',authorization:{validForSeconds:300,refreshAfterSeconds:120}}}));return;}
  assert.equal(req.url,'/model/v1/responses');modelCalls++;assert.equal(req.headers.authorization,'Bearer sk-provider-fixture');let body='';for await(const c of req)body+=c;assert.equal(JSON.parse(body).model,'test');res.setHeader('content-type','application/json');res.end('{"ok":true}');
 });server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
 const origin='http://127.0.0.1:'+server.address().port,token='local-auth-'.repeat(4);
 fs.writeFileSync(path.join(root,'config.toml'),`model="fixture/test"\nmodel_provider="codex_own_imported"\nforced_login_method="api"\n[model_providers.codex_own_imported]\nwire_api="responses"\nexperimental_bearer_token=${JSON.stringify(token)}\n`,{flag:'wx'});
 const session={origin,allowHttp:true,token:'cow-private-fixture',subject:'employee',credentialFile:'direct-credentials-fixture.bin',expiresAt:new Date(Date.now()+60000).toISOString()};
 fs.writeFileSync(path.join(root,'managed-login.json'),JSON.stringify({contract:2,active:true,...session}),{flag:'wx'});
 const cli=path.join(root,'fake-cli.cjs');fs.writeFileSync(cli,`#!/usr/bin/env node
const assert=require('node:assert/strict');assert.equal(process.env.OWN_MANAGED_BOOTSTRAP_FD,undefined);
const flag=process.argv.find(a=>a.startsWith('model_providers.codex_own_imported.base_url='));
fetch(JSON.parse(flag.slice(flag.indexOf('=')+1))+'/responses',{method:'POST',headers:{authorization:'Bearer '+${JSON.stringify(token)}},body:JSON.stringify({model:'fixture/test',input:[]})}).then(async r=>{assert.equal(r.status,200);assert.equal((await r.json()).ok,true);console.log('DIRECT_RUNTIME_OK');}).catch(()=>{process.exitCode=1;});
`,{flag:'wx',mode:0o755});
 const packet={schema:1,session,access:{schema:1,model:'fixture/test',providers:{fixture:{baseURL:origin+'/model/v1',apiKey:'sk-provider-fixture',protocol:'responses',models:{test:{}}}}}};
 const child=spawn(process.execPath,[path.resolve(import.meta.dirname,'../lib/subagent-bridge-runner.cjs'),root,cli,'app-server'],{env:{...process.env,OWN_MANAGED_BOOTSTRAP_FD:'3'},stdio:['pipe','pipe','pipe','pipe']});
 t.after(()=>child.kill());let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);child.stdio[3].end(JSON.stringify(packet));
 const timer=setTimeout(()=>child.kill(),10000);t.after(()=>clearTimeout(timer));const [code]=await once(child,'exit');assert.equal(code,0,err);assert.match(out,/DIRECT_RUNTIME_OK/);assert.equal(authCalls,1);assert.equal(modelCalls,1);
});
