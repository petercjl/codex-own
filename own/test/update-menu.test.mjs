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
