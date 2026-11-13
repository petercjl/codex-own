import test from 'node:test';import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {serviceOrigin,beginLogin,pollLogin,completeLogin,storedSession,loginStatus,logout} from '../lib/managed-login.mjs';
const cipherKey=randomBytes(32),protection={isEncryptionAvailable:()=>true,encryptString(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',cipherKey,iv);return Buffer.concat([iv,cipher.update(value),cipher.final(),cipher.getAuthTag()]);},decryptString(value){const cipher=createDecipheriv('aes-256-gcm',cipherKey,value.subarray(0,12));cipher.setAuthTag(value.subarray(-16));return Buffer.concat([cipher.update(value.subarray(12,-16)),cipher.final()]).toString();}};
const secret='cow_'+'a'.repeat(43),origin='https://company.example',id='b'.repeat(43);
function fixture(t){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'own-managed-login-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return{root,core:path.join(root,'core'),manager:path.join(root,'manager'),target:path.join(root,'app')};}
const response=data=>new Response(JSON.stringify({ok:true,data}));
test('service and consent URLs are pinned to the selected origin',async()=>{
 assert.equal(serviceOrigin(origin),origin);assert.throws(()=>serviceOrigin('http://company.example'));assert.equal(serviceOrigin('http://127.0.0.1:4317',{allowHttp:true}),'http://127.0.0.1:4317');
 for(const s of ['https://user:secret@company.example','https://company.example/other','https://company.example/?token=secret'])assert.throws(()=>serviceOrigin(s));
 const data={contract:1,requestId:id,verificationUrl:origin+'/api/codex-own/auth/authorize?request='+id,userCode:id.slice(0,8).toUpperCase(),expiresIn:600};
 const pending=await beginLogin(origin,{fetcher:async(_url,options)=>{assert.equal(options.redirect,'error');assert.match(JSON.parse(options.body).verifierHash,/^[a-f0-9]{64}$/);return response(data);}});assert.equal(pending.verifier.length,43);
 await assert.rejects(beginLogin(origin,{fetcher:async()=>response({...data,verificationUrl:'https://foreign.example/authorize?request='+id})}),{code:'SERVICE_INVALID'});
 assert.equal(await pollLogin(pending,{fetcher:async()=>response({status:'pending'})}),null);
 const grant=await pollLogin(pending,{fetcher:async()=>response({contract:1,token:secret,expiresAt:new Date(Date.now()+60000).toISOString(),member:{name:'同事'}})});assert.equal(grant.token,secret);
});
test('managed login imports three models, preserves prior settings, redacts receipts, and logs out without a network',async t=>{
 const p=fixture(t);fs.mkdirSync(p.core);fs.writeFileSync(path.join(p.core,'config.toml'),'[desktop]\nfontSize=16\n',{flag:'wx'});
 const grants={origin,token:secret,name:'同事',expiresAt:new Date(Date.now()+60000).toISOString()};
 const models={contract:2,transport:'direct',subject:'f'.repeat(64),configVersion:'e'.repeat(64),model:'claude/opus',provider:Object.fromEntries(['claude','gateway','dashscope'].map(id=>[id,{name:id,wire_api:id==='claude'?'anthropic':'responses',options:{baseURL:'https://'+id+'.model.example/v1',apiKey:'sk-real-'+id+'-fixture-secret'},models:{[id==='claude'?'opus':'deepseek']:{name:id}}}]))};
 const result=await completeLogin(grants,{p,protection,isRunning:()=>[],fetcher:async url=>response(url.endsWith('/bootstrap')?{contract:1,image:{enabled:false,reason:'KEY_BINDING_UNVERIFIED'}}:models)});
 assert.equal(result.models.length,3);assert(!JSON.stringify(result).includes(secret));assert.equal((await storedSession(p,{protection})).token,secret);
 assert(fs.readFileSync(path.join(p.core,'config.toml'),'utf8').includes('fontSize = 16'));
 assert(!fs.readFileSync(path.join(p.core,'managed-login.json'),'utf8').includes(secret));assert(!fs.readFileSync(path.join(p.core,'model-access.json'),'utf8').includes('sk-real-'));assert(!fs.readFileSync(path.join(p.core,'model-access.json'),'utf8').includes('/proxy/'));
 const status=await loginStatus(p,{protection,fetcher:async()=>response({authenticated:true})});assert.equal(status.authenticated,true);assert(!JSON.stringify(status).includes(secret));
 if(process.platform!=='win32')assert.equal(fs.statSync(path.join(p.core,'model-access.json')).mode&0o777,0o600);
 const out=await logout(p,{protection,fetcher:async()=>{throw Error('offline');}});assert.equal(out.remoteRevoked,false);assert.equal(await storedSession(p,{protection}),null);assert(!fs.readFileSync(path.join(p.core,'model-access.json'),'utf8').includes(secret));
});
test('a compromised model catalogue cannot redirect employee credentials and invalid imports preserve settings',async t=>{
 const p=fixture(t);fs.mkdirSync(p.core);const file=path.join(p.core,'auth.json');fs.writeFileSync(file,'prior',{flag:'wx'});
 await assert.rejects(completeLogin({origin,token:secret},{p,protection,isRunning:()=>[],fetcher:async()=>response({contract:1,model:'x/y',provider:{x:{options:{baseURL:'https://foreign.example'}}}})}),{code:'SERVICE_INVALID'});assert.equal(fs.readFileSync(file,'utf8'),'prior');
});
