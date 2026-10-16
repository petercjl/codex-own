import test from 'node:test';
import assert from 'node:assert/strict';
import {mapLimited,npmAuthFailure,mapPublicationWindows,npmPendingFailure,submitPayload} from '../ci/publication-pool.mjs';
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
test('publication windows wait for registry visibility before accepting more than twenty payloads',async()=>{
  let pending=0,peak=0,settlements=0;
  const result=await mapPublicationWindows(Array.from({length:45},(_,i)=>i),async i=>{pending++;peak=Math.max(peak,pending);return i;},async()=>{assert.ok(pending<=20);pending=0;settlements++;});
  assert.equal(peak,20);assert.equal(settlements,3);assert.equal(pending,0);assert.deepEqual(result,Array.from({length:45},(_,i)=>i));
  await assert.rejects(mapPublicationWindows([],async()=>{},async()=>{},{window:25}),/window/);
});
const capacity=()=>({stderr:'npm error code E409\nnpm error 409 Conflict - Too many pending publishes for @example/app (limit: 25). Wait for existing publishes to finish, then retry.'});
const staged=()=>({stderr:'npm error code E409\nnpm error 409 Conflict - Cannot publish over previously staged version "1.0.0".'});
test('npm processing conflicts distinguish accepted versions from unaccepted capacity failures',()=>{
  assert.equal(npmPendingFailure(staged()),'accepted');assert.equal(npmPendingFailure(capacity()),'capacity');assert.equal(npmPendingFailure({stderr:'npm error code E409 unknown conflict'}),null);
});
test('capacity backpressure retries the same payload after waiting and existing accepted versions are not resubmitted',async()=>{
  let attempts=0,waits=0,time=0;
  await submitPayload(async()=>{if(++attempts<3)throw capacity();},{now:()=>time,sleep:async ms=>{waits++;time+=ms;}});
  assert.equal(attempts,3);assert.equal(waits,2);
  attempts=0;
  await submitPayload(async()=>{attempts++;throw staged();},{sleep:async()=>assert.fail('accepted payload must wait for visibility rather than resubmit')});
  assert.equal(attempts,1);
});
test('capacity timeouts, authentication errors and unknown upload failures cannot promote the main release',async()=>{
  let time=0;
  await assert.rejects(submitPayload(async()=>{throw capacity();},{now:()=>time,sleep:async ms=>{time+=ms;},timeoutMs:30000}),{code:'NPM_PROCESSING_PENDING'});
  await assert.rejects(submitPayload(async()=>{throw {stderr:'npm error code EOTP'};}),{code:'NPM_PUBLISH_AUTH_FAILED'});
  const error=Error('unexpected registry failure');await assert.rejects(submitPayload(async()=>{throw error;}),e=>e===error);
  let settlements=0;await assert.rejects(mapPublicationWindows([1,2,3],async()=>{throw error;},async()=>{settlements++;}),e=>e===error);assert.equal(settlements,0);
});
