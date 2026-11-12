import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {patchWindowsReadiness,windowsReadinessChanges} from '../builders/windows-readiness.mjs';
const fixture=`async function query(api,observed){try{const result=await api.sendRequest('windowsSandbox/readiness',undefined);observed.push(result.status);return result.status}catch(error){observed.push('checkFailed');console.error('Failed to load Windows sandbox readiness');throw error}}`;
function load(request){const waits=[],observed=[],errors=[],source=patchWindowsReadiness(fixture).source,context={api:{sendRequest:request},observed,setTimeout:(fn,ms)=>{waits.push(ms);queueMicrotask(fn)},console:{error:e=>errors.push(e)}};vm.createContext(context);vm.runInContext(source,context);return{run:()=>vm.runInContext('query(api,observed)',context),waits,observed,errors};}
test('readiness stays pending through identity startup races and recovers without a failed state',async()=>{
 let calls=0,release;const gate=new Promise(r=>release=r),h=load(async method=>{assert.equal(method,'windowsSandbox/readiness');if(++calls<=2)throw Error('Hosted AppServerManager identity is not ready');await gate;return{status:'ready'}}),result=h.run();
 await new Promise(r=>setImmediate(r));assert.equal(calls,3);assert.deepEqual(h.observed,[]);release();assert.equal(await result,'ready');assert.deepEqual(h.observed,['ready']);assert.deepEqual(h.errors,[]);assert.deepEqual(h.waits,[250,500]);
});
test('permanent sandbox failures are preserved without retries',async()=>{
 const failure=Error('Sandbox provisioning denied');let calls=0;const h=load(async()=>{calls++;throw failure});await assert.rejects(h.run(),e=>e===failure);assert.equal(calls,1);assert.deepEqual(h.waits,[]);assert.deepEqual(h.observed,['checkFailed']);
});
test('a persistent identity failure stops after the bounded recovery window',async()=>{
 const failure=Error('Hosted AppServerManager identity is not ready');let calls=0;const h=load(()=>{calls++;throw failure});await assert.rejects(h.run(),e=>e===failure);assert.equal(calls,7);assert.deepEqual(h.waits,[250,500,1000,2000,4000,5000]);assert.deepEqual(h.observed,['checkFailed']);
});
test('readiness patch is idempotent, excludes other requests and fails on a changed query contract',()=>{
 const source=fixture+`;async function configure(api){return await api.sendRequest('windowsSandbox/setupStart',{})}`,patched=patchWindowsReadiness(source);assert.equal(patched.patches,1);assert.match(patched.source,/return await api.sendRequest\('windowsSandbox\/setupStart'/);assert.equal(patchWindowsReadiness(patched.source).source,patched.source);assert.equal(patchWindowsReadiness('const label="Windows"').patches,0);assert.throws(()=>patchWindowsReadiness(fixture.replace('windowsSandbox/readiness','other/readiness')),/contract/);
 const files=new Map([['webview/assets/async/one.js',fixture],['webview/assets/async/two.js',fixture],['webview/assets/strings.js','const label="Windows"']]),asar={listPackage:()=>[...files.keys()],extractFile:(_,name)=>Buffer.from(files.get(name.replaceAll('\\','/')))};assert.equal(windowsReadinessChanges(asar,'fixture').size,2);
});
