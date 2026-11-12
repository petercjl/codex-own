import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {patchWindowsSidebar,windowsSidebarChanges} from '../builders/windows-sidebar.mjs';
const fixture=`const unrelated=({...rest})=>other(rest);const state={flag:1};const enabled=({get:read})=>read(state.flag,'3085093835');function layout(get){if(!enabled({get}))return 'legacy';return 'rail-with-contextual-sidebar'}const compact='rail-only';`;
test('API mode uses the upstream navigation rail on Windows independently of device rollout',()=>{
 const source=patchWindowsSidebar(fixture).source;for(const rollout of [false,true]){const c={codexOwnProductPolicy:{contract:1,apiMode:true},get:()=>rollout};vm.createContext(c);assert.equal(vm.runInContext(source+'\nlayout(get)',c),'rail-with-contextual-sidebar');}
 for(const rollout of [false,true]){const c={codexOwnProductPolicy:{contract:1,apiMode:false},get:()=>rollout};vm.createContext(c);assert.equal(vm.runInContext(source+'\nlayout(get)',c),rollout?'rail-with-contextual-sidebar':'legacy');}
});
test('sidebar adaptation is idempotent and rejects missing or ambiguous policy contracts',()=>{
 const patched=patchWindowsSidebar(fixture);assert.equal(patched.patched,true);assert.equal(patchWindowsSidebar(patched.source).source,patched.source);assert.equal(patchWindowsSidebar(fixture.replace('read(state.flag,','other(state.flag,')).patched,false);assert.throws(()=>patchWindowsSidebar(fixture+"const second=({get})=>get(state.flag,'3085093835');"),/contract/);assert.equal(patchWindowsSidebar('const flag="unrelated"').patched,false);
 const files=new Map([['webview/assets/async/layout.js',fixture],['webview/assets/async/project-list.js',`const unrelated=({get:e})=>e(other)&&!e(flag,'3085093835');const layouts=['rail-only','rail-with-contextual-sidebar'];`]]),asar={listPackage:()=>[...files.keys()],extractFile:(_,n)=>Buffer.from(files.get(n.replaceAll('\\','/')))};assert.equal(windowsSidebarChanges(asar,'fixture').size,1);assert.throws(()=>windowsSidebarChanges({...asar,listPackage:()=>[]},'fixture'),/one unified/);
});
