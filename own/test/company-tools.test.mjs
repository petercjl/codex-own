import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';
import {hashes,recoverCollectionDiscovery,verifyGraph,activateCollection,activatePending,maintainCompanyTools,companyToolsState,setCompanyToolsPolicy,reconcileSkillSources} from '../lib/company-tools.mjs';
import envContract from '../lib/company-tools-env.cjs';
import {spawnSync,spawn} from 'node:child_process';import readline from 'node:readline';import control from '../lib/desktop-control.cjs';
const PACKAGE='@petercjl/taobao-ai-ops';
const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});assert(!fs.existsSync(file));fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value),{flag:'wx',mode:0o600});};
function fixture(t){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'own-company-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
function generation(root,version='0.4.17',extra=false,id='generation-'+crypto.randomUUID()){
 const directory=path.join(root,'company-tools',id),skills=path.join(directory,'skills'),entry=path.join(directory,'shell/bin/taobao-ai-ops.mjs');
 write(entry,'console.log(JSON.stringify({version:'+JSON.stringify(version)+',state:process.env.TAOBAO_AI_OPS_STATE_DIR}))');
 const names=['taobao-ai-operations',...(extra?['new-skill']:[])];
 const records=names.map(name=>({name,package:PACKAGE,version,directory:path.join(skills,name),runtimeEntry:entry}));
 for(const s of records){write(path.join(s.directory,'SKILL.md'),'---\nname: '+s.name+'\ndescription: 公司工具测试\n---\n');write(path.join(s.directory,'.collection-runtime.json'),{...s,environment:{}});}
 const graph={ok:true,schemaVersion:1,package:PACKAGE,version,members:[],skillsDirectory:skills,skills:records,environment:{TAOBAO_AI_OPS_STATE_DIR:path.join(directory,'state')}};
 write(path.join(directory,'collection.json'),graph);write(path.join(directory,'integrity.json'),hashes(skills));return {id,directory,graph};
}
test('collection management state distinguishes the installed package and pending generation; policy is durable',async t=>{
 const root=fixture(t),old=generation(root);activateCollection(root,old.id);const next=generation(root,'0.4.18',true);write(path.join(root,'company-tools/pending.json'),{contract:1,generation:next.id});
 let state=companyToolsState(root);assert.equal(state.version,'0.4.17');assert.equal(state.pendingVersion,'0.4.18');assert.equal(state.skillCount,1);assert.equal(state.pendingSkillCount,2);assert(state.pendingUpdate);assert.equal(state.restartRequired,false);assert(state.autoUpdate);assert(!JSON.stringify(state).includes(root));
 await setCompanyToolsPolicy(root,false);assert.equal(companyToolsState(root).autoUpdate,false);await assert.rejects(setCompanyToolsPolicy(root,'false'),{code:'COLLECTION_POLICY'});await setCompanyToolsPolicy(root,true);assert(companyToolsState(root).autoUpdate);
 assert(fs.readdirSync(path.join(root,'company-tools')).some(n=>n.startsWith('policy.json.backup-')));
});
test('physical Skill discovery tree and runtime environment switch together; new member included',t=>{
 const root=fixture(t),old=generation(root);activateCollection(root,old.id);
 const target=path.join(root,'core/skills/company-tools');assert(!fs.lstatSync(target).isSymbolicLink());
 const next=generation(root,'0.4.18',true);write(path.join(root,'company-tools/pending.json'),{contract:1,generation:next.id});
 assert.equal(envContract.selection(root).version,'0.4.17');
 assert(fs.existsSync(path.join(target,'taobao-ai-operations/SKILL.md')));
 activateCollection(root,next.id);assert(fs.existsSync(path.join(target,'new-skill/SKILL.md')));
 const env=envContract.environment(root,{PATH:'system',TAOBAO_AI_OPS_STATE_DIR:'foreign'});
 assert.equal(env.TAOBAO_AI_OPS_STATE_DIR,path.join(next.directory,'state'));assert.equal(env.TAOBAO_AI_OPS_AUTO_UPDATE,'0');assert(fs.existsSync(path.join(old.directory,'collection.json')));
 assert(env.PATH.startsWith(path.join(root,'company-tools/bin')));
 assert.equal(env.NODE_USE_ENV_PROXY,'1','private Node adopts the host proxy for collection and member fetch calls');
 const body=envContract.apply({instructions:'Existing instructions'},path.join(root,'core'));
 assert(body.instructions.includes(JSON.stringify(path.join(root,'core/skills/company-tools'))));assert(body.instructions.includes('canonical source'));assert(body.instructions.includes('CODEX_OWN_NODE'));assert(body.instructions.startsWith('Existing instructions'));
 assert(envContract.environment(root,{PATH:'system'},'win32').PATH.includes(';system'));
});
test('the same inherited PATH resolves updated and newly added CLIs; removed commands do not fall back to an old generation',t=>{
 if(process.platform==='win32')return t.skip('Real POSIX shim execution; Windows cmd shims are checked in the package contract');
 const root=fixture(t),old=generation(root);activateCollection(root,old.id);
 const env=envContract.environment(root,{...process.env,CODEX_OWN_NODE:process.execPath}),command=()=>spawnSync('/bin/sh',['-c','taobao-ai-ops'],{env,encoding:'utf8'});
 assert.equal(JSON.parse(command().stdout).version,'0.4.17');const next=generation(root,'0.4.18',true),entry=path.join(next.directory,'runtime/extra.mjs');
 write(entry,'console.log("new-command")');next.graph.members=[{id:'extra',package:'@petercjl/extra',version:'1.0.0',bin:'extra-cli'}];
 const graphFile=path.join(next.directory,'collection.json');fs.copyFileSync(graphFile,graphFile+'.backup');fs.writeFileSync(graphFile,JSON.stringify(next.graph));write(path.join(next.directory,'state/components.json'),{components:{extra:{package:'@petercjl/extra',version:'1.0.0',entry}}});
 activateCollection(root,next.id);const result=JSON.parse(command().stdout);assert.equal(result.version,'0.4.18');assert.equal(result.state,path.join(next.directory,'state'));assert.equal(spawnSync('/bin/sh',['-c','extra-cli'],{env,encoding:'utf8'}).stdout.trim(),'new-command');
 const third=generation(root,'0.4.19');activateCollection(root,third.id);const removed=spawnSync('/bin/sh',['-c','extra-cli'],{env,encoding:'utf8'});assert.equal(removed.status,1);assert.match(removed.stderr,/COLLECTION_COMMAND_REMOVED/);assert(fs.existsSync(entry));
});
test('an already downloaded update activates online without a registry request and preserves the old immutable runtime',async t=>{
 const root=fixture(t);runtime(root);const old=generation(root);activateCollection(root,old.id);const next=generation(root,'0.4.18',true),events=[];write(path.join(root,'company-tools/pending.json'),{contract:1,generation:next.id});
 const result=await maintainCompanyTools(root,{force:true,report:e=>events.push(e),fetcher:async()=>{throw Error('Must not redownload');}});
 assert.equal(result.status,'activated');assert.equal(result.activation,'online');assert.equal(companyToolsState(root).version,'0.4.18');assert.equal(companyToolsState(root).pendingUpdate,false);assert.equal(companyToolsState(root).skillCount,2);assert(fs.existsSync(path.join(old.directory,'shell/bin/taobao-ai-ops.mjs')));assert(events.some(e=>e.phase==='activating'));assert.equal(events.at(-1).completed,4);
});
test('local edits, unmanaged names and escaped entries retain original files',t=>{
 const root=fixture(t),old=generation(root);activateCollection(root,old.id);const next=generation(root,'0.4.18');
 const file=path.join(root,'core/skills/company-tools/taobao-ai-operations/notes.txt');write(file,'user edits');
 assert.throws(()=>activateCollection(root,next.id),{code:'COLLECTION_LOCAL_EDITS'});assert.equal(fs.readFileSync(file,'utf8'),'user edits');assert.equal(envContract.selection(root).generation,old.id);
 const outside=generation(root,'0.4.19');const graph={...outside.graph,skills:[{...outside.graph.skills[0],runtimeEntry:process.execPath}]};
 const receipt=path.join(outside.directory,'collection.json');fs.copyFileSync(receipt,receipt+'.backup');fs.writeFileSync(receipt,JSON.stringify(graph));assert.throws(()=>verifyGraph(outside.directory),{code:'COLLECTION_PATH'});
 const other=fixture(t),candidate=generation(other);write(path.join(other,'core/skills/company-tools/private.txt'),'existing');assert.throws(()=>activateCollection(other,candidate.id),{code:'UNMANAGED_COLLECTION_SKILLS'});
});
test('pending activation is repeatable and rejects malformed paths',async t=>{
 const root=fixture(t),g=generation(root);write(path.join(root,'company-tools/pending.json'),{contract:1,generation:g.id});assert.equal((await activatePending(root)).status,'activated');assert.equal((await activatePending(root)).status,'unchanged');
 write(path.join(root,'company-tools/pending.json'),{contract:1,generation:'../../outside'});await assert.rejects(activatePending(root),{code:'COLLECTION_PATH'});assert.equal(envContract.selection(root).generation,g.id);
});
function runtime(root){
 const version='node24.22.0-python3.12.15-r1',base=path.join(root,'runtimes'),directory=path.join(base,'versions',version),win=process.platform==='win32';
 for(const name of [win?'node/node.exe':'node/bin/node',win?'python/python.exe':'python/bin/python3',win?'node/node_modules/npm/bin/npm-cli.js':'node/lib/node_modules/npm/bin/npm-cli.js'])write(path.join(directory,name),'fixture');
 write(path.join(base,'active.json'),{schema:1,version,platform:process.platform+'-'+process.arch});
}
test('same shell checks all members; offline failure preserves active state and throttles retries',async t=>{
 const root=fixture(t);runtime(root);const g=generation(root);activateCollection(root,g.id);let calls=0,network=0;
 const fetcher=async()=>{network++;return {ok:true,json:async()=>({name:PACKAGE,version:'0.4.17'})};};
 const run=async(_node,args)=>{calls++;assert.deepEqual(args.slice(1,4),['collection','check','--json']);return {stdout:JSON.stringify({ok:true,changed:false,members:[]})};};
 assert.equal((await maintainCompanyTools(root,{run,fetcher,now:100})).status,'current');assert.equal(calls,1);
 assert.equal((await maintainCompanyTools(root,{run,fetcher,now:101})).status,'throttled');assert.equal(network,1);
 const before=fs.readFileSync(path.join(root,'company-tools/active.json'));
 const result=await maintainCompanyTools(root,{force:true,now:102,fetcher:async()=>{throw Error('offline');}});assert.equal(result.status,'failed');assert.deepEqual(fs.readFileSync(path.join(root,'company-tools/active.json')),before);
 assert.equal((await maintainCompanyTools(root,{fetcher,run,now:103})).status,'throttled');
});
test('manual version checks expose same-shell member updates without preparing or activating a generation',async t=>{
 const root=fixture(t);runtime(root);const old=generation(root);activateCollection(root,old.id);let calls=0;
 const shadow=path.join(root,'core/skills/personal-copy/SKILL.md');write(shadow,'---\nname: taobao-ai-operations\ndescription: old copy\n---\n');
 const result=await maintainCompanyTools(root,{checkOnly:true,force:true,fetcher:async()=>({ok:true,json:async()=>({name:PACKAGE,version:'0.4.17'})}),run:async(_node,args)=>{
  calls++;assert.equal(args[2],'check');return {stdout:JSON.stringify({ok:true,changed:true,members:[{id:'example',package:'@petercjl/example',version:'1.0.0',available:'2.0.0',blocked:true}]})};
 }});
 assert.equal(result.status,'available');assert.equal(calls,1);assert.equal(envContract.selection(root).generation,old.id);assert(!fs.existsSync(path.join(root,'company-tools/pending.json')));assert.equal(companyToolsState(root).phase,'available');assert.equal(companyToolsState(root).memberCount,0);
 assert(fs.existsSync(shadow));assert.equal((await reconcileSkillSources(root)).count,1);assert(!fs.existsSync(shadow));assert.equal((await reconcileSkillSources(root)).count,0);
});
test('one real App Server discovers a newly activated Skill through forceReload without restarting',async t=>{
 const cli=process.env.OWN_COMPANY_TOOLS_TEST_CLI;if(!cli)return t.skip('Set OWN_COMPANY_TOOLS_TEST_CLI for the native integration check');
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'own-live-company-'))),old=generation(root);activateCollection(root,old.id);
 write(path.join(root,'core/skills/personal-copy/SKILL.md'),'---\nname: taobao-ai-operations\ndescription: old manual installation\n---\n');
 const child=spawn(cli,['app-server'],{cwd:root,env:{...process.env,HOME:root,CODEX_HOME:path.join(root,'core')},stdio:['pipe','pipe','pipe']});let sequence=0;const requests=new Map();child.stderr.resume();control.observeActivity(child,root);const lines=readline.createInterface({input:child.stdout});
 lines.on('line',line=>{let m;try{m=JSON.parse(line);}catch{return;}const request=requests.get(m.id);if(request){requests.delete(m.id);clearTimeout(request.timer);m.error?request.reject(Error(JSON.stringify(m.error))):request.resolve(m.result);}});
 t.after(async()=>{lines.close();if(child.exitCode===null){const closed=new Promise(r=>child.once('exit',r));child.kill();await closed;}fs.rmSync(root,{recursive:true,force:true});});
 const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{requests.delete(id);reject(Error('Native RPC timeout: '+method));},10000);requests.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
 await rpc('initialize',{clientInfo:{name:'company_tools_live_test',version:'0.1.0'},capabilities:{experimentalApi:true}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');const pid=child.pid;
 const project=path.join(root,'project');fs.mkdirSync(project);const cwds=[root,project],names=result=>result.data.flatMap(d=>d.skills).map(s=>s.name),before=names(await rpc('skills/list',{cwds,forceReload:true}));assert(before.includes('taobao-ai-operations'));assert(!before.includes('new-skill'));
 const next=generation(root,'0.4.18',true),activated=activateCollection(root,next.id);assert.equal(activated.sourceMigration.count,1);assert.equal((await control.refreshSkills(root)).status,'refreshed');const after=await rpc('skills/list',{cwds});assert(after.data.every(d=>d.skills.some(s=>s.name==='new-skill')));for(const cwd of after.data){const entries=cwd.skills.filter(s=>s.name==='taobao-ai-operations');assert.equal(entries.length,1);assert(entries[0].path.includes('/skills/company-tools/'));}assert.equal(child.pid,pid);assert.equal(child.exitCode,null);
});

