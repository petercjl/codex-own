import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {migrateOverlaySource} from '../builders/upgrade-updater.mjs';
test('historical overlay helpers migrate declarations without changing API policy or unrelated application code',()=>{
 const old='const __codexOwnApiMode=()=>globalThis.codexOwnProductPolicy?.contract===1&&globalThis.codexOwnProductPolicy.apiMode===true;';
 const source=old+'/* codex-own:api-detail-state-v1 */ const unrelated=true;',updated=migrateOverlaySource(source);
 assert.match(updated,/^var __codexOwnApiMode/);assert.match(updated,/const unrelated=true/);assert.equal(migrateOverlaySource(updated),updated);assert.equal(migrateOverlaySource(old),old);
 for(const apiMode of [true,false]){const c={codexOwnProductPolicy:{contract:1,apiMode}};vm.runInNewContext(updated+';this.value=__codexOwnApiMode()',c);assert.equal(c.value,apiMode);}
});
