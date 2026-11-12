import test from 'node:test';import assert from 'node:assert/strict';
import {nativeDeviceContract,nativeDeviceBundleContract} from '../ci/native-device-contract.mjs';
test('device smoke resolves the Owl RPC export across renamed bindings and rejects ambiguous or non-executable contracts',()=>{
 for(const [binding,local]of [['HostApi','host'],['Kat','l']])assert.deepEqual(nativeDeviceContract(`import {${binding} as ${local}} from './app-shared-a123.js';function read(){return ${local}.codexMicro} function localOnly(e){return e.codexMicro}`),{module:'/assets/app-shared-a123.js',binding});
 assert.throws(()=>nativeDeviceContract("// host.codexMicro\nimport {HostApi as host} from './app-shared-a.js';"),/contract/);
 assert.throws(()=>nativeDeviceContract("import {A as a,B as b} from './app-shared-a.js';let one=a.codexMicro,two=b.codexMicro;"),/ambiguous/);
 assert.throws(()=>nativeDeviceContract("import {A as a} from '../untrusted.js';let service=a.codexMicro;"),/contract/);
});
test('device smoke uses the live Rspack entry and deduplicates service imports',()=>{
 const html='<script type="module" src="/assets/runtime.js"></script>',files=new Map([
  ['assets/runtime.js','const live = {}; export {live as __webpack_require__};'],
  ['assets/async/bridge.js','export const __webpack_modules__={bridge(e,t,r){var host=r("services");function read(){return host.appServices.codexMicro} }};'],
  ['assets/async/duplicate.js','export const __webpack_modules__={other(e,t,require){var h=require("services");let value=h.appServices.codexMicro}};'],
  ['assets/strings.js','const label="host.wrong.codexMicro";']
 ]);
 assert.deepEqual(nativeDeviceBundleContract(files,html),{runtimeModule:'/assets/runtime.js',moduleId:'services',binding:'appServices'});
 assert.throws(()=>nativeDeviceBundleContract(files,''),/contract/);
 files.set('assets/async/ambiguous.js','export const __webpack_modules__={other(e,t,r){var h=r("otherService");let value=h.appServices.codexMicro}};');
 assert.throws(()=>nativeDeviceBundleContract(files,html),/ambiguous/);
});