function channelGeneration(root,version,channel,id){
 const value=generation(root,'0.4.17',false,id),member={id:'cloud-hug-style-transfer',package:'@petercjl/cloud-hug-style-transfer',version,channel,bin:'cloud-hug-style-transfer',blocked:false};
 const entry=path.join(value.directory,'runtime/cloud-hug.mjs'),directory=path.join(value.directory,'skills/cloud-hug-style-transfer');write(entry,'console.log('+JSON.stringify(version)+')');write(path.join(directory,'SKILL.md'),'---\nname: cloud-hug-style-transfer\ndescription: test\n---\n');write(path.join(directory,'.collection-runtime.json'),{runtimeEntry:entry,package:member.package,version});
 value.graph.members=[member];value.graph.skills.push({name:'cloud-hug-style-transfer',package:member.package,version,directory,runtimeEntry:entry});write(path.join(value.directory,'state/components.json'),{components:{[member.id]:{package:member.package,version,entry}}});
 for(const [file,data] of [['collection.json',value.graph],['integrity.json',hashes(path.join(value.directory,'skills'))]]){const target=path.join(value.directory,file);fs.copyFileSync(target,target+'.before-channel');fs.writeFileSync(target,JSON.stringify(data));}return value;
}
test('selected channel switches in place, persists next and can explicitly return to a lower latest version',async t=>{
 const root=fixture(t);runtime(root);const old=channelGeneration(root,'0.7.0','latest');activateCollection(root,old.id);const base=path.join(root,'company-tools');
 const capabilities={collectionContract:{componentChannels:{option:'--component-channels',supported:['latest','next'],explicitSwitchMayDowngrade:true}}};
 const perform=async(channel,version)=>maintainCompanyTools(root,{force:true,componentChannels:{'cloud-hug-style-transfer':channel},fetcher:async()=>({ok:true,json:async()=>({name:PACKAGE,version:'0.4.17'})}),run:async(_node,args)=>{
  if(args[1]==='capabilities')return {stdout:JSON.stringify(capabilities)};
  const channelArgument=JSON.parse(args[args.indexOf('--component-channels')+1]);assert.equal(channelArgument['cloud-hug-style-transfer'],channel);
  if(args[2]==='check')return {stdout:JSON.stringify({ok:true,changed:true,members:[{id:'cloud-hug-style-transfer',package:'@petercjl/cloud-hug-style-transfer',version,available:version,channel,channelSwitch:true,blocked:false}]})};
  assert.equal(args[2],'prepare');const directory=args[args.indexOf('--directory')+1];channelGeneration(root,version,channel,path.basename(directory));return {stdout:'{}'};
 }});
 assert.equal((await perform('next','0.8.0-next.0')).status,'activated');assert.equal(companyToolsState(root).members[0].channel,'next');assert.equal(companyToolsState(root).members[0].version,'0.8.0-next.0');
 assert.equal(fs.readdirSync(path.join(root,'core/skills/company-tools')).filter(n=>n==='cloud-hug-style-transfer').length,1);
 const current=envContract.selection(root);assert(fs.existsSync(path.join(old.directory,'collection.json')));assert(fs.readdirSync(base).some(n=>n.startsWith('previous-skills-')));
 assert.equal((await perform('latest','0.7.0')).status,'activated');assert.equal(companyToolsState(root).members[0].channel,'latest');assert.equal(companyToolsState(root).members[0].version,'0.7.0');assert.notEqual(envContract.selection(root).generation,current.generation);
});
test('an unsupported collection channel contract preserves the active tool and its one discovery source',async t=>{
 const root=fixture(t);runtime(root);const old=channelGeneration(root,'0.7.0','latest');activateCollection(root,old.id);const before=fs.readFileSync(path.join(root,'company-tools/active.json'));
 const result=await maintainCompanyTools(root,{force:true,componentChannels:{'cloud-hug-style-transfer':'next'},fetcher:async()=>({ok:true,json:async()=>({name:PACKAGE,version:'0.4.17'})}),run:async()=>({stdout:'{}'})});assert.equal(result.reason,'COLLECTION_CHANNEL_UNSUPPORTED');assert.deepEqual(fs.readFileSync(path.join(root,'company-tools/active.json')),before);assert.equal(companyToolsState(root).members[0].channel,'latest');
});

