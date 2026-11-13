import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRegistryFetch,registrySources} from '../lib/registry-network.mjs';
import {verifiedDownload} from '../lib/network.mjs';
const canonical='https://registry.npmjs.org/@petercjl%2fcodex-own/latest';
const timeout=()=>Object.assign(Error('fetch failed'),{cause:{code:'UND_ERR_CONNECT_TIMEOUT'}});

test('healthy official source stays the canonical update route',async()=>{
 const seen=[],fetcher=createRegistryFetch(async(url,options)=>{seen.push(url);assert.equal(options.redirect,'manual');return Response.json({version:'0.6.14'});});
 assert.equal((await(await fetcher(canonical)).json()).version,'0.6.14');assert.deepEqual(seen,[canonical]);
});
test('official timeout falls back for both metadata and payload; successful route is reused',async()=>{
 const seen=[],fetcher=createRegistryFetch(async url=>{seen.push(url);if(url.startsWith(registrySources[0]))throw timeout();return Response.json({ok:true});});
 await fetcher(canonical);const payload='https://registry.npmjs.org/@petercjl/codex-own/-/codex-own-0.0.0-payload.habc.tgz';await fetcher(payload);
 assert.deepEqual(seen,[canonical,canonical.replace(registrySources[0],registrySources[1]),payload.replace(registrySources[0],registrySources[1])]);
});
test('bounded header timeout reaches mirror without waiting for the external deadline',async()=>{
 let attempts=0;const fetcher=createRegistryFetch(async(url,{signal})=>{
  attempts++;if(url.startsWith(registrySources[0]))return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));return new Response('ready');
 },{headerTimeoutMs:5});
 assert.equal(await(await fetcher(canonical)).text(),'ready');assert.equal(attempts,2);
});
test('header timeout is cleared while a response body is still downloading',async()=>{
 let requestSignal;const fetcher=createRegistryFetch(async(_url,{signal})=>{requestSignal=signal;return new Response('complete');},{headerTimeoutMs:5});
 const response=await fetcher(canonical);await new Promise(r=>setTimeout(r,15));assert.equal(requestSignal.aborted,false);assert.equal(await response.text(),'complete');
});
test('mirror missing an exact payload falls back to another source',async()=>{
 const seen=[],fetcher=createRegistryFetch(async url=>{seen.push(url);if(url.startsWith(registrySources[0]))throw timeout();return url.startsWith(registrySources[1])?new Response('',{status:404}):new Response('present');});
 assert.equal(await(await fetcher(canonical)).text(),'present');assert.equal(seen[2],registrySources[2]+'/@petercjl%2fcodex-own/latest');
});
test('allowlisted mirror CDN redirects retain HTTPS and caller cancellation',async()=>{
 const controller=new AbortController(),seen=[],fetcher=createRegistryFetch(async(url,{signal})=>{
  seen.push(url);assert.equal(signal.aborted,false);if(url.startsWith(registrySources[0]))throw timeout();return url.startsWith(registrySources[1])?new Response(null,{status:302,headers:{location:'https://cdn.npmmirror.com/packages/verified.tgz'}}):new Response('payload');
 });
 assert.equal(await(await fetcher(canonical,{signal:controller.signal})).text(),'payload');assert.equal(seen.at(-1),'https://cdn.npmmirror.com/packages/verified.tgz');
});
test('untrusted, HTTP and credential-bearing redirects are never requested',async()=>{
 for(const location of ['https://other.example/file','http://cdn.npmmirror.com/file','https://user:password@cdn.npmmirror.com/file']){
  const seen=[],fetcher=createRegistryFetch(async url=>{seen.push(url);return new Response(null,{status:302,headers:{location}});});
  await assert.rejects(fetcher(canonical),{code:'REGISTRY_NETWORK_UNAVAILABLE'});assert.deepEqual(seen,registrySources.map(source=>source+'/@petercjl%2fcodex-own/latest'));
 }
});
test('caller cancellation stops all source attempts',async()=>{
 const controller=new AbortController();let calls=0;
 const fetcher=createRegistryFetch(async()=>{calls++;controller.abort();throw timeout();});
 await assert.rejects(fetcher(canonical,{signal:controller.signal}),{name:'AbortError'});assert.equal(calls,1);
});
test('all failed routes return bounded structured diagnostics',async()=>{
 const fetcher=createRegistryFetch(async()=>{throw timeout();});
 await assert.rejects(fetcher(canonical),error=>error.code==='REGISTRY_NETWORK_UNAVAILABLE'&&error.attempts.length===3&&error.attempts.every(item=>item.code==='UND_ERR_CONNECT_TIMEOUT'));
});
test('private/authenticated requests, other packages and non-GET methods never use mirrors',async()=>{
 for(const [url,options]of [['https://example.com/account',{}],['https://registry.npmjs.org/private-package/latest',{}],[canonical,{headers:{authorization:'Bearer private'}}],[canonical,{headers:{cookie:'private'}}],[canonical,{method:'POST'}]]){
  let calls=0;const fetcher=createRegistryFetch(async(actual,forwarded)=>{calls++;assert.equal(actual,url);assert.deepEqual(forwarded,options);return new Response('unchanged');});
  await fetcher(url,options);assert.equal(calls,1);
 }
});
test('mirror transport never bypasses the published payload checksum',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'own-registry-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const fetcher=createRegistryFetch(async url=>{if(url.startsWith(registrySources[0]))throw timeout();return new Response('modified');});
 const dest=path.join(root,'part.tgz'),expected=Buffer.from('verified');
 await assert.rejects(verifiedDownload(canonical,dest,{size:expected.length,sha256:crypto.createHash('sha256').update(expected).digest('hex')},{fetcher,report:()=>{}}),{code:'CHECKSUM_MISMATCH'});
 assert.equal(fs.existsSync(dest),false);
});
