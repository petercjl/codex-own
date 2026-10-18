import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {once,EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require=createRequire(import.meta.url);
const a=require(process.env.OWN_API_COMPAT_MODULE||'../lib/api-input-compat.cjs');
const msg=(name='create_thread')=>({id:1,method:'turn/start',params:{threadId:'test',input:[],toolOutput:{name,namespace:'codex_app',output:'<codex_delegation>\n<input>中文测试：17×23</input>\n</codex_delegation>'}}});
test('synthetic desktop messages become ordinary input without changing their text',()=>{
 for(const name of ['create_thread','send_message_to_thread','handoff_thread']){
  const before=msg(name),after=a.request(before,true);
  assert.equal(after.params.toolOutput,undefined);assert.equal(after.params.input[0].text,before.params.toolOutput.output);assert.equal(before.params.input.length,0);
  assert.equal(a.request(after,true),after);
 }
});
test('real tools, OpenAI sessions and unsupported frames remain unchanged',()=>{
 for(const m of [msg(),{...msg(),method:'thread/read'}]){
  assert.equal(a.request(m,false),m);
 }
 for(const [key,value] of [['namespace','other'],['name','exec_command'],['callId','real-call'],['call_id','real-call'],['output',[]]]){
  const m=msg();m.params.toolOutput[key]=value;assert.equal(a.request(m,true),m);
 }
 const m=msg();m.params.input='invalid';assert.equal(a.request(m,true),m);
 const r={method:'turn/start',params:{input:[{type:'text',text:'ordinary'}]}};assert.equal(a.request(r,true),r);
});
test('steering preserves attachments, message order and caller metadata',()=>{
 const m=msg('send_message_to_thread');m.method='turn/steer';m.params.input=[{type:'localImage',path:'C:\\图片.jpg'}];m.params.expectedTurnId='turn';
 const n=a.request(m,true);assert.deepEqual(n.params.input[0],m.params.input[0]);assert.equal(n.params.input[1].text,m.params.toolOutput.output);assert.equal(n.params.expectedTurnId,'turn');
});
test('only custom Responses API configuration enables compatibility',()=>{
 const c={forced_login_method:'api',model_provider:'third_party',model_providers:{third_party:{wire_api:'responses'}}};
 assert.equal(a.enabled(c),true);assert.equal(a.enabled({...c,forced_login_method:'chatgpt'}),false);assert.equal(a.enabled({...c,model_provider:'openai'}),false);assert.equal(a.enabled({}),false);
});
test('split UTF8, CRLF and unrelated malformed lines are preserved',async()=>{
 const raw=Buffer.from(JSON.stringify(msg())+'\n  {"method":"thread/read"} \r\nnot-json\n'),s=a.inputStream({active:()=>true}),out=[];
 s.on('data',b=>out.push(b));const done=once(s,'end');for(let i=0;i<raw.length;i+=3)s.write(raw.subarray(i,i+3));s.end();await done;
 const text=Buffer.concat(out).toString();assert.equal(JSON.parse(text.split('\n')[0]).params.input[0].text,msg().params.toolOutput.output);assert.ok(text.endsWith('  {"method":"thread/read"} \r\nnot-json\n'));
});
test('oversized and incomplete frames produce explicit errors',async()=>{
 for(const [data,max,code] of [['123456789',8,'API_INPUT_FRAME_TOO_LARGE'],['{}',100,'API_INPUT_INCOMPLETE_FRAME']]){
  const s=a.inputStream({maxFrameBytes:max}),error=once(s,'error');s.end(data);assert.equal((await error)[0].code,code);
 }
});
test('only owned stdio backends are intercepted',()=>{
 assert.equal(a.serverInvocation('/own/codex',['app-server'],'/own/codex'),true);
 for(const [file,args] of [['/other/codex',['app-server']],['/own/codex',['exec']],['/own/codex',['app-server','generate-json-schema']],['/own/codex',['app-server','--listen=ws://localhost:1']]])assert.equal(a.serverInvocation(file,args,'/own/codex'),false);
});
test('installed spawn hook converts desktop input once and retains ordinary frames',async t=>{
 const core=fs.mkdtempSync(path.join(os.tmpdir(),'own-api-input-'));
 t.after(()=>fs.rmSync(core,{recursive:true,force:true}));
 fs.writeFileSync(path.join(core,'config.toml'),'forced_login_method="api"\nmodel_provider="third_party"\n[model_providers.third_party]\nwire_api="responses"\n',{flag:'wx'});
 const cli=path.join(core,'codex'),api={spawn(){const child=new EventEmitter();child.stdin=new PassThrough();child.nativeInput=child.stdin;child.kill=()=>{};return child;}},original=api.spawn;
 a.install({cli,core,processApi:api});const hook=api.spawn;a.install({cli,core,processApi:api});assert.equal(api.spawn,hook);
 t.after(()=>api[a.HOOK]?.restore());
 const child=api.spawn(cli,['app-server']),chunks=[];child.nativeInput.on('data',b=>chunks.push(b));const done=once(child.nativeInput,'end');
 child.stdin.end(JSON.stringify(msg())+'\n'+JSON.stringify({method:'thread/read',params:{threadId:'test'}})+'\n');await done;
 const frames=Buffer.concat(chunks).toString().trim().split('\n').map(JSON.parse);
 assert.equal(frames[0].params.toolOutput,undefined);assert.equal(frames[0].params.input[0].text,msg().params.toolOutput.output);assert.equal(frames[1].method,'thread/read');
 const untouched=api.spawn(cli,['exec']);assert.equal(untouched.stdin,untouched.nativeInput);
 api[a.HOOK].restore();assert.equal(api.spawn,original);
});
test('invalid private configuration fails before starting a backend',t=>{
 const core=fs.mkdtempSync(path.join(os.tmpdir(),'own-api-invalid-'));t.after(()=>fs.rmSync(core,{recursive:true,force:true}));
 const file=path.join(core,'config.toml'),invalid='model_provider = [';fs.writeFileSync(file,invalid,{flag:'wx'});
 let started=0;const api={spawn(){started++;}},cli=path.join(core,'codex');a.install({cli,core,processApi:api});t.after(()=>api[a.HOOK]?.restore());
 assert.throws(()=>api.spawn(cli,['app-server']));assert.equal(started,0);assert.equal(fs.readFileSync(file,'utf8'),invalid);
});
