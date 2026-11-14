import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import vm from 'node:vm';
import http from 'node:http';import {once} from 'node:events';import {createRequire} from 'node:module';
import {patchExecutionStatus,executionStatusChanges} from '../builders/execution-status.mjs';
import {executionUiFixture} from './fixtures/execution-status.mjs';
const require=createRequire(import.meta.url),{requestTrace,monitor,METHOD}=require('../lib/execution-timing.cjs'),bridge=require('../lib/subagent-bridge.cjs');
test('split UTF8 SSE is forwarded immediately and milestone metadata excludes content',async()=>{
 const events=[],trace=requestTrace({headers:{session_id:'thread-A'}},e=>events.push(e),()=>({turnId:'turn-A'}));
 const stream=trace.stream(),got=[];stream.on('data',c=>got.push(c));const ended=once(stream,'end');
 const input=Buffer.from('data: {"type":"response.reasoning_text.delta","delta":"机密内容"}\r\n\r\ndata: {"type":"response.output_text.delta","delta":"回答"}\n\n');
 for(let i=0;i<input.length;i+=2)stream.write(input.subarray(i,i+2));assert.equal(Buffer.concat(got).length,input.length);stream.end();await ended;trace.finish();
 assert.deepEqual(Buffer.concat(got),input);assert.deepEqual(events.map(e=>e.phase),['request_received','first_byte','reasoning','text_output','request_complete']);
 assert.equal(events.at(-1).threadId,'thread-A');assert.equal(events.at(-1).turnId,'turn-A');assert.ok(!JSON.stringify(events).includes('机密'));assert.ok(events.at(-1).marks.first_byte>=0);
});
test('delayed upstream headers and reasoning/text have separate timings without changing model settings',async t=>{
 let body;const frames=['data: {"type":"response.reasoning_text.delta","delta":"private"}\n\n','data: {"type":"response.output_text.delta","delta":"ok"}\n\n','data: {"type":"response.completed"}\n\n'];
 const upstream=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;body=JSON.parse(raw);setTimeout(()=>{res.writeHead(200,{'content-type':'text/event-stream'});res.write(frames[0]);setTimeout(()=>res.end(frames.slice(1).join('')),40);},40);});upstream.listen(0,'127.0.0.1');await once(upstream,'listening');t.after(()=>new Promise(r=>upstream.close(r)));
 const events=[],server=await bridge.startServer({upstream:'http://127.0.0.1:'+upstream.address().port,fetch,onTiming:e=>events.push(e),requestContext:()=>({turnId:'turn-A'})});t.after(()=>server.close());
 const input={model:'gpt-fixture',reasoning:{effort:'high'},input:[{role:'user',content:'secret-prompt'}]};
 const res=await fetch(server.url+'/responses',{method:'POST',headers:{session_id:'thread-A'},body:JSON.stringify(input)});assert.equal(await res.text(),frames.join(''));
 await new Promise(r=>setImmediate(r));assert.deepEqual(body,input);
 const last=events.at(-1);assert.equal(last.phase,'request_complete');assert.ok(last.marks.upstream_headers-last.marks.upstream_sent>=25);assert.ok(last.marks.text_output-last.marks.reasoning>=25);assert.ok(!JSON.stringify(events).includes('secret-prompt'));
 for(const phase of ['body_read','body_prepared','authorized','upstream_sent','upstream_headers','first_byte','reasoning','text_output'])assert.ok(events.some(e=>e.phase===phase),phase);
});
test('model failure and client cancellation are terminal with no payload logged',async t=>{
 const events=[],server=await bridge.startServer({upstream:'https://fixture.invalid',fetch:async()=>new Response('private failure',{status:429}),onTiming:e=>events.push(e)});t.after(()=>server.close());
 const r=await fetch(server.url+'/responses',{method:'POST',body:'{"model":"fixture"}'});assert.equal(r.status,429);assert.equal(await r.text(),'private failure');await new Promise(r=>setImmediate(r));assert.equal(events.at(-1).phase,'request_failed');assert.ok(!JSON.stringify(events).includes('private failure'));
 const cancel=[];const c=requestTrace({headers:{}},e=>cancel.push(e));c.finish('request_cancelled');c.finish();assert.equal(cancel.length,2);assert.equal(cancel.at(-1).phase,'request_cancelled');
});
test('per-thread states isolate concurrent requests, show tools, stop on completion and disconnect',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'own-timing-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const m=monitor(root);
 for(const threadId of ['A','B']){m.input({method:'turn/start',params:{threadId}});m.output({method:'turn/started',params:{threadId,turn:{id:'turn-'+threadId}}});}
 m.model({requestId:'req-A',threadId:'A',turnId:'turn-A',phase:'upstream_sent',elapsedMs:4,secret:'never log'});assert.equal(m.read('A').phase,'waiting_model');assert.equal(m.read('B').phase,'runtime');
 m.output({method:'item/started',params:{threadId:'A',item:{id:'tool-A',type:'commandExecution',command:'private command'}}});m.model({requestId:'req-A',threadId:'A',phase:'reasoning'});assert.equal(m.read('A').phase,'tool');
 m.output({method:'item/completed',params:{threadId:'A',item:{id:'tool-A',type:'commandExecution',durationMs:10}}});assert.equal(m.read('A').phase,'runtime');
 m.output({method:'turn/completed',params:{threadId:'A',turn:{status:'completed'}}});m.model({requestId:'req-A',threadId:'A',phase:'reasoning'});assert.equal(m.read('A').active,false);assert.equal(m.read('A').phase,'complete');
 m.disconnect();assert.equal(m.read('B').phase,'disconnected');
 const f=m.read('A').logFile,log=fs.readFileSync(f,'utf8');assert.ok(!log.includes('private command'));assert.ok(!log.includes('never log'));assert.equal(fs.statSync(f).mode&0o777,0o600);assert.equal(fs.statSync(path.dirname(f)).mode&0o777,0o700);
});
test('renderer patch is idempotent, retains original output, and shows real phase with elapsed time',()=>{
 const p=patchExecutionStatus(executionUiFixture);assert.equal(p.count,1);assert.equal(patchExecutionStatus(p.source).source,p.source);
 const tree=(type,props)=>({type,props}),now=Date.now();let state={active:true,phase:'waiting_model',startedAt:now-80000,phaseStartedAt:now-65000,tools:{}};
 const react={useState:value=>[value===null?state:now,()=>{}],useEffect:()=>{},isValidElement:v=>!!v?.props,cloneElement:(v,p,...children)=>({...v,props:{...v.props,...p,children}})},context=vm.createContext({Date,globalThis:{}});
 const module=p.source.replace('const __webpack_modules__=','globalThis.modules=');vm.runInContext(module,context);context.globalThis.modules.fixture({}, {},name=>name==='zd8w'?react:{jsx:tree,jsxs:tree});
 const frame=context.globalThis.fixtureTurn({conversationId:'A',busy:true});assert.equal(frame.props.children[1],'original-composer');const status=frame.props.children[0].type({threadId:'A'});assert.match(status.props.children[0].props.children,/等待模型首个响应.*65 秒.*80 秒/);
 state={...state,phase:'tool',tools:{a:{type:'commandExecution'}}};assert.match(frame.props.children[0].type({threadId:'A'}).props.children[0].props.children,/等待工具执行结果（命令）/);
 state={...state,active:false};assert.equal(frame.props.children[0].type({threadId:'A'}),null);
 assert.throws(()=>executionStatusChanges({listPackage:()=>[]},'fixture'),/entry missing/);
});

