import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';
import {copyRuntimeDependencies} from '../builders/updater.mjs';
const require=createRequire(import.meta.url),{resolveBundledNode,materializeBundledNode}=require('../lib/bundled-node.cjs');
test('shared application Node serves workers and a standalone handoff survives removal of the old application',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'own-shared-node-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
 const resources=path.join(root,'app/resources'),bundle=path.join(resources,'own-updater'),exe=process.platform==='win32'?'node.exe':'node',node=path.join(resources,'cua_node/bin',exe);
 fs.mkdirSync(bundle,{recursive:true});fs.mkdirSync(path.dirname(node),{recursive:true});fs.copyFileSync(process.execPath,node,fs.constants.COPYFILE_EXCL);
 const file=path.join(bundle,'node-runtime.json'),meta={schema:1,source:'application-cua-node',binary:'../cua_node/bin/'+exe,version:process.versions.node};fs.writeFileSync(file,JSON.stringify(meta),{flag:'wx'});
 assert.equal(resolveBundledNode(bundle),node);assert(!fs.existsSync(path.join(bundle,exe)));
 const handoff=path.join(root,'handoff');fs.cpSync(bundle,handoff,{recursive:true});const local=materializeBundledNode(bundle,handoff);assert.equal(resolveBundledNode(handoff),local);
 assert.throws(()=>{fs.appendFileSync(local,'changed');materializeBundledNode(bundle,handoff)},/differs/);
 fs.unlinkSync(local);materializeBundledNode(bundle,handoff);fs.rmSync(path.join(root,'app'),{recursive:true});
 assert.equal(execFileSync(resolveBundledNode(handoff),['--version'],{encoding:'utf8'}).trim(),process.version);
 fs.writeFileSync(path.join(handoff,'node-runtime.json'),JSON.stringify({...meta,binary:'../../untrusted/node'}));assert.throws(()=>resolveBundledNode(handoff),{code:'BUNDLED_NODE_INVALID'});
});
test('historical standalone bundles retain their local Node path',()=>{
 assert.equal(resolveBundledNode('/fixture/legacy','win32'),path.join('/fixture/legacy','node.exe'));
});
test('runtime dependency copies share identical versions, retain version conflicts and licenses, and exclude type/debug artifacts',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'own-dependency-tree-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const source=path.join(root,'source'),dest=path.join(root,'bundle');fs.mkdirSync(dest);
 function pkg(dir,name,version,dependencies={},body='module.exports='+JSON.stringify(version)){
  fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name,version,main:'index.js',dependencies}),{flag:'wx'});fs.writeFileSync(path.join(dir,'index.js'),body,{flag:'wx'});fs.writeFileSync(path.join(dir,'LICENSE'),'license',{flag:'wx'});fs.writeFileSync(path.join(dir,'index.d.ts'),'export {};',{flag:'wx'});fs.writeFileSync(path.join(dir,'index.js.map'),'{}',{flag:'wx'});
 }
 for(const name of ['a','b','d'])pkg(path.join(source,'node_modules',name),name,'1.0.0',{c:name==='d'?'2.0.0':'1.0.0'},'module.exports=require("c")');
 pkg(path.join(source,'node_modules/c'),'c','1.0.0');pkg(path.join(source,'node_modules/d/node_modules/c'),'c','2.0.0');
 const stats=copyRuntimeDependencies(['a','b','d'],createRequire(path.join(source,'entry.cjs')),dest),consumer=createRequire(path.join(dest,'entry.cjs'));
 assert.equal(consumer('a'),'1.0.0');assert.equal(consumer('b'),'1.0.0');assert.equal(consumer('d'),'2.0.0');assert(!fs.existsSync(path.join(dest,'node_modules/a/node_modules/c')));assert(fs.existsSync(path.join(dest,'node_modules/d/node_modules/c')));
 assert.equal(fs.readFileSync(path.join(dest,'node_modules/c/LICENSE'),'utf8'),'license');assert(!fs.existsSync(path.join(dest,'node_modules/c/index.d.ts')));assert(!fs.existsSync(path.join(dest,'node_modules/c/index.js.map')));assert.equal(stats.packages,5);assert(stats.prunedBytes>0);
});
