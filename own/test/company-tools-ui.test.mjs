import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {patchCompanyTools,companyToolsChanges} from '../builders/company-tools.mjs';
import manager from '../desktop/company-tools-manager.cjs';import control from '../lib/desktop-control.cjs';
import {companyUiFixture} from './fixtures/company-tools-ui.mjs';
test('native sidebar opens a separate collection route while retaining upstream destinations',()=>{
 const patched=patchCompanyTools(companyUiFixture);assert(patched.nav&&patched.route);assert.equal(patchCompanyTools(patched.source).source,patched.source);
 const context=vm.createContext({companyFixtureRequire:()=>({jsx:(type,props)=>({type,props})}),R:{Route:'route'}});vm.runInContext(patched.source,context);
 const items=[],destinations=[];context.companyUiFixture.sidebar(items,p=>destinations.push(p),'/company-tools');assert.equal(items.length,2);assert.equal(items[0].id,'plugins');assert.equal(items[1].label,'公司工具集');assert(items[1].isCurrentDestination);items[1].onSelect();assert.deepEqual(destinations,['/company-tools']);
 const routes=context.companyUiFixture.routes();assert.equal(routes[0].props.path,'/company-tools');assert.equal(typeof routes[0].props.element.type,'function');assert.equal(routes[1].props.path,'/skills');
 assert.throws(()=>companyToolsChanges({listPackage:()=>[],extractFile:()=>{}},'empty'),/entry points missing/);
 assert.throws(()=>patchCompanyTools(companyUiFixture+companyUiFixture),/ambiguous/);
});
test('collection page renders real counts, versions, CLI names and Skill search; delegates actions to the host',async()=>{
 const base={contract:1,name:'公司测试包',package:'@petercjl/taobao-ai-ops',version:'1.2.3',installed:true,autoUpdate:true,memberCount:1,skillCount:1,progress:{phase:'verifying',step:3,completed:2,total:4,indeterminate:false},members:[{id:'tool',package:'@petercjl/tool',version:'2.0.0',cli:['tool'],skills:[{name:'example',label:'测试技能'}]}],skills:[{name:'example',label:'测试技能',package:'@petercjl/tool',version:'2.0.0'}]};
 const calls=[],values=[base,'',''];let index=0;
 const context=vm.createContext({__JSX__:{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},__REACT__:{useState:()=>{const n=index++;return [values[n],v=>{values[n]=v;}];},useEffect:()=>{}},codexOwnCompanyTools:{setComponentChannel:async(id,channel)=>{calls.push([id,channel]);return base;},check:async()=>{calls.push('check');return base;},update:async()=>{calls.push('update');return base;},setAutoUpdate:async enabled=>{calls.push(enabled);return {...base,autoUpdate:enabled};}}});
 vm.runInContext(fs.readFileSync(new URL('../desktop/company-tools-page.js',import.meta.url),'utf8'),context);
 const render=()=>{index=0;return context.__codexOwnCompanyTools();};
 const nodes=node=>{if(!node||typeof node!=='object')return [];return [node,...[node.props?.children].flat(Infinity).flatMap(nodes)];};
 const tree=render(),all=nodes(tree),serialized=JSON.stringify(tree);assert.match(serialized,/1.2.3/);assert.match(serialized,/1 个 Skill/);assert.match(serialized,/CLI：tool/);assert.match(serialized,/CLI \+ Skill/);assert.equal(all.filter(n=>n.type==='tbody')[0].props.children.length,1);
 const progress=all.find(n=>n.type==='progress');assert.equal(progress.props.max,4);assert.equal(progress.props.value,2);assert(!serialized.includes('重启启用'));
 const row=()=>nodes(render()).find(n=>n.type==='tbody').props.children[0];
 assert.equal(row().props.children.at(-1).props.children,'未检查');
 values[0]={...base,members:[{...base.members[0],available:'2.0.0'}]};assert.equal(row().props.children.at(-1).props.children,'2.0.0');assert(!JSON.stringify(row()).includes('↑ 可更新'));
 values[0]={...base,members:[{...base.members[0],available:'2.1.0'}]};assert.match(JSON.stringify(row()),/↑ 可更新/);assert.match(JSON.stringify(row()),/2.1.0/);
 values[0]={...base,members:[{...base.members[0],available:'1.9.0'}]};assert.equal(row().props.children.at(-1).props.children,'1.9.0');assert(!JSON.stringify(row()).includes('↑ 可更新'));values[0]=base;
 await all.find(n=>n.type==='button'&&n.props.children==='检查更新').props.onClick();assert.deepEqual(calls,['check']);
 await all.find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:false}});assert.deepEqual(calls,['check',false]);
 assert.match(JSON.stringify(render()),/测试技能/);const selector=nodes(render()).find(n=>n.type==='select');assert.equal(selector.props.value,'latest');assert.equal(selector.props.style.appearance,'auto');assert.equal(nodes(render()).find(n=>n.type==='tbody').props.children[0].props.children[1].props.children.type,'select');await selector.props.onChange({target:{value:'next'}});assert.deepEqual(calls.at(-1),['tool','next']);
 values[0]={...base,error:'COLLECTION_LINK'};assert.match(JSON.stringify(render()),/独立更新器/);assert(nodes(render()).some(n=>n.type==='button'&&n.props.children==='保留现场并恢复工具集'));
 values[0]={...values[0],pendingUpdate:true};assert(nodes(render()).some(n=>n.type==='button'&&n.props.children==='应用已下载的更新'));
 nodes(render()).find(n=>n.props?.['aria-label']==='搜索工具集内容').props.onChange({target:{value:'missing'}});assert.match(JSON.stringify(render()),/没有匹配/);
});
test('online updates report progress and refresh the native Skill cache while an existing turn keeps running',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'company-ui-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();const input=child.stdin,output=child.stdout;let passed='',visible='';input.on('data',b=>passed+=b);control.observeActivity(child,root);child.stdout.on('data',b=>visible+=b);
 const send=m=>child.stdin.write(JSON.stringify(m)+'\n'),reply=m=>output.write(JSON.stringify(m)+'\n');
 send({id:1,method:'initialize'});reply({id:1,result:{}});assert(control.activity(root).ready);
 send({id:2,method:'turn/start',params:{threadId:'task'}});assert(control.activity(root).busy);reply({id:2,result:{}});reply({method:'turn/started',params:{threadId:'task'}});assert.equal(control.activity(root).activeTasks,1);assert.match(passed,/turn\/start/);
 const app=new EventEmitter(),handlers=new Map(),events=[];app.relaunch=()=>events.push('relaunch');app.quit=()=>events.push('quit');
 let value={contract:1,version:'1.0.0'},finish,worker;const options={load:async()=>({companyToolsState:()=>value,setCompanyToolsPolicy:async(_root,enabled)=>{if(typeof enabled!=='boolean')throw Error('invalid');value={...value,autoUpdate:enabled};}}),execute:(_node,_args,_opts,callback)=>{finish=callback;worker={stderr:new PassThrough(),kill:()=>{}};return worker;}};
 const state=manager.start({app,ipcMain:{handle:(name,fn)=>handlers.set(name,fn)}},root,options),invoke=handlers.get(manager.CHANNEL),web=new EventEmitter();web.mainFrame={url:'app://-/index.html'};web.getURL=()=>web.mainFrame.url;web.isDestroyed=()=>false;web.send=()=>{};app.emit('browser-window-created',{}, {webContents:web});const event={sender:web,senderFrame:web.mainFrame};
 await assert.rejects(invoke({...event,senderFrame:{url:'app://-/index.html'}},'read'),/Invalid/);await assert.rejects(invoke(event,'auto-update',{enabled:'false'}),/invalid/);await assert.rejects(invoke(event,'restart'),/Invalid/);assert.equal(events.length,0);
 const pending=state.run('update');assert.equal(state.run('check'),pending);assert((await state.read()).busy);
 const progress=Buffer.from(JSON.stringify({type:'progress',phase:'preparing',label:'正在准备组件…',step:2,completed:1,total:4,indeterminate:true})+'\n');worker.stderr.write(progress.subarray(0,progress.length-6));worker.stderr.write(progress.subarray(progress.length-6));assert.equal((await state.read()).progress.phase,'preparing');assert.match((await state.read()).message,/准备组件/);
 value={...value,version:'2.0.0'};finish(null,JSON.stringify({status:'activated'}));const request=passed.trim().split('\n').map(s=>JSON.parse(s)).find(m=>m.method==='skills/list');assert.equal(request.params.forceReload,true);reply({id:request.id,result:{data:[]}});await pending;
 assert(!(await state.read()).busy);assert.equal((await state.read()).version,'2.0.0');assert.equal((await state.read()).progress.completed,4);assert(control.activity(root).busy);assert.match(visible,/skills\/changed/);assert(!visible.includes(request.id));assert.deepEqual(events,[]);
 await invoke(event,'auto-update',{enabled:false});assert.equal((await state.read()).autoUpdate,false);reply({method:'turn/completed',params:{threadId:'task'}});assert(!control.activity(root).busy);child.emit('exit');assert(!control.activity(root).ready);app.emit('before-quit');
});