test('explicit discovery recovery archives standalone operations, links and user edits while normal updates remain strict',async t=>{
 const root=fixture(t);runtime(root);const old=channelGeneration(root,'0.7.0','latest');activateCollection(root,old.id);
 const target=path.join(root,'core/skills/company-tools'),operations=path.join(target,'.cloud-hug-style-transfer-operations/operation');
 write(path.join(operations,'receipt.json'),{stage:'complete',target:path.join(target,'cloud-hug-style-transfer')});
 write(path.join(target,'cloud-hug-style-transfer/user-notes.txt'),'preserved user change');
 fs.symlinkSync('receipt.json',path.join(operations,'npm-bin'));
 const before=fs.readFileSync(path.join(root,'company-tools/active.json'));
 const failed=await maintainCompanyTools(root,{force:true,fetcher:()=>{throw Error('must reject before network');}});assert.equal(failed.reason,'COLLECTION_LINK');
 assert.throws(()=>activateCollection(root,old.id),{code:'COLLECTION_LINK'});
 const result=await recoverCollectionDiscovery(root);assert.equal(result.status,'recovered');
 assert.deepEqual(fs.readFileSync(path.join(root,'company-tools/active.json')),before);
 const archived=path.join(result.recoveryDirectory,'preserved-skills');assert.equal(fs.readFileSync(path.join(archived,'cloud-hug-style-transfer/user-notes.txt'),'utf8'),'preserved user change');
 assert.equal(fs.readlinkSync(path.join(archived,'.cloud-hug-style-transfer-operations/operation/npm-bin')),'receipt.json');
 if(process.platform!=='win32')assert.equal(fs.statSync(result.recoveryDirectory).mode&0o777,0o700);
 assert.deepEqual(hashes(target),hashes(old.graph.skillsDirectory));assert.equal((await recoverCollectionDiscovery(root)).status,'current');
 assert(fs.existsSync(path.join(result.recoveryDirectory,'inventory.json')));assert(fs.existsSync(path.join(result.recoveryDirectory,'complete.json')));
});
test('interrupted explicit recovery restores its preserved tree before safely repeating recovery',async t=>{
 const root=fixture(t),old=generation(root);activateCollection(root,old.id);const base=path.join(root,'company-tools'),target=path.join(root,'core/skills/company-tools');
 write(path.join(target,'user.txt'),'keep');const directory=fs.mkdtempSync(path.join(base,'discovery-recovery-')),archive=path.join(directory,'preserved-skills'),candidate=path.join(directory,'restored');
 write(path.join(base,'discovery-recovery.json'),{contract:1,generation:old.id,directory,archive,candidate});fs.renameSync(target,archive);
 const result=await recoverCollectionDiscovery(root);assert.equal(result.status,'recovered');assert.equal(fs.readFileSync(path.join(result.recoveryDirectory,'preserved-skills/user.txt'),'utf8'),'keep');assert.deepEqual(hashes(target),hashes(old.graph.skillsDirectory));
});
test('stable component dispatch delegates lifecycle writes to the host while allowing business commands and inspection',async()=>{
 const {guardMaintenance}=await import('../lib/company-tools-dispatch.cjs');
 for(const args of [['skill','install'],['skill','update'],['update','install'],['update','resume'],['update','rollback'],['update','auto','on']])assert.throws(()=>guardMaintenance('cloud-hug-style-transfer',args),{code:'COLLECTION_MANAGED_COMPONENT'});
 for(const args of [['version'],['run'],['skill','source'],['skill','status'],['update','operation'],['update','check'],['skill','update','--help']])guardMaintenance('cloud-hug-style-transfer',args);
});

