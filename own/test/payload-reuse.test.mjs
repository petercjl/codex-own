import test from 'node:test';
import assert from 'node:assert/strict';
import {trustedPayloads,preparePayload,planPayloadJobs} from '../ci/payload-reuse.mjs';
import {payloadURL,payloadVersion} from '../lib/npm-assets.mjs';
const sha='a'.repeat(64),part={sha256:sha,size:12,archiveSize:100,archiveSha256:'b'.repeat(64),url:payloadURL(sha)};
function fixture(){
 const previous={registry:{version:'1.0.0',integrity:'sha512-fixture'},manifest:{platforms:{'win32-x64':{size:12,parts:[part]}},runtimes:{platforms:{}},binding:{desktop:{identity:'desktop'},runtimes:{identity:'runtime'}}}};
 const plan={proof:{verified:true,registry:previous.registry,desktop:previous.manifest.binding.desktop,runtimes:previous.manifest.binding.runtimes}};
 return {previous,plan};
}
test('verified identical public blocks skip packing and retain archive integrity metadata',async()=>{
 const {previous,plan}=fixture();let packed=0;
 const r=await preparePayload({block:part,known:trustedPayloads(previous,plan),metadata:async version=>({name:'@petercjl/codex-own',version,dist:{tarball:part.url}}),prepare:async()=>{packed++;throw Error('must not pack');}});
 assert.equal(packed,0);assert.equal(r.published,false);assert.deepEqual(r.part,part);
});
test('missing proof, unknown blocks and missing public versions use ordinary verified packing',async()=>{
 const {previous,plan}=fixture();let packed=0;
 for(const known of [trustedPayloads(previous,{proof:{verified:false}}),new Map(),trustedPayloads(previous,plan)]){
  const r=await preparePayload({block:part,known,metadata:async()=>null,prepare:async()=>{packed++;return {published:true,part};}});assert.equal(r.published,true);
 }
 assert.equal(packed,3);
});
test('contradictory provenance, block size and registry identities fail before packing',async()=>{
 const {previous,plan}=fixture();assert.throws(()=>trustedPayloads(previous,{proof:{...plan.proof,registry:{version:'other'}}}),/provenance/);
 const known=trustedPayloads(previous,plan),prepare=async()=>{throw Error('packing must not run');};
 await assert.rejects(preparePayload({block:{...part,size:13},known,metadata:async()=>null,prepare}),/size mismatch/);
 for(const metadata of [{name:'other',version:payloadVersion(sha),dist:{tarball:part.url}},{name:'@petercjl/codex-own',version:'other',dist:{tarball:part.url}},{name:'@petercjl/codex-own',version:payloadVersion(sha),dist:{tarball:'https://example.com/bad'}}])await assert.rejects(preparePayload({block:part,known,metadata:async()=>metadata,prepare}),/identity mismatch/);
});

test('reused blocks do not consume submission windows or delay remaining new blocks',async()=>{
 const jobs=Array.from({length:54},(_,i)=>({platform:'win32-x64',block:{...part,sha256:i.toString(16).padStart(64,'0')}}));
 const known=new Map(jobs.slice(0,52).map(({block})=>[block.sha256,{...block,url:payloadURL(block.sha256)}]));
 const queue=await planPayloadJobs(jobs,known,async version=>({name:'@petercjl/codex-own',version,dist:{tarball:payloadURL(version.slice('0.0.0-payload.h'.length))}}));
 assert.equal(queue.reused.length,52);assert.deepEqual(queue.needed,jobs.slice(52));
});