test('native IPC passes only the selected component channel and rejects concurrent switches',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'company-channel-ipc-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const app=new EventEmitter(),handlers=new Map();let args,finish;
 const state=manager.start({app,ipcMain:{handle:(n,fn)=>handlers.set(n,fn)}},root,{load:async()=>({companyToolsState:()=>({contract:1,members:[{id:'cloud-hug-style-transfer',channel:'latest'}]})}),execute:(_node,a,_options,callback)=>{args=a;finish=callback;return {stderr:new PassThrough(),kill(){}};}});
 const web=new EventEmitter();web.mainFrame={url:'app://-/index.html'};web.getURL=()=>web.mainFrame.url;web.isDestroyed=()=>false;web.send=()=>{};app.emit('browser-window-created',{}, {webContents:web});const event={sender:web,senderFrame:web.mainFrame},invoke=handlers.get(manager.CHANNEL);
 await invoke(event,'component-channel',{id:'cloud-hug-style-transfer',channel:'next'});assert.equal(args[2],'update');assert.deepEqual(JSON.parse(args[3]),{'cloud-hug-style-transfer':'next'});
 await assert.rejects(invoke(event,'component-channel',{id:'cloud-hug-style-transfer',channel:'latest'}),/正在更新/);const pending=state.run('update');finish(null,JSON.stringify({status:'failed',reason:'CHANNEL_UNAVAILABLE'}));await pending;assert(!(await state.read()).busy);assert.equal((await state.read()).members[0].channel,'latest');
 await assert.rejects(invoke(event,'component-channel',{id:'unknown',channel:'next'}),/Unknown/);await assert.rejects(invoke(event,'component-channel',{id:'cloud-hug-style-transfer',channel:'beta'}),/Invalid/);app.emit('before-quit');
});
