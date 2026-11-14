import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {executionUiFixture} from './fixtures/execution-status.mjs';
import {companyUiFixture} from './fixtures/company-tools-ui.mjs';
import {patchProductModeSource,patchProductModeShared,patchProductModePreload,productModeChanges,policyPreload} from '../builders/product-mode.mjs';
const {apiMode,install,CHANNEL}=createRequire(import.meta.url)('../desktop/product-mode.cjs');
const sharedFixture=`const q={},gye={conversationDetailMode:'detail'},saved='saved';const Tu=(_,getter)=>getter;
const executionDetail=Tu(q,({get:e})=>{let mode=e('coding');return mode==='coding'?'STEPS_COMMANDS':mode==='everyday'?'STEPS_PROSE':e(saved)?.detailLevel??e(gye.conversationDetailMode)});
function setDetail(store,next){store.log({previousWorkMode:store.value,selectedThreadDetailLevel:next});store.value=next;return next;}
globalThis.sharedFixture={executionDetail,setDetail};`;
const fixture=`
const q={},gye={conversationDetailMode:'detail'},vPe='preference';
const fZe=()=>null,Tu=(_,getter)=>getter;
const derivedMode=Tu(q,({get:e})=>{let t=fZe(e,gye.conversationDetailMode);return e(vPe)==='STEPS_PROSE'?'work':'codex'});
const Item='item',jsx=(type,props)=>({type,props});
function switchMode(store,{codexLocalAccessStatus:access,nextMode:next}){store.mode=next;return next;}
function Sidebar(e){let {codexAvailable:r,mode:a,onModeSelect:s,onNewChat:c,workModeAccess:l}=e;
 const messages=['sidebarElectron.productMode.trigger','sidebarElectron.productMode.work.description.recommended'];
 const L=undefined,R='Create, learn, and explore',z=()=>s('work'),V='ChatGPT Work';
 const work=jsx(Item,{className:'py-2.5 text-base',rightIconAsset:L,SubText:R,onSelect:z,children:V});
 const codex=jsx(Item,{className:'py-2.5 text-base',rightIconAsset:undefined,SubText:'Build, debug, and ship',onSelect:()=>s('codex'),children:'Codex'});
 return {mode:a,available:r,onNewChat:c,work,codex};
}
globalThis.fixture={derivedMode,Sidebar,switchMode};`;
function renderContext(api){
 const context=vm.createContext({require:()=>({contextBridge:{exposeInMainWorld:(k,v)=>{context[k]=Object.freeze(v);}},ipcRenderer:{sendSync:channel=>{assert.equal(channel,CHANNEL);return{contract:1,apiMode:api};}}})});
 vm.runInContext(policyPreload,context);vm.runInContext(patchProductModeSource(fixture).source,context);return context.fixture;
}
test('API credentials yield only a boolean policy, without exposing or modifying secrets',t=>{
 const core=fs.mkdtempSync(path.join(os.tmpdir(),'own-product-policy-'));t.after(()=>fs.rmSync(core,{recursive:true,force:true}));
 assert.equal(apiMode(core),false);const auth=path.join(core,'auth.json');fs.writeFileSync(auth,JSON.stringify({auth_mode:'apikey',OPENAI_API_KEY:'sk-private-fixture'}));const before=fs.readFileSync(auth);
 assert.equal(apiMode(core),true);let handler;install({ipcMain:{handle:()=>{},on:(channel,fn)=>{assert.equal(channel,CHANNEL);handler=fn;}}},core);const event={};handler(event);
 assert.deepEqual(event.returnValue,{contract:1,apiMode:true});assert.ok(!JSON.stringify(event.returnValue).includes('private'));assert.deepEqual(fs.readFileSync(auth),before);
 fs.writeFileSync(auth,JSON.stringify({auth_mode:'chatgpt',tokens:{}}));assert.equal(apiMode(core),false);
 fs.writeFileSync(auth,JSON.stringify({OPENAI_API_KEY:'sk-legacy-fixture'}));assert.equal(apiMode(core),true);
 fs.writeFileSync(auth,'broken');assert.equal(apiMode(core),false);
});
test('API mode starts in Codex despite a saved Work preference and disables the Work menu action',()=>{
 const api=renderContext(true),selected=[];
 assert.equal(api.derivedMode({get:()=> 'STEPS_PROSE'}),'codex');
 const view=api.Sidebar({codexAvailable:false,mode:'work',onModeSelect:x=>selected.push(x),onNewChat:()=> 'work'});
 assert.equal(view.mode,'codex');assert.equal(view.available,true);assert.equal(view.onNewChat,undefined);
 assert.equal(view.work.props.children,'ChatGPT Work');assert.equal(view.work.props.disabled,true);assert.equal(view.work.props['aria-disabled'],true);assert.match(view.work.props.className,/opacity-50/);assert.equal(view.work.props.onSelect,undefined);
 view.codex.props.onSelect();assert.deepEqual(selected,['codex']);
});
test('API mode rejects mode switches from command and keyboard routes, while subscription behavior is retained',()=>{
 const api=renderContext(true),store={mode:'codex'};api.switchMode(store,{codexLocalAccessStatus:'allowed',nextMode:'work'});assert.equal(store.mode,'codex');api.switchMode(store,{codexLocalAccessStatus:'allowed',nextMode:'codex'});assert.equal(store.mode,'codex');
 const subscription=renderContext(false);assert.equal(subscription.derivedMode({get:()=> 'STEPS_PROSE'}),'work');
 const selected=[],view=subscription.Sidebar({codexAvailable:true,mode:'work',onModeSelect:x=>selected.push(x)});
 assert.equal(view.mode,'work');assert.equal(view.work.props.disabled,false);assert.equal(view.work.props.className,'py-2.5 text-base');view.work.props.onSelect();assert.deepEqual(selected,['work']);
 subscription.switchMode(store,{codexLocalAccessStatus:'allowed',nextMode:'work'});assert.equal(store.mode,'work');
});
test('the execution engine uses Codex commands despite saved prose preferences, and rejects writing prose in API mode',()=>{
 for(const apiMode of [true,false]){
  const context=vm.createContext({codexOwnProductPolicy:{contract:1,apiMode}});vm.runInContext(patchProductModeShared(sharedFixture).source,context);
  const {executionDetail,setDetail}=context.sharedFixture;
  assert.equal(executionDetail({get:key=>key==='coding'?'preference':key==='saved'?{detailLevel:'STEPS_PROSE'}:null}),apiMode?'STEPS_COMMANDS':'STEPS_PROSE');
  const store={value:'STEPS_PROSE',log:()=>{}};setDetail(store,'STEPS_PROSE');assert.equal(store.value,apiMode?'STEPS_COMMANDS':'STEPS_PROSE');
 }
 const patched=patchProductModeShared(sharedFixture);assert.equal(patchProductModeShared(patched.source).source,patched.source);
 assert.throws(()=>patchProductModeShared(sharedFixture.replaceAll('selectedThreadDetailLevel','changedDetail')),/contract changed/);
});
test('missing policy bridge and upstream contract drift stop the patch instead of shipping a cosmetic label change',()=>{
 assert.throws(()=>vm.runInNewContext(policyPreload,{require:()=>({contextBridge:{exposeInMainWorld:()=>{}},ipcRenderer:{sendSync:()=>null}})}),/policy unavailable/);
 const patched=patchProductModeSource(fixture);assert.equal(patched.patched,true);assert.equal(patchProductModeSource(patched.source).source,patched.source);
 assert.throws(()=>patchProductModeSource(fixture.replaceAll('codexLocalAccessStatus','newAccessStatus')),/contract changed/);
 assert.equal(patchProductModePreload(policyPreload),policyPreload);assert.throws(()=>patchProductModePreload('unknown preload'),/contract changed/);
});
test('desktop patch requires renderer, execution state and preload together, and verifies an already patched archive',()=>{
 const files=new Map([['webview/assets/execution-status.js',executionUiFixture],['webview/assets/company-ui.js',companyUiFixture],['webview/assets/app-initial-fixture.js',fixture],['webview/assets/execution-state-a1b2.js',sharedFixture],['.vite/build/preload.js','const bridge={exposeInMainWorld(){}};']]);
 const asar={listPackage:()=>[...files.keys()],extractFile:(_archive,file)=>Buffer.from(files.get(file.replaceAll('\\','/')))};
 const changed=productModeChanges(asar,'fixture');assert.equal(changed.size,5);
 for(const [file,bytes]of changed)files.set(file,bytes.toString());assert.equal(productModeChanges(asar,'fixture').size,0);
 files.delete('webview/assets/execution-state-a1b2.js');assert.throws(()=>productModeChanges(asar,'fixture'),/shared=0/);
});
test('combined upstream chunks retain execution and menu policy plus an earlier Windows update menu edit',()=>{
 const combined=fixture+'\nconst saved="saved";\n'+sharedFixture.slice(sharedFixture.indexOf('const executionDetail'));
 const name='webview/assets/app-initial-combined.js',files=new Map([['webview/assets/execution-status.js',executionUiFixture],['webview/assets/company-ui.js',companyUiFixture],[name,combined],['.vite/build/preload.js','const bridge={exposeInMainWorld(){}};']]);
 const asar={listPackage:()=>[...files.keys()],extractFile:(_archive,file)=>Buffer.from(files.get(file.replaceAll('\\','/')))};
 const priorChanges=new Map([[name,Buffer.from('/* preceding Windows update menu edit */\n'+combined)]]),changes=productModeChanges(asar,'fixture',{priorChanges});
 assert.equal(changes.size,4);const source=changes.get(name).toString();assert.ok(source.includes('/* preceding Windows update menu edit */'));assert.equal(source.split('var __codexOwnApiMode=').length,2);
 const context=vm.createContext({codexOwnProductPolicy:{contract:1,apiMode:true}});vm.runInContext(source,context);
 assert.equal(context.fixture.derivedMode({get:()=> 'STEPS_PROSE'}),'codex');assert.equal(context.sharedFixture.executionDetail({get:()=> 'STEPS_PROSE'}),'STEPS_COMMANDS');
 assert.equal(context.fixture.Sidebar({codexAvailable:true,mode:'work',onModeSelect:()=>{throw Error('disabled')}}).work.props.onSelect,undefined);
 for(const [file,bytes]of changes)files.set(file,bytes.toString());assert.equal(productModeChanges(asar,'fixture').size,0);
});
test('split script chunks preserve API mode, disabled Work action and onboarding with no global helper collision',()=>{
 const prefix=fixture.slice(0,fixture.indexOf('const Item='));
 const sidebar='const Item="item",jsx=(type,props)=>({type,props});'+fixture.slice(fixture.indexOf('function Sidebar'),fixture.indexOf('globalThis.fixture='));
 const sources=[prefix+'globalThis.mode=derivedMode;', 'function switchMode(store,{codexLocalAccessStatus:access,nextMode:next}){store.mode=next;}globalThis.switchMode= switchMode;',sidebar+'globalThis.Sidebar=Sidebar;', 'const route=function({auth:a,codexFeatureAccess:f,backendOnboardingCompleted:done}){return done?"app":"welcome"};globalThis.route=route;',sharedFixture];
 const files=new Map(sources.map((s,i)=>['webview/assets/async/'+(100+i)+'.hash.js','(()=>{'+s+'})()']));files.set('webview/assets/execution-status.js',executionUiFixture);files.set('.vite/build/early-bootstrap.js','start();');files.set('.vite/build/preload.js','const bridge={exposeInMainWorld(){}};');
 files.set('webview/assets/company-ui.js',companyUiFixture);
 const asar={listPackage:()=>[...files.keys()],extractFile:(_archive,file)=>Buffer.from(files.get(file.replaceAll('\\','/')))};
 const changed=productModeChanges(asar,'fixture'),context=vm.createContext({codexOwnProductPolicy:{contract:1,apiMode:true},companyFixtureRequire:()=>({})});
 for(const [file,data]of changed){files.set(file,data.toString());if(file.startsWith('webview/'))vm.runInContext(data.toString(),context);}
 assert.equal(context.mode({get:()=> 'STEPS_PROSE'}),'codex');const store={mode:'codex'};context.switchMode(store,{nextMode:'work'});assert.equal(store.mode,'codex');
 assert.equal(context.Sidebar({codexAvailable:false,mode:'work',onModeSelect:()=>{throw Error('disabled')}}).work.props.onSelect,undefined);
 assert.equal(context.route({auth:{authMethod:'apikey'},backendOnboardingCompleted:false}),'app');assert.equal(productModeChanges(asar,'fixture').size,0);
 files.delete('webview/assets/async/101.hash.js');assert.throws(()=>productModeChanges(asar,'fixture'),/entry points missing/);
});

