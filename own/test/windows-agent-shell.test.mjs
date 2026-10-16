import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {once,EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const require=createRequire(import.meta.url);
const adapter=require(process.env.OWN_AGENT_SHELL_MODULE||'../lib/windows-agent-shell.cjs');
const selection={supported:true,preferred:'gitBash',bash:'C:\\Program Files\\Git\\bin\\bash.exe',powershell:'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',fallbackReason:null};
test('discovers working Git Bash from a custom Git PATH and retains PowerShell',()=>{
 const bash='D:\\工具 Git\\bin\\bash.exe',ps='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',files=new Set([bash,ps,'D:\\工具 Git\\cmd\\git.exe']);
 const result=adapter.discover({platform:'win32',env:{Path:'"D:\\工具 Git\\cmd"',SystemRoot:'C:\\Windows'},exists:f=>files.has(f),probe:f=>{assert.equal(f,bash);return 'GNU bash, version 5.3.15\r\n';}});
 assert.equal(result.bash,bash);assert.equal(result.powershell,ps);assert.equal(result.preferred,'gitBash');assert.equal(result.fallbackReason,null);
});
test('missing and broken Git Bash report a PowerShell fallback; Mac is unchanged',()=>{
 const ps=selection.powershell;
 const missing=adapter.discover({platform:'win32',env:{SystemRoot:'C:\\Windows'},exists:f=>f===ps});
 assert.equal(missing.preferred,'powershell');assert.equal(missing.fallbackReason,'GIT_BASH_NOT_FOUND');
 const broken=adapter.discover({platform:'win32',env:{ProgramFiles:'C:\\Program Files'},exists:f=>f===ps||f===selection.bash,probe:()=>{throw Error('Cannot execute');}});
 assert.equal(broken.preferred,'powershell');assert.equal(broken.fallbackReason,'GIT_BASH_UNUSABLE');assert.equal(broken.bash,null);
 const mac=adapter.discover({platform:'darwin',probe:()=>assert.fail('Mac must not probe Windows shells')});assert.equal(mac.supported,false);assert.equal(adapter.request({method:'thread/start',params:{}},mac).params.developerInstructions,undefined);
});
test('session start/resume/fork retain caller instructions and replace only the managed policy',()=>{
 for(const method of ['thread/start','thread/resume','thread/fork']){
  const original={id:4,method,params:{developerInstructions:'Keep project instructions.',cwd:'C:\\project',config:{model:'deepseek-v4.1-flash'}}};
  const changed=adapter.request(original,selection);assert.equal(original.params.developerInstructions,'Keep project instructions.');assert.ok(changed.params.developerInstructions.startsWith('Keep project instructions.'));assert.deepEqual(changed.params.config,original.params.config);
  const repeated=adapter.request(changed,{...selection,bash:'D:\\Git\\bin\\bash.exe'});assert.equal((repeated.params.developerInstructions.match(/<codex-own-windows-shell-policy version=/g)||[]).length,1);assert.ok(repeated.params.developerInstructions.includes('D:\\\\Git'));assert.ok(!repeated.params.developerInstructions.includes('C:\\\\Program Files'));
 }
 const baseline=adapter.request({method:'thread/start',params:{developerInstructions:null}},selection,'Existing global developer instructions.');assert.ok(baseline.params.developerInstructions.startsWith('Existing global developer instructions.'));
 const formatted='\n    Keep this indentation.\n',composed=adapter.compose(formatted,selection);assert.ok(composed.startsWith(formatted));assert.equal(adapter.compose(composed,selection),composed);
 const other={method:'turn/start',params:{input:[{text:'Use PowerShell explicitly.'}]}};assert.equal(adapter.request(other,selection),other);
});
test('protocol adapter preserves split UTF-8, multiple frames and unrelated bytes',async()=>{
 const session={id:1,method:'thread/start',params:{developerInstructions:'保留中文',cwd:'C:\\中文路径'}},other=' {"id":2,"method":"turn/start","params":{"shell":"powershell","cmd":"Get-Date"}} \r\n',invalid='not-json\n';
 const bytes=Buffer.from(JSON.stringify(session)+'\n'+other+invalid),stream=adapter.inputStream(selection),chunks=[];stream.on('data',b=>chunks.push(b));const done=once(stream,'end');
 for(let i=0;i<bytes.length;i+=7)stream.write(bytes.subarray(i,i+7));stream.end();await done;
 const output=Buffer.concat(chunks).toString('utf8'),first=JSON.parse(output.split('\n')[0]);assert.ok(first.params.developerInstructions.includes('保留中文'));assert.equal(first.params.cwd,session.params.cwd);assert.ok(output.endsWith(other+invalid));
});
test('oversized requests fail explicitly instead of silently losing policy',async()=>{
 const stream=adapter.inputStream(selection,{maxFrameBytes:8}),error=once(stream,'error');stream.end(Buffer.from('123456789'));assert.equal((await error)[0].code,'SHELL_POLICY_FRAME_TOO_LARGE');
});
test('invalid private config is preserved and caller overrides retain their original precedence',t=>{
 const core=fs.mkdtempSync(path.join(os.tmpdir(),'own-shell-invalid-'));t.after(()=>fs.rmSync(core,{recursive:true,force:true}));const file=path.join(core,'config.toml'),text='developer_instructions = [invalid';assert.equal(fs.existsSync(file),false);fs.writeFileSync(file,text,{flag:'wx'});
 assert.throws(()=>adapter.readInstructions(core),{code:'CONFIG_INVALID'});assert.equal(fs.readFileSync(file,'utf8'),text);
 const request=adapter.request({method:'thread/start',params:{developerInstructions:'caller',config:{developer_instructions:'config override'}}},selection,'global');assert.ok(request.params.developerInstructions.startsWith('caller\n'));assert.equal(request.params.config.developer_instructions,'config override');
});
test('spawn hook attaches only to the owned stdio app-server and is idempotent',async()=>{
 const children=[],api={spawn(){const child=new EventEmitter();child.stdin=new PassThrough();child.nativeInput=child.stdin;child.kill=()=>{};children.push(child);return child;}},original=api.spawn,cli='/fixture/codex.exe';
 adapter.install({platform:'win32',cli,core:'/missing-fixture',processApi:api,selection});const hooked=api.spawn;adapter.install({platform:'win32',cli,core:'/missing-fixture',processApi:api,selection});assert.equal(api.spawn,hooked);
 const child=api.spawn(cli,['app-server','--stdio']),target=children[0].nativeInput;
 const output=[];target.on('data',b=>output.push(b));const done=once(target,'end');child.stdin.end(JSON.stringify({id:1,method:'thread/start',params:{}})+'\n');await done;
 assert.ok(JSON.parse(Buffer.concat(output).toString()).params.developerInstructions.includes('Git Bash'));
 for(const args of [['--version'],['app-server','generate-json-schema'],['app-server','--listen','ws://127.0.0.1:1'],['app-server','--listen=ws://127.0.0.1:1']])assert.equal(adapter.serverInvocation(cli,args,cli),false);
 assert.equal(adapter.serverInvocation('/other/codex.exe',['app-server'],cli),false);api[adapter.HOOK].restore();assert.equal(api.spawn,original);
});