test('private correlation overrides preserve existing headers and are removed before upstream',async t=>{
 const configured=bridge.pinRequest({method:'thread/resume',params:{threadId:'thread-A',config:{model_providers:{dashscope_deepseek:{http_headers:{existing:'preserved'}}}}}},'http://localhost:1','dashscope_deepseek','trace-A');
 assert.equal(configured.params.config['model_providers.dashscope_deepseek.http_headers.x-codex-own-trace'],'trace-A');assert.deepEqual(configured.params.config.model_providers.dashscope_deepseek.http_headers,{existing:'preserved','x-codex-own-trace':'trace-A'});
 let header;const events=[],server=await bridge.startServer({upstream:'http://fixture.invalid',fetch:async(_u,o)=>{header=o.headers['x-codex-own-trace'];return new Response('data: {"type":"response.completed"}\n\n',{headers:{'content-type':'text/event-stream'}});},requestContext:(_id,h)=>h['x-codex-own-trace']==='trace-A'?{threadId:'thread-A',turnId:'turn-A'}:null,onTiming:e=>events.push(e)});t.after(()=>server.close());
 const r=await fetch(server.url+'/responses',{method:'POST',headers:{'x-codex-own-trace':'trace-A'},body:'{"model":"fixture"}'});await r.text();await new Promise(r=>setImmediate(r));assert.equal(header,undefined);assert.equal(events.at(-1).threadId,'thread-A');assert.equal(events.at(-1).turnId,'turn-A');
 const terminal=[],trace=requestTrace({headers:{}},e=>terminal.push(e)),stream=trace.stream();stream.resume();stream.end('data: {"type":"response.completed"}\n\n');await once(stream,'end');trace.finish('request_cancelled');assert.equal(terminal.at(-1).phase,'request_complete');
});

test('correlation follows returned start, resume and fork identities and retires failed requests',()=>{
 const c=require('../lib/execution-timing.cjs').correlations();let key=c.input({id:1,method:'thread/start',params:{}});c.output({id:1,result:{thread:{id:'parent'}}});c.output({method:'turn/started',params:{threadId:'parent',turn:{id:'turn-parent'}}});assert.deepEqual(c.resolve(null,{'x-codex-own-trace':key}),{threadId:'parent',turnId:'turn-parent'});
 const fork=c.input({id:2,method:'thread/fork',params:{threadId:'parent'}});c.output({id:2,result:{thread:{id:'fork'}}});c.output({method:'turn/started',params:{threadId:'fork',turn:{id:'turn-fork'}}});assert.deepEqual(c.resolve(null,{'x-codex-own-trace':fork}),{threadId:'fork',turnId:'turn-fork'});assert.equal(c.resolve(null,{'x-codex-own-trace':key}).threadId,'parent');
 const failed=c.input({id:3,method:'thread/resume',params:{threadId:'parent'}});c.output({id:3,error:{code:-1}});assert.equal(c.resolve(null,{'x-codex-own-trace':failed}).threadId,null);c.output({method:'turn/completed',params:{threadId:'fork'}});assert.equal(c.resolve(null,{'x-codex-own-trace':fork}).turnId,undefined);
});
