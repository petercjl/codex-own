import test from 'node:test';import assert from 'node:assert/strict';
import {nativeDeviceContract} from '../ci/native-device-contract.mjs';
test('device smoke resolves the Owl RPC export across renamed bindings and rejects ambiguous or non-executable contracts',()=>{
 for(const [binding,local]of [['HostApi','host'],['Kat','l']])assert.deepEqual(nativeDeviceContract(`import {${binding} as ${local}} from './app-shared-a123.js';function read(){return ${local}.codexMicro} function localOnly(e){return e.codexMicro}`),{module:'/assets/app-shared-a123.js',binding});
 assert.throws(()=>nativeDeviceContract("// host.codexMicro\nimport {HostApi as host} from './app-shared-a.js';"),/contract/);
 assert.throws(()=>nativeDeviceContract("import {A as a,B as b} from './app-shared-a.js';let one=a.codexMicro,two=b.codexMicro;"),/ambiguous/);
 assert.throws(()=>nativeDeviceContract("import {A as a} from '../untrusted.js';let service=a.codexMicro;"),/contract/);
});
