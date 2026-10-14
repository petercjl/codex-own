import test from 'node:test';
import assert from 'node:assert/strict';
import {mapLimited,npmAuthFailure} from '../ci/publication-pool.mjs';
test('publication pool bounds concurrency and preserves manifest order',async()=>{
  let active=0,peak=0;
  const result=await mapLimited([0,1,2,3,4,5],4,async n=>{
    active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,(6-n)*3));active--;return 'payload-'+n;
  });
  assert.equal(peak,4);assert.equal(active,0);
  assert.deepEqual(result,['payload-0','payload-1','payload-2','payload-3','payload-4','payload-5']);
});
test('failed publication stops new submissions and drains already active operations',async()=>{
  const finished=[],started=[];
  await assert.rejects(mapLimited([0,1,2,3,4,5],3,async n=>{
    started.push(n);
    if(n===0){await new Promise(r=>setTimeout(r,3));throw Error('registry refused');}
    await new Promise(r=>setTimeout(r,20));finished.push(n);
  }),/registry refused/);
  assert.deepEqual(started,[0,1,2]);assert.deepEqual(finished,[1,2]);
  await assert.rejects(mapLimited([1],5,async()=>1),/concurrency/);
});
test('npm authentication failures fail promptly instead of waiting for package scanning',()=>{
  for(const code of ['EOTP','ENEEDAUTH','E401','E403'])assert.equal(npmAuthFailure({stderr:`npm error code ${code}`}),code);
  assert.equal(npmAuthFailure({stderr:'npm error ECONNRESET'}),null);
});
