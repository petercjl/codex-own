import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {checkUpdate,isNewer,prepareUpdate,readPrepared,applyPrepared,waitForExit,finishUpdate,restorePrepared} from '../lib/app-update.mjs';
import {payloadURL} from '../lib/npm-assets.mjs';
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
function fixture(t){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'own-update-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const p={root,manager:path.join(root,'manager'),platform:process.platform+'-'+process.arch};fs.mkdirSync(p.manager);
 fs.writeFileSync(path.join(p.manager,'state.json'),JSON.stringify({version:'0.2.2'}));
 const bytes=Buffer.from('verified desktop archive'),sha=digest(bytes);
 const asset={entry:p.platform==='darwin-arm64'?'codex-own.app':'app',size:bytes.length,sha256:sha,parts:[{sha256:sha,size:bytes.length,url:payloadURL(sha),archiveSha256:sha,archiveSize:bytes.length}]};
 const m={schema:2,repository:'petercjl/codex-own',version:'0.2.3',platforms:{[p.platform]:asset}};
 const opts={p,resolve:async()=>m.version,manifest:async()=>m,assemble:async(_asset,dest)=>fs.writeFileSync(dest,bytes,{flag:'wx'})};
 return {p,m,bytes,opts};
}
test('stable comparison handles multi-digit versions, no downgrade and invalid channels',()=>{
 assert.equal(isNewer('0.2.10','0.2.9'),true);assert.equal(isNewer('0.2.2','0.2.3'),false);assert.equal(isNewer('0.2.2','0.2.2'),false);assert.throws(()=>isNewer('0.3.0-next.1','0.2.2'),{code:'INVALID_VERSION'});
});
test('check validates platform and npm manifest; offline checks leave installation unchanged',async t=>{
 const a=fixture(t);assert.equal((await checkUpdate('0.2.2',a.opts)).updateAvailable,true);
 a.m.repository='openai/codex';await assert.rejects(checkUpdate('0.2.2',a.opts),{code:'INVALID_MANIFEST'});
 await assert.rejects(checkUpdate('0.2.2',{...a.opts,resolve:async()=>{throw Error('offline')}}),/offline/);
 assert.equal(JSON.parse(fs.readFileSync(path.join(a.p.manager,'state.json'))).version,'0.2.2');
});
test('download while app runs prepares a pinned verified receipt; apply passes expected current version',async t=>{
 const a=fixture(t);const result=await prepareUpdate('0.2.2',a.opts);const r=readPrepared(result.receipt,a.p);
 assert.equal(r.version,'0.2.3');assert.equal(fs.readFileSync(r.archive).toString(),a.bytes.toString());
 assert.equal(JSON.parse(fs.readFileSync(path.join(a.p.manager,'state.json'))).version,'0.2.2');
 const applied=await applyPrepared(result.receipt,{p:a.p,apply:async args=>args});assert.equal(applied.expectedCurrent,'0.2.2');assert.equal(applied.version,'0.2.3');
 assert.equal(fs.existsSync(path.join(a.p.manager,'operation.lock')),false);
});
test('tampered download never becomes ready and releases lock',async t=>{
 const a=fixture(t);await assert.rejects(prepareUpdate('0.2.2',{...a.opts,assemble:async(_a,d)=>fs.writeFileSync(d,'bad')}),{code:'CHECKSUM_MISMATCH'});
 assert.deepEqual(fs.readdirSync(path.join(a.p.manager,'prepared')),[]);assert.equal(fs.existsSync(path.join(a.p.manager,'operation.lock')),false);
});
test('ready update survives restart and rejects a modified cached archive',async t=>{
 const a=fixture(t),r=await prepareUpdate('0.2.2',a.opts);
 assert.equal((await restorePrepared('0.2.2',a.p)).receipt,r.receipt);assert.equal(await restorePrepared('0.2.3',a.p),null);
 fs.writeFileSync(path.join(path.dirname(r.receipt),'desktop.tar.gz'),'tampered');assert.equal(await restorePrepared('0.2.2',a.p),null);
});
test('unknown install and unexpected receipt paths are refused',async t=>{
 const a=fixture(t);await assert.rejects(prepareUpdate('0.2.1',a.opts),{code:'UNMANAGED_TARGET'});
 assert.throws(()=>readPrepared(path.join(a.p.root,'receipt.json'),a.p),{code:'UNSAFE_PATH'});
});
test('cancelled preparation removes staging files and releases the operation lock',async t=>{
 const a=fixture(t),controller=new AbortController();controller.abort();
 await assert.rejects(prepareUpdate('0.2.2',{...a.opts,signal:controller.signal,assemble:async(_a,_d,_c,_t,{signal})=>{assert.equal(signal.aborted,true);throw Object.assign(Error('cancelled'),{code:'CANCELLED'});}}),{code:'CANCELLED'});
 assert.equal(fs.existsSync(path.join(a.p.manager,'operation.lock')),false);assert.deepEqual(fs.readdirSync(path.join(a.p.manager,'prepared')),[]);
});
test('handoff waits for app exit and refuses to force-close running work',async()=>{
 let count=0;await waitForExit({isRunning:()=>++count<3?[42]:[],sleep:async()=>{},timeoutMs:1000});assert.equal(count,3);
 await assert.rejects(waitForExit({isRunning:()=>[42],timeoutMs:0}),{code:'APP_RUNNING'});
 let applied=false;await assert.rejects(finishUpdate('receipt',{wait:async()=>{throw Object.assign(Error('running'),{code:'APP_RUNNING'})},apply:async()=>{applied=true;}}),{code:'APP_RUNNING'});assert.equal(applied,false);
});
test('failed switch restarts retained version; successful switch reports launch failure separately',async()=>{
 let restarted=0;await assert.rejects(finishUpdate('r',{wait:async()=>{},apply:async()=>{throw Error('disk full')},restart:()=>{restarted++;}}),/disk full/);assert.equal(restarted,1);
 const r=await finishUpdate('r',{wait:async()=>{},apply:async()=>({ok:true,version:'0.2.3'}),restart:()=>{throw Error('launch')}});assert.equal(r.ok,true);assert.equal(r.restarted,false);
});
