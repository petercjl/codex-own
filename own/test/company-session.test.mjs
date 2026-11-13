import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),company=require('../lib/company-session.cjs');
test('protected company identity supports only a scoped Tuda handoff and never returns the source token',async()=>{
 const grant={origin:'https://company.example',token:'cow-private-fixture',expiresAt:new Date(Date.now()+60000).toISOString()};let active=grant,calls=0;
 const options={companyOrigin:grant.origin,readSession:async()=>active,fetch:async(url,request)=>{calls++;assert.equal(url,grant.origin+'/api/company/v1/handoff/issue');assert.equal(request.headers.authorization,'Bearer '+grant.token);assert.deepEqual(JSON.parse(request.body),{targetAppId:'tuda',verifierHash:'f'.repeat(64)});return new Response(JSON.stringify({ok:true,data:{contract:1,sourceAppId:'codex-own',targetAppId:'tuda',code:'a'.repeat(43),expiresIn:60}}));}};
 const identity=await company.invoke('/fixture','company.identity',{},options);assert(!JSON.stringify(identity).includes(grant.token));assert.match(identity.identity,/^[a-f0-9]{64}$/);
 const result=await company.invoke('/fixture','company.handoff',{identity:identity.identity,verifierHash:'f'.repeat(64)},options);assert.equal(result.targetAppId,'tuda');assert(!JSON.stringify(result).includes(grant.token));assert.equal(calls,1);
 await assert.rejects(company.invoke('/fixture','company.handoff',{identity:'wrong',verifierHash:'f'.repeat(64)},options),{code:'AUTH_REQUIRED'});assert.equal(calls,1);
 active=null;await assert.rejects(company.invoke('/fixture','company.identity',{},options),{code:'AUTH_REQUIRED'});
});
