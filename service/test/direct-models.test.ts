import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import express from 'express';
import {randomBytes,createHash} from 'node:crypto';
import {initAuth} from '../auth.ts';
import {initGateway,validateModels,directModels} from '../gateway.ts';
import {initCompany,installCompany} from '../company.ts';

const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
test('Tuda direct models: identity, live configuration, leases, app boundaries and revocation',async t=>{
 const connectionString=process.env.CODEX_GATEWAY_TEST_DATABASE_URL||'postgresql://localhost:55432/project_lab';
 const schema='direct_test_'+randomBytes(8).toString('hex'),admin=new pg.Pool({connectionString});
 await admin.query('CREATE SCHEMA '+schema);
 const db=new pg.Pool({connectionString,options:'-c search_path='+schema});
 t.after(async()=>{await db.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();});
 await initAuth(db);await initGateway(db);await initCompany(db);
 await db.query("INSERT INTO auth_users(id,union_id,corp_id,name) VALUES('alice','union-alice','corp','Alice'),('bob','union-bob','corp','Bob'),('foreign','union-alice','other','Foreign')");
 let models=validateModels({model:'text/main',provider:{text:{wire_api:'responses',options:{baseURL:'https://models.example/v1',apiKey:'sk-private-fixture-key'},models:{main:{name:'Main'}}}}}),loads=0;
 const app=express();app.use(express.json());
 const apps=['tuda','codex-own','project-workbench'].map(id=>({id,name:id,corpId:'corp',organizationName:'Company',oauthStart:'/unused',identity:async()=>null}));
 installCompany(app,{db,origin:'https://auth.example',apps,loadModels:async()=>{loads++;return models;}});
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 t.after(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
 const origin='http://127.0.0.1:'+(server.address() as any).port;
 const call=(path:string,token:string,appId='tuda')=>fetch(origin+'/api/company/v1'+path,{headers:{authorization:'Bearer '+token,'x-company-app-id':appId}});
 async function grant(id:string,user='alice',appId='tuda'){
  const token='cdev_'+randomBytes(32).toString('base64url');
  await db.query("INSERT INTO company_sessions(id,token_hash,user_id,app_id,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 day')",[id,hash(token),user,appId]);return token;
 }
 const token=await grant('alice-tuda'),bob=await grant('bob-tuda','bob');
 const response=await call('/direct-models',token);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 const data=(await response.json()).data;
 assert.deepEqual(Object.keys(data).sort(),['contract','appId','sessionId','authenticated','expiresAt','member','organization','transport','subject','configVersion','model','provider'].sort());
 assert.equal(data.contract,2);assert.equal(data.appId,'tuda');assert.equal(data.authenticated,true);assert.equal(data.sessionId,'alice-tuda');assert.equal(data.member.id,'alice');assert(Date.parse(data.expiresAt)>Date.now());
 assert.equal(data.subject,hash(JSON.stringify(['corp','alice'])));
 assert.deepEqual({...data,appId:undefined,authenticated:undefined,sessionId:undefined,expiresAt:undefined,member:undefined,organization:undefined},{...directModels(models,data.subject),appId:undefined,authenticated:undefined,sessionId:undefined,expiresAt:undefined,member:undefined,organization:undefined});
 assert.equal(data.provider.text.options.apiKey,'sk-private-fixture-key');assert.equal(data.provider.text.options.baseURL,'https://models.example/v1');
 const leaseResponse=await call('/session',token);assert.equal(leaseResponse.headers.get('cache-control'),'no-store');
 const lease=(await leaseResponse.json()).data;assert.equal(lease.contract,1);assert.equal(lease.subject,data.subject);assert.equal(lease.configVersion,data.configVersion);assert.deepEqual(lease.authorization,{validForSeconds:300,refreshAfterSeconds:120});assert(!JSON.stringify(lease).includes('sk-private'));
 assert.notEqual((await(await call('/direct-models',bob)).json()).data.subject,data.subject);
 models=structuredClone(models);models.providers.text.options.apiKey='sk-rotated-fixture-key';
 const rotated=(await(await call('/session',token)).json()).data;assert.notEqual(rotated.configVersion,data.configVersion);assert.equal((await(await call('/direct-models',token)).json()).data.configVersion,rotated.configVersion);
 // Denials are checked before the private configuration is loaded.
 const before=loads;
 for(const appId of ['codex-own','project-workbench','unknown'])assert.equal((await call('/direct-models',token,appId)).status,403);
 for(const appId of ['codex-own','project-workbench']){
  const other=await grant(appId,'alice',appId);assert.equal((await call('/direct-models',other,appId)).status,403);
  const legacy=(await(await call('/session',other,appId)).json()).data;assert.equal(legacy.contract,1);assert(!Object.hasOwn(legacy,'authorization'));assert(!Object.hasOwn(legacy,'configVersion'));
 }
 const unknown=await grant('unknown','alice','unknown');assert.equal((await call('/direct-models',unknown,'unknown')).status,503);
 for(const value of ['cow_','csto_','cdev_'])assert.equal((await call('/direct-models',value+'x'.repeat(43))).status,401);
 const foreign=await grant('foreign','foreign');assert.equal((await call('/direct-models',foreign)).status,403);
 await db.query("INSERT INTO company_access(user_id,app_id,enabled) VALUES('alice','tuda',false)");
 for(const path of ['/session','/direct-models'])assert.equal((await call(path,token)).status,403);
 await db.query("UPDATE company_access SET enabled=true WHERE user_id='alice'");
 const child=await grant('board');
 await db.query("INSERT INTO company_session_parents VALUES('board',$1,'company')",[hash(await grant('parent','alice','codex-own'))]);
 assert.equal((await call('/direct-models',child)).status,403);
 const board=(await(await call('/session',child)).json()).data;assert(!Object.hasOwn(board,'authorization'));assert(!Object.hasOwn(board,'subject'));assert(!Object.hasOwn(board,'configVersion'));
 assert.equal(loads,before);
 const boardBootstrap=(await(await call('/bootstrap',child)).json()).data;assert.equal(boardBootstrap.profile,'board-only');assert.equal(boardBootstrap.text.enabled,false);assert.equal(loads,before);
 await db.query("UPDATE company_sessions SET expires_at=now()-interval '1 second' WHERE id='bob-tuda'");assert.equal((await call('/direct-models',bob)).status,401);
 await db.query("UPDATE company_sessions SET revoked_at=now() WHERE id='alice-tuda'");for(const path of ['/session','/direct-models'])assert.equal((await call(path,token)).status,401);
 assert.equal(loads,before);
});
