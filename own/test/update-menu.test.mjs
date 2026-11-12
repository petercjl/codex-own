import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import {patchUpdateMenuSource,updateMenuChanges} from '../builders/update-menu.mjs';
test('Windows snapshot exposes the standalone update root and its command',()=>{
 const source='(()=>{const st={help:"help"},t=id=>[id];return {[st.help]:t(st.help)}})()';
 const next=patchUpdateMenuSource(source,'main'),result=vm.runInNewContext(next);
 assert.equal(result['codex-own-updates'][0],'codex-own-updates');
 assert.equal(patchUpdateMenuSource(next,'main'),next);
});
test('Windows title bar shows an independent Chinese update button',()=>{
 const source='(()=>{const mPe={help:"help"},Pir={help:{}};return [{id:mPe.help,message:Pir.help,mnemonic:`h`}]})()';
 const next=patchUpdateMenuSource(source,'renderer'),result=vm.runInNewContext(next);
 assert.equal(result.length,2);assert.equal(result[1].id,'codex-own-updates');assert.equal(result[1].message.defaultMessage,'更新');
 assert.equal(patchUpdateMenuSource(next,'renderer'),next);
});
test('changed upstream contracts fail closed instead of hiding the update entry',()=>{
 assert.throws(()=>patchUpdateMenuSource('return {}','main'),/contract changed/);
 assert.throws(()=>patchUpdateMenuSource('const menus=[]','renderer'),/contract changed/);
 assert.throws(()=>updateMenuChanges({listPackage:()=>[]},'fixture'),/assets changed/);
});
test('archive extraction uses native path separators on each platform',()=>{
 const main='.vite/build/main-fixture.js',renderer='webview/assets/app-initial-fixture.js';
 const sources=new Map([[main,'({[st.help]:t(st.help)})'],[renderer,'[{id:m.help,message:p.help,mnemonic:`h`}]']]);
 const changes=updateMenuChanges({listPackage:()=>[main,renderer].map(f=>'/'+f),extractFile:(_archive,file)=>{
  assert.equal(file,file.replaceAll('/',path.sep));
  const source=sources.get(file.replaceAll('\\','/'));assert.ok(source);return Buffer.from(source);
 }},'fixture');assert.equal(changes.size,2);
});
test('split Webpack chunks locate the actual menu contracts and qualified bindings',()=>{
 const main='.vite/build/early-bootstrap-620-hash.js',renderer='webview/assets/async/885910.hash.js';
 const sources=new Map([[main,'({[ea.JzA.help]:t(ea.JzA.help)})'],[renderer,'[{id:eK.JzA.help,message:e2.help,mnemonic:"h"}]'],['webview/assets/async/unrelated.js','const text="help";']]);
 const archive={listPackage:()=>[...sources.keys()],extractFile:(_a,p)=>Buffer.from(sources.get(p.replaceAll('\\','/')))};
 const changes=updateMenuChanges(archive,'fixture');assert.equal(changes.size,2);assert.match(changes.get(main).toString(),/"codex-own-updates"/);assert.match(changes.get(renderer).toString(),/codexOwn.updates/);
 for(const [file,data]of changes)sources.set(file,data.toString());assert.equal(updateMenuChanges(archive,'fixture').size,0);
});