test('host refuses a single-channel candidate that also changes another installed component',async t=>{
 const root=fixture(t);runtime(root);const old=channelGeneration(root,'0.7.0','latest');activateCollection(root,old.id);
 const before=fs.readFileSync(path.join(root,'company-tools/active.json'));
 const result=await maintainCompanyTools(root,{force:true,componentChannels:{'cloud-hug-style-transfer':'next'},fetcher:async()=>({ok:true,json:async()=>({name:PACKAGE,version:'0.4.17'})}),run:async(_node,args)=>{
  if(args[1]==='capabilities')return {stdout:JSON.stringify({collectionContract:{componentChannels:{option:'--component-channels',supported:['latest','next'],explicitSwitchMayDowngrade:true}}})};
  if(args[2]==='check')return {stdout:JSON.stringify({ok:true,changed:true,members:[]})};
  const candidate=channelGeneration(root,'0.8.0-next.0','next',path.basename(args[args.indexOf('--directory')+1]));candidate.graph.members.push({id:'unexpected',package:'@petercjl/unexpected',version:'1.0.0',bin:'unexpected'});
  const file=path.join(candidate.directory,'collection.json');fs.copyFileSync(file,file+'.scope-before');fs.writeFileSync(file,JSON.stringify(candidate.graph));return {stdout:'{}'};
 }});assert.equal(result.reason,'COLLECTION_CHANNEL_SCOPE');assert.deepEqual(fs.readFileSync(path.join(root,'company-tools/active.json')),before);
});
