import path from 'node:path';
import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),storage=require('../lib/os-credential-storage.cjs');
test('OS credential adapters put payloads on stdin and bind protection to the local profile',async()=>{
 const secret='测试模型 Key sk-fixture-only';let command;
 const mac=storage.forCore('/private/profile',{platform:'darwin',bundle:'/app',run:async(file,args,input)=>{command={file,args,input};return input;}});
 assert.equal((await mac.decryptStringAsync(Buffer.from(secret))).result,secret);assert.equal(command.file,path.join('/app','native','credential-store'));assert.equal(command.args[0],'decrypt');assert(!JSON.stringify(command.args).includes(secret));assert.match(command.args[1],/^codex-own\.credentials\.[a-f0-9]{64}$/);
 const windows=storage.forCore('/private/profile',{platform:'win32',bundle:'/app',run:async(file,args,input,options)=>{command={file,args,input,options};return Buffer.from(input,'base64').toString('base64');}});
 assert.equal((await windows.encryptStringAsync(secret)).toString(),secret);assert(command.args.includes('-NonInteractive'));assert(command.args.includes('-File'));assert(!JSON.stringify(command.args).includes(secret));assert.equal(Buffer.from(command.input,'base64').toString(),secret);
});
