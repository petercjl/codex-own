import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {once} from 'node:events';
const p=createRequire(import.meta.url)('../lib/patch-compat.cjs');
const patch='*** Begin Patch\n*** Add File: 中文.txt\n+路径 C:\\temp\\new；字面量 \\n；"引号"\n*** End Patch';
test('raw and nested JSON transport envelopes preserve patch bytes exactly',()=>{
 assert.equal(p.patchInput(patch),patch);
 for(const key of ['data','input','patch']){
  assert.equal(p.patchInput(JSON.stringify({[key]:patch})),patch);
  assert.equal(p.patchInput(JSON.stringify({data:JSON.stringify({[key]:patch})})),patch);
 }
 for(const value of ['{"data":"not a patch"}',JSON.stringify({data:patch,other:'ambiguous'}),JSON.stringify({data:42}),'*** Begin Patch\n+incomplete','{"data":','["patch"]'])assert.equal(p.patchInput(value),value);
});
test('only apply_patch custom calls change; other tool arguments and outputs retain identity',()=>{
 const shell={type:'function_call',name:'exec_command',arguments:'{"cmd":"literal"}'},custom={type:'custom_tool_call',name:'another',input:JSON.stringify({data:patch})},output={type:'custom_tool_call_output',output:'private output'},call={type:'custom_tool_call',name:'apply_patch',call_id:'call-1',input:JSON.stringify({data:patch})};
 const source={input:[shell,custom,output,call]},next=p.history(source);
 assert.equal(next.input[0],shell);assert.equal(next.input[1],custom);assert.equal(next.input[2],output);assert.equal(next.input[3].input,patch);assert.equal(next.input[3].call_id,call.call_id);assert.notEqual(next,source);assert.equal(source.input[3].input,call.input);
});
test('fragmented UTF8 SSE produces consistent delta, done and completed patch input',async()=>{
 const wrapped=JSON.stringify({data:JSON.stringify({data:patch})}),call={type:'custom_tool_call',id:'ct-1',call_id:'call-1',name:'apply_patch',input:wrapped};
 const events=[{type:'response.output_item.added',output_index:0,item:{...call,input:''}},...Array.from(wrapped).map(delta=>({type:'response.custom_tool_call_input.delta',item_id:'ct-1',output_index:0,delta})),{type:'response.custom_tool_call_input.done',item_id:'ct-1',output_index:0,input:wrapped},{type:'response.output_item.done',output_index:0,item:call},{type:'response.completed',response:{output:[call]}}];
 const bytes=Buffer.from(events.map(e=>'event: '+e.type+'\r\ndata: '+JSON.stringify(e)+'\r\n\r\n').join('')),stream=p.eventStream(),chunks=[];stream.on('data',c=>chunks.push(c));const done=once(stream,'end');
 for(let i=0;i<bytes.length;i+=7)stream.write(bytes.subarray(i,i+7));stream.end();await done;
 const values=Buffer.concat(chunks).toString().split('\n\n').filter(Boolean).map(s=>JSON.parse(s.split('\n').find(l=>l.startsWith('data:')).slice(6)));
 assert.equal(values.filter(e=>e.type==='response.custom_tool_call_input.delta').map(e=>e.delta).join(''),patch);
 assert.equal(values.find(e=>e.type==='response.custom_tool_call_input.done').input,patch);assert.equal(values.find(e=>e.type==='response.output_item.done').item.input,patch);assert.equal(values.at(-1).response.output[0].input,patch);
});
