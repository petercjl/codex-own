import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
import {copyRuntimeDependencies} from '../builders/updater.mjs';
import {treeIdentity,bundleTuda,verifyTudaContract} from '../builders/tuda-plugin.mjs';
import {spawn} from 'node:child_process';import {createInterface} from 'node:readline';import {once} from 'node:events';
import http from 'node:http';import {EventEmitter} from 'node:events';
const require=createRequire(import.meta.url),{registration,argumentsFor,TOOLS}=require('../lib/tuda-plugin.cjs');
const host=require('../desktop/tuda-host.cjs');
const fixture=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'own-tuda-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;};
test('native MCP registration is transient, private Node backed and board-only',t=>{
 const bundle=fixture(t),core=path.join(bundle,'core');const original=['app-server'];assert.equal(argumentsFor(original,bundle,core),original);
 for(const name of ['desktop/tuda-mcp.mjs','node_modules/@petercjl/tuda/dist/board-plugin.js']){const p=path.join(bundle,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,'fixture',{flag:'wx'});}
 fs.writeFileSync(path.join(bundle,'tuda-plugin.json'),JSON.stringify({contract:2,connection:'independent-existing',package:'@petercjl/tuda',version:'0.1.0',profile:'board-only',contracts:{nativeContract:1,preparationContract:1,handoffContract:1,updateContract:1}}),{flag:'wx'});
 fs.writeFileSync(path.join(bundle,'node_modules/@petercjl/tuda/package.json'),JSON.stringify({name:'@petercjl/tuda',version:'0.1.0'}),{flag:'wx'});
 const config=registration(bundle,core);assert.equal(config.command,path.join(bundle,process.platform==='win32'?'node.exe':'node'));assert.equal(config.args[1],core);
 assert(TOOLS.includes('import_board_images'));assert(TOOLS.includes('write_board_text'));assert(!TOOLS.some(n=>/generat|model|agent|execute|call/.test(n)));
 const args=argumentsFor(original,bundle,core);assert.equal(args[0],'app-server');assert(args.some(a=>a.includes('mcp_servers.codex_own_tuda.enabled_tools=')));assert(!fs.existsSync(path.join(core,'config.toml')));
 const packageFile=path.join(bundle,'node_modules/@petercjl/tuda/package.json');fs.writeFileSync(packageFile,JSON.stringify({name:'@petercjl/tuda',version:'0.2.0'}));assert.throws(()=>registration(bundle,core),/version mismatch/);fs.writeFileSync(packageFile,JSON.stringify({name:'@petercjl/tuda',version:'0.1.0'}));
 fs.unlinkSync(path.join(bundle,'node_modules/@petercjl/tuda/dist/board-plugin.js'));assert.throws(()=>registration(bundle,core));
});
test('plugin inputs are mandatory and tree hashes bind contents and links',t=>{
 const root=fixture(t);assert.throws(()=>bundleTuda(root,{packageRoot:'',desktopRoot:''}),/Tuda plugin requires/);
 const source=path.join(root,'source');fs.mkdirSync(source);fs.writeFileSync(path.join(source,'file'),'one',{flag:'wx'});
 const first=treeIdentity(source);assert.equal(first.files,1);fs.appendFileSync(path.join(source,'file'),'two');assert.notEqual(treeIdentity(source).sha256,first.sha256);
 fs.symlinkSync('../outside',path.join(source,'bad-link'));assert.throws(()=>treeIdentity(source),/external link/);
});
test('packaging requires declared prepare and instance-bound memory-only handoff contracts',t=>{
 const root=fixture(t),native={contract:1,profile:'boards-only',transport:'stdio-mcp',entry:'dist/board-plugin.js',requiresSkill:false,requiresDesktop:true,generationTools:false,preparation:{contract:1,requiresAuth:false,readyField:'data.ready',instanceField:'data.instanceId',argv:['desktop','prepare'],resultSchema:{properties:{schemaVersion:{const:1},ok:{const:true},data:{properties:{ready:{const:true},protocolVersion:{const:1},instanceId:{pattern:'^[a-f0-9]{64}$'}}}}}},authHandoff:{contract:1,transport:'private-file',environment:'TUDA_AUTH_HANDOFF_FILE',targetAppId:'tuda',instanceField:'instanceId',sessionPersistence:'memory-only',required:['contract','origin','appId','code','verifier','expiresAt','instanceId']}};
 native.desktopCompatibility={contract:1,protocolVersion:1,minimumVersion:'0.1.0'};native.updates={contract:1,owner:'host',package:'@petercjl/tuda',channel:'next',mode:'automatic',intervalHours:24,timeoutMs:1500,activation:'next-connection',compatibility:'same-minor-for-0.x-same-major-for-1.x',failure:'keep-active'};
 const caps={schemaVersion:1,nativePlugin:native,commandContracts:{'desktop prepare':{sideEffects:'local-process-start',options:{'--app-path':{type:'string'},'--user-data-path':{type:'string'},'--json':{type:'boolean'},'--startup-timeout':{type:'number',unit:'seconds',minimum:1,maximum:180}}}}};
 for(const name of ['dist/main.js','dist/board-plugin.js','dist/board-plugin.LICENSES.txt','LICENSE','THIRD_PARTY_NOTICES.md']){const f=path.join(root,name);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,'fixture',{flag:'wx'});}
 const file=path.join(root,'capabilities.json'),save=()=>fs.writeFileSync(file,JSON.stringify(caps));save();assert.equal(verifyTudaContract(root).preparationContract,1);native.updates.channel='latest';save();assert.equal(verifyTudaContract(root).updateContract,1);native.updates.channel='other';save();assert.throws(()=>verifyTudaContract(root),/incompatible/);native.updates.channel='next';save();
 native.authHandoff.sessionPersistence='disk';save();assert.throws(()=>verifyTudaContract(root),/incompatible/);native.authHandoff.sessionPersistence='memory-only';
 native.authHandoff.required.push('unknownRequiredField');save();assert.throws(()=>verifyTudaContract(root),/incompatible/);native.authHandoff.required.pop();save();
 fs.unlinkSync(path.join(root,'dist/board-plugin.LICENSES.txt'));assert.throws(()=>verifyTudaContract(root));
});
test('real host stdio adapter keeps business calls usable during a pending update and stops on account change',{timeout:15000},async t=>{
 const root=fixture(t),bundle=path.join(root,'bundle'),core=path.join(root,'account/core');
 const write=(name,value)=>{const file=path.join(bundle,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value,{flag:'wx'});};
 fs.mkdirSync(core,{recursive:true});
 write('desktop/tuda-mcp.mjs',fs.readFileSync(new URL('../desktop/tuda-mcp.mjs',import.meta.url)));
 write('defaults/company-auth.json',JSON.stringify({origin:'https://company.example'}));
 write('tuda-plugin.json',JSON.stringify({contract:2,connection:'independent-existing'}));
 write('lib/tuda-connection.mjs',`export function connectionOptions(root){return {userDataPath:root+'/tuda'};}export function verifyIndependentReady(v){if(v.data.instanceId.length!==64)throw Error('bad instance');return v.data.instanceId;}export const connectionError=()=> 'safe error';`);
 write('lib/manager.mjs','export function rejectLinks(){}');
 write('lib/tuda-plugin.cjs',"module.exports={TOOLS:['create_board']};");
 write('lib/tuda-package.mjs',`import fs from 'node:fs';import path from 'node:path';export async function selectTudaRuntime({bundle}){const p=path.join(bundle,'node_modules/@petercjl/tuda');return {packageRoot:p,managerEntry:path.join(p,'dist/main.js'),pluginEntry:path.join(p,'dist/board-plugin.js'),version:'0.1.0'};}export async function updateTudaRuntime(runtime,{signal}){fs.appendFileSync(path.join(path.dirname(runtime.packageRoot),'update-check-started'),'1');await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));}`);
 write('lib/managed-login.mjs',`import fs from 'node:fs';import path from 'node:path';export function storedSession({core}){const f=path.join(core,'session.json');return fs.existsSync(f)?JSON.parse(fs.readFileSync(f)):null;}export const serviceOrigin=v=>v;`);
 write('lib/network.mjs',`import fs from 'node:fs';import path from 'node:path';export async function networkFetch(url,options){if(!url.endsWith('/handoff/issue')||!options.headers.authorization.startsWith('Bearer cow_')||JSON.parse(options.body).targetAppId!=='tuda')throw Error('Bad request');if(!fs.existsSync(path.join(path.dirname(process.argv[2]),'tuda/instance')))throw Error('Desktop must be ready before grant');const f=path.join(process.argv[2],'issued'),count=fs.existsSync(f)?JSON.parse(fs.readFileSync(f)).count+1:1;fs.writeFileSync(f,JSON.stringify({...JSON.parse(options.body),count}));return {ok:true,json:async()=>({ok:true,data:{contract:1,sourceAppId:'codex-own',targetAppId:'tuda',code:'a'.repeat(43),expiresIn:60}})};}`);
 write('node_modules/@petercjl/tuda/dist/main.js',`const fs=require('node:fs'),path=require('node:path');if(!process.argv.includes('--no-launch')||process.argv.includes('--app-path'))process.exit(1);if(process.argv[2]!=='desktop'||process.argv[3]!=='prepare'||process.env.TUDA_STARTUP_TIMEOUT_MS!=='120000')process.exit(1);const root=process.env.TUDA_USER_DATA_PATH;fs.mkdirSync(root,{recursive:true});const file=path.join(root,'instance');if(!fs.existsSync(file))fs.writeFileSync(file,'a'.repeat(64),{flag:'wx'});process.stdout.write(JSON.stringify({schemaVersion:1,ok:true,data:{ready:true,instanceId:fs.readFileSync(file,'utf8'),protocolVersion:1}}));`);
 write('node_modules/@petercjl/tuda/dist/board-plugin.js',`const fs=require('node:fs'),readline=require('node:readline');readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);let result;if(m.method==='tools/list')result={tools:[{name:'create_board'}],fileExists:fs.existsSync(process.env.TUDA_AUTH_HANDOFF_FILE)};else{const f=process.env.TUDA_AUTH_HANDOFF_FILE,g=JSON.parse(fs.readFileSync(f));result={private:(fs.statSync(f).mode&0o077)===0,appId:g.appId,instanceId:g.instanceId,hasSourceToken:JSON.stringify(g).includes('cow_'),space:process.env.TUDA_PLUGIN_SPACE,embedded:!!process.env.TUDA_EMBEDDED_HOST,noLaunch:process.env.TUDA_NO_LAUNCH,foreignRemoved:!process.env.TUDA_UNTRUSTED,imageConfigRemoved:!process.env.TOAPISCLI_CONFIG_DIR,origin:g.origin};}process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});`);
 write('clock.mjs',`import fs from 'node:fs';const now=Date.now;Date.now=()=>now()+(fs.existsSync(${JSON.stringify(path.join(core,'clock'))})?Number(fs.readFileSync(${JSON.stringify(path.join(core,'clock'))},'utf8')):0);`);
 const child=spawn(process.execPath,['--import',path.join(bundle,'clock.mjs'),path.join(bundle,'desktop/tuda-mcp.mjs'),core],{env:{...process.env,TUDA_UNTRUSTED:'remove-me',TOAPISCLI_CONFIG_DIR:'/fixture/other-image-account'},stdio:['pipe','pipe','pipe']});t.after(()=>child.kill());
 const lines=createInterface({input:child.stdout})[Symbol.asyncIterator]();let id=0;
 const call=async (method,name='create_board')=>{child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:++id,method,params:{name}})+'\n');const next=await lines.next();assert(!next.done);return JSON.parse(next.value);};
 const discovery=await call('tools/list');assert.equal(discovery.result.fileExists,false);assert(!fs.existsSync(path.join(core,'issued')));
 const signedOut=await call('tools/call');assert.equal(signedOut.result.isError,true);assert(!fs.existsSync(path.join(core,'issued')));assert(!fs.existsSync(path.join(root,'account/tuda/instance')));
 const session=path.join(core,'session.json');fs.writeFileSync(session,JSON.stringify({origin:'https://company.example',token:'cow_'+'x'.repeat(43),expiresAt:new Date(Date.now()+600000).toISOString()}),{flag:'wx'});
 const business=await call('tools/call');assert.deepEqual(business.result,{private:process.platform!=='win32',appId:'tuda',instanceId:'a'.repeat(64),hasSourceToken:false,space:'enterprise',embedded:false,noLaunch:'1',foreignRemoved:true,imageConfigRemoved:true,origin:'https://company.example'});
 const issued=()=>JSON.parse(fs.readFileSync(path.join(core,'issued'))).count;assert.equal(issued(),1);await call('tools/call');assert.equal(issued(),1);fs.writeFileSync(path.join(core,'clock'),'360000',{flag:'wx'});await call('tools/call');assert.equal(issued(),2);fs.writeFileSync(path.join(core,'clock'),'0');
 const daemon=path.join(root,'account/tuda/instance');fs.writeFileSync(daemon,'b'.repeat(64));assert.equal((await call('tools/call')).result.instanceId,'b'.repeat(64));assert.equal(issued(),3);
 fs.writeFileSync(daemon,'bad-instance');assert.equal((await call('tools/call')).result.isError,true);assert.equal(issued(),3);fs.writeFileSync(daemon,'b'.repeat(64));
 assert.equal((await call('tools/call','generate_image')).result.isError,true);assert.equal(issued(),3);assert.equal(fs.readFileSync(path.join(bundle,'node_modules/@petercjl/update-check-started'),'utf8'),'1');
 fs.writeFileSync(session,JSON.stringify({origin:'https://company.example',token:'cow_'+'y'.repeat(43),expiresAt:new Date(Date.now()+600000).toISOString()}));assert.equal((await call('tools/call')).result.isError,true);assert.equal(issued(),3);
 fs.unlinkSync(session);assert.equal((await call('tools/call')).result.isError,true);
 const closed=once(child,'close');child.stdin.end();await closed;assert.equal(fs.readdirSync(path.join(root,'account/tmp')).length,0);
});
test('host exit leaves independent Tuda and its private legacy data alone',async t=>{
 const root=fixture(t);fs.mkdirSync(path.join(root,'tuda'));const file=path.join(root,'tuda/local-api.json');fs.writeFileSync(file,'legacy private data',{flag:'wx'});
 const app=new EventEmitter();let requests=0;host.install({app,dialog:{showErrorBox(){throw Error('unexpected');}}},root,{shutdown(){requests++;}});
 assert.equal(app.listenerCount('before-quit'),0);app.emit('before-quit',{preventDefault(){throw Error('host exit blocked');}});
 assert.deepEqual(await host.stop(root),{running:'independent',closed:false,reason:'TUDA_INDEPENDENT_LIFECYCLE'});assert.equal(requests,0);assert.equal(fs.readFileSync(file,'utf8'),'legacy private data');
});

test('real locked npm connector bundles without any desktop dependency',t=>{
 const root=fixture(t),result=bundleTuda(root,{copyDependencies:copyRuntimeDependencies});assert.equal(result.desktopBytes,0);
 const meta=JSON.parse(fs.readFileSync(path.join(root,'tuda-plugin.json')));assert.equal(meta.contract,2);assert.equal(meta.connection,'independent-existing');assert(!Object.hasOwn(meta,'desktop'));assert(!Object.hasOwn(meta.inputs,'desktop'));
 assert(!fs.existsSync(path.join(root,'tuda-desktop')));assert(fs.existsSync(path.join(root,'node_modules/@petercjl/tuda/dist/board-plugin.js')));
});