test('API users enter the workbench while authentication and gateway readiness remain enforced',()=>{
 const route=`function route({auth:a,codexFeatureAccess:f,backendOnboardingCompleted:done,gatewayOAuthReadiness:gateway='ready'}){return a.isLoading?null:!a.authMethod&&a.requiresAuth?'login':f.status==='loading'?null:gateway==='required'?'login':done?'app':'welcome'};globalThis.route=route;`;
 for(const apiMode of [true,false]){
  const source=patchProductModeSource(fixture+route).source,c=vm.createContext({codexOwnProductPolicy:{contract:1,apiMode}});vm.runInContext(source,c);
  const input={auth:{authMethod:'apikey'},codexFeatureAccess:{status:'allowed'},backendOnboardingCompleted:false};
  assert.equal(c.route(input),apiMode?'app':'welcome');
  assert.equal(c.route({...input,auth:{authMethod:null,requiresAuth:true}}),'login');
  assert.equal(c.route({...input,auth:{authMethod:'apikey',isLoading:true}}),null);
  assert.equal(c.route({...input,codexFeatureAccess:{status:'loading'}}),null);
  assert.equal(c.route({...input,gatewayOAuthReadiness:'required'}),'login');
  assert.equal(c.route({...input,auth:{authMethod:'chatgpt'}}),'welcome');
  assert.equal(c.route({...input,auth:{authMethod:null,requiresAuth:false}}),apiMode?'app':'welcome');
  assert.equal(patchProductModeSource(source).source,source);
 }
 assert.throws(()=>patchProductModeSource(fixture+route.replace('codexFeatureAccess:f','changedFeatureAccess:f')),/onboarding route gate/);
});
