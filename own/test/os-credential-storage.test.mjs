import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';
import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),storage=require('../lib/os-credential-storage.cjs');
test('OS credential adapters put payloads on stdin and bind protection to the local profile',async()=>{
 const secret='测试模型 Key sk-fixture-only';let command;
 const mac=storage.forCore('/private/profile',{platform:'darwin',bundle:'/app',run:async(file,args,input)=>{command={file,args,input};return input;}});
 assert.equal((await mac.decryptStringAsync(Buffer.from(secret))).result,secret);assert.equal(command.file,path.join('/app','native','credential-store'));assert.equal(command.args[0],'decrypt');assert(!JSON.stringify(command.args).includes(secret));assert.match(command.args[1],/^codex-own\.credentials\.[a-f0-9]{64}$/);
 const windows=storage.forCore('/private/profile',{platform:'win32',bundle:'/app',run:async(file,args,input,options)=>{command={file,args,input,options};return Buffer.from(input,'base64').toString('base64');}});
 assert.equal((await windows.encryptStringAsync(secret)).toString(),secret);assert(command.args.includes('-NonInteractive'));assert(command.args.includes('-File'));assert(!JSON.stringify(command.args).includes(secret));assert.equal(Buffer.from(command.input,'base64').toString(),secret);
});

test('Windows credential protection works with the default script execution policy', {skip:process.platform!=='win32'}, async()=>{
 const core=path.join(os.tmpdir(),'codex-own-credential-test-'+crypto.randomUUID());
 const store=storage.forCore(core);
 assert.equal(await store.isAsyncEncryptionAvailable(),true);
 const plain='codex-own credential smoke '+crypto.randomUUID();
 const encrypted=await store.encryptStringAsync(plain);
 assert(Buffer.isBuffer(encrypted));assert(!encrypted.includes(Buffer.from(plain)));
 assert.equal((await store.decryptStringAsync(encrypted)).result,plain);
 await assert.rejects(storage.forCore(core+'-other').decryptStringAsync(encrypted),{code:'CREDENTIAL_STORAGE_UNAVAILABLE'});
});
