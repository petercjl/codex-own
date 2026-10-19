import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),compat=require('../lib/tool-history-compat.cjs'),bridge=require('../lib/subagent-bridge.cjs');
const call=(id,type='function_call')=>({type,call_id:id,name:type==='custom_tool_call'?'apply_patch':'exec_command',arguments:'{"cmd":"printf 中文"}',input:'*** Begin Patch\n*** End Patch'});
const result=(id,type='function_call_output')=>({type,call_id:id,output:'中文结果\\n\n'});
test('parallel history pairs exact IDs without changing source or tool bytes',()=>{
 const a=call('a'),b=call('b'),oa=result('a'),ob=result('b'),source={model:'deepseek-test',input:[a,b,ob,oa]},before=JSON.stringify(source),next=compat.history(source);
 assert.deepEqual(next.input,[a,oa,b,ob]);assert.equal(JSON.stringify(source),before);assert.equal(next.input[1],oa);assert.equal(compat.history(next),next);
});
test('multiple rounds, mixed native tools and image result arrays retain every item',()=>{
 const a=call('a'),b=call('b','custom_tool_call'),oa={...result('a'),output:[{type:'input_image',image_url:'data:image/png;base64,fixture'}]},ob=result('b','custom_tool_call_output');
 const reasoning={type:'reasoning',encrypted_content:'opaque'},user={type:'message',role:'user',content:'continue'},source={input:[reasoning,a,b,oa,ob,user,call('c'),result('c')]};
 const next=compat.history(source);assert.deepEqual(next.input,[reasoning,a,oa,b,ob,user,source.input[6],source.input[7]]);assert.equal(next.input[2].output,oa.output);
});
test('missing, duplicate, orphan and mismatched results are never fabricated or discarded',()=>{
 for(const input of [[call('a'),call('b'),result('a')],[call('a'),call('a'),result('a'),result('a')],[call('a'),call('b'),result('a'),result('a')],[call('a'),call('b'),result('a'),result('other')],[call('a'),call('b'),result('a'),result('b','custom_tool_call_output')]]){
  const source={input};assert.equal(compat.history(source),source);
 }
 const user={type:'message',role:'user',content:'interrupted'};const source={input:[call('a'),call('b'),user,result('a'),result('b')]};assert.equal(compat.history(source),source);
});
test('serial, single and empty histories are unchanged',()=>{
 for(const input of [[],[call('a'),result('a')],[call('a'),result('a'),call('b'),result('b')]]){const source={input};assert.equal(compat.history(source),source);}
});
test('DeepSeek bridge applies pairing and preserves unrelated provider requests',()=>{
 const source={model:'deepseek-v4.1-flash-1017',input:[call('a'),call('b'),result('a'),result('b')]};
 assert.deepEqual(bridge.normalizeBody(source).input,[source.input[0],source.input[2],source.input[1],source.input[3]]);
 const other={...source,model:'gpt-test'};assert.equal(bridge.normalizeBody(other),other);
});
