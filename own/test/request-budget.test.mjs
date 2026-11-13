import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {once} from 'node:events';import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url),budget=require('../lib/request-budget.cjs'),bridge=require('../lib/subagent-bridge.cjs');
test('JSON memory guards follow machine capacity and parser limits',()=>{
 assert.equal(budget.maxRequestBytes({heapBytes:8e9,totalBytes:16e9,stringBytes:2e9}),1e9);
 assert.equal(budget.maxRequestBytes({heapBytes:8e9,totalBytes:16e9,stringBytes:1e8}),1e8);
 assert.ok(budget.maxRequestBytes()>64*1024*1024);
});
test('fragmented UTF8 frames retain bytes, adapt complete messages and enforce the selected memory guard',async()=>{
 const raw=Buffer.from('{"text":"中文"}\r\nnot-json\n'),stream=budget.frames(),out=[];stream.on('data',c=>out.push(c));const done=once(stream,'end');
 for(const byte of raw)stream.write(Buffer.from([byte]));stream.end();await done;assert.deepEqual(Buffer.concat(out),raw);
 const limited=budget.frames({maxFrameBytes:4});const failed=once(limited,'error');limited.end('12345');assert.equal((await failed)[0].code,'API_INPUT_FRAME_TOO_LARGE');
});
test('real HTTP transport forwards requests over both 16 MiB and 64 MiB without changing their content',async t=>{
 const text='transport-fixture-'.repeat(Math.ceil(65*1024*1024/18)),body=JSON.stringify({model:'gpt-fixture',input:[{role:'user',content:[{type:'input_text',text}]}]});
 const digest=value=>createHash('sha256').update(value).digest('hex');let bytes=0;
 const server=await bridge.startServer({fetch:async(_url,options)=>{bytes=options.body.length;assert.equal(digest(options.body),digest(body));return new Response('{}');}});t.after(()=>server.close());
 const response=await fetch(server.url+'/responses',{method:'POST',body});assert.equal(response.status,200);await response.text();assert.ok(bytes>64*1024*1024);
});
test('provider context errors retain runtime-recognizable semantics; authorization prevents network calls',async t=>{
 const server=await bridge.startServer({fetch:async()=>{throw Object.assign(Error('sensitive provider message'),{status:400,error:{error:{type:'invalid_request_error',message:'prompt is too long: 123 > 100'}}});}});t.after(()=>server.close());
 const response=await fetch(server.url+'/responses',{method:'POST',body:'{"model":"test","input":[]}'});assert.equal(response.status,400);assert.equal((await response.json()).error.code,'context_length_exceeded');
 let calls=0;const denied=await bridge.startServer({beforeRequest:()=>{throw Object.assign(Error('denied'),{code:'ACCESS_DENIED'});},fetch:async()=>{calls++;return new Response('{}');}});t.after(()=>denied.close());
 assert.equal((await fetch(denied.url+'/responses',{method:'POST',body:'{"input":[]}'})).status,403);assert.equal(calls,0);
});
