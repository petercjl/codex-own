import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {migrateOverlaySource,upgradedPreloadChanges} from '../builders/upgrade-updater.mjs';
test('historical overlay helpers migrate declarations without changing API policy or unrelated application code',()=>{
 const old='const __codexOwnApiMode=()=>globalThis.codexOwnProductPolicy?.contract===1&&globalThis.codexOwnProductPolicy.apiMode===true;';
 const source=old+'/* codex-own:api-detail-state-v1 */ const unrelated=true;',updated=migrateOverlaySource(source);
 assert.match(updated,/^var __codexOwnApiMode/);assert.match(updated,/const unrelated=true/);assert.equal(migrateOverlaySource(updated),updated);assert.equal(migrateOverlaySource(old),old);
 for(const apiMode of [true,false]){const c={codexOwnProductPolicy:{contract:1,apiMode}};vm.runInNewContext(updated+';this.value=__codexOwnApiMode()',c);assert.equal(c.value,apiMode);}
});
test('a published Windows preload is extracted through its host path and staged without losing prior changes',()=>{
 let reads=0;const asar={extractFile(archive,file){assert.equal(archive,'fixture.asar');assert.equal(file,'.vite\\build\\preload.js');reads++;return Buffer.from('const bridge={exposeInMainWorld(){}};');}};
 const changes=upgradedPreloadChanges(asar,'fixture.asar',{separator:'\\'});const file='.vite/build/preload.js';assert(changes.get(file).toString().includes('codexOwnProductPolicy'));assert.equal(reads,1);
 const again=upgradedPreloadChanges(asar,'fixture.asar',{separator:'\\',priorChanges:changes});assert.equal(again.size,0);assert.equal(reads,1);
});
