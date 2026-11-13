import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),authorization=require('../lib/company-authorization.cjs');
test('authorization renews without forwarding model data and stops on expiry, revocation and logout',async t=>{
 const core=fs.mkdtempSync(path.join(os.tmpdir(),'own-authorization-'));t.after(()=>fs.rmSync(core,{recursive:true,force:true}));
 let time=Date.now(),mode='ok',calls=0;
 const session={origin:'https://company.example',token:'cow-fixture',subject:'employee',credentialFile:'direct-credentials-fixture.bin',expiresAt:new Date(time+3600000).toISOString()};
 const file=path.join(core,'managed-login.json');fs.writeFileSync(file,JSON.stringify({contract:2,active:true,...session}),{flag:'wx'});
 const gate=authorization.create({core,session,now:()=>time,fetch:async(url,options)=>{calls++;assert.equal(url,'https://company.example/api/codex-own/session');assert.equal(options.body,undefined);if(mode==='offline')throw Error('offline');if(mode==='revoked')return new Response('{}',{status:403});return new Response(JSON.stringify({ok:true,data:{authenticated:true,subject:session.subject,authorization:{validForSeconds:300,refreshAfterSeconds:120}}}));}});t.after(()=>gate.close());
 await gate.check();await gate.check();assert.equal(calls,1);time+=120001;mode='offline';await gate.check();assert.equal(gate.signal.aborted,false);time+=180000;await assert.rejects(gate.check(),{code:'AUTH_REQUIRED'});assert.equal(gate.signal.aborted,true);
 mode='ok';await gate.check();assert.equal(gate.signal.aborted,false,'Renewed permission resumes future requests after a network outage');
 const revoked=authorization.create({core,session,now:()=>time,fetch:async()=>new Response('{}',{status:403})});t.after(()=>revoked.close());await assert.rejects(revoked.check(),{code:'ACCESS_DENIED'});
 const loggedOut=authorization.create({core,session,fetch:async()=>{throw Error('must not call');}});t.after(()=>loggedOut.close());fs.writeFileSync(file,JSON.stringify({contract:2,active:false}));await assert.rejects(loggedOut.check(),{code:'AUTH_REQUIRED'});
});
