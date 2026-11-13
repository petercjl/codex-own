import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
const require=createRequire(import.meta.url),vault=require('../lib/direct-credentials.cjs');
test('protected credentials stay encrypted and bind runtime bootstrap to the selected account',async t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'own-vault-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const key=randomBytes(32),protection={isEncryptionAvailable:()=>true,encryptString(value){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv),data=Buffer.concat([c.update(value),c.final()]);return Buffer.concat([iv,data,c.getAuthTag()]);},decryptString(value){const c=createDecipheriv('aes-256-gcm',key,value.subarray(0,12));c.setAuthTag(value.subarray(-16));return Buffer.concat([c.update(value.subarray(12,-16)),c.final()]).toString();}};
 const value={schema:1,access:{secret:'sk-actual-fixture'},session:{origin:'https://company.example',subject:'employee'}};
 const credentialFile=await vault.save(root,value,{protection});assert(!fs.readFileSync(path.join(root,credentialFile)).includes(Buffer.from(value.access.secret)));assert.deepEqual(await vault.load(root,credentialFile,{protection}),value);
 const asyncOnly={isAsyncEncryptionAvailable:async()=>true,encryptStringAsync:async value=>protection.encryptString(value),decryptStringAsync:async bytes=>({result:protection.decryptString(bytes),shouldReEncrypt:false})};
 const asynchronous=await vault.save(root,value,{protection:asyncOnly});assert.deepEqual(await vault.load(root,asynchronous,{protection:asyncOnly}),value);
 fs.writeFileSync(path.join(root,'managed-login.json'),JSON.stringify({contract:2,active:true,origin:value.session.origin,subject:'employee',credentialFile}),{flag:'wx'});
 assert.equal((await vault.bootstrap(root,{protection})).session.credentialFile,credentialFile);
 await assert.rejects(vault.save(root,value,{protection:{isEncryptionAvailable:()=>false}}),{code:'CREDENTIAL_STORAGE_UNAVAILABLE'});
 await assert.rejects(vault.load(root,'../../escape',{protection}),{code:'CREDENTIAL_PATH_INVALID'});
 fs.writeFileSync(path.join(root,'managed-login.json'),JSON.stringify({contract:2,active:false}));await assert.rejects(vault.bootstrap(root,{protection}),{code:'AUTH_REQUIRED'});
});
