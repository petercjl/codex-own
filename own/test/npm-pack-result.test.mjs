import test from 'node:test';
import assert from 'node:assert/strict';
import {packResult} from '../ci/npm-pack-result.mjs';
const item={name:'@petercjl/codex-own',filename:'petercjl-codex-own-0.2.0.tgz',integrity:'sha512-fixture',size:202};
test('npm pack accepts npm 11 array and npm 12 name-keyed object',()=>{
  assert.deepEqual(packResult(JSON.stringify([item]),item.name),item);
  assert.deepEqual(packResult(JSON.stringify({[item.name]:item}),item.name),item);
  assert.throws(()=>packResult('{}',item.name),/Unexpected npm pack/);
  assert.throws(()=>packResult(JSON.stringify([{...item,name:'unrelated'}]),item.name),/Unexpected npm pack/);
});
