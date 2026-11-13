import test from "node:test";import assert from "node:assert/strict";import pg from "pg";import express from "express";import {randomBytes} from "node:crypto";
import {initAuth,installOAuth,authorizeUrl,safeReturn,safeAvatarUrl} from "../auth.ts";
test("OAuth fixes enterprise scopes and confines post-login destinations",()=>{
 const url=new URL(authorizeUrl({origin:"https://service.example",clientId:"app",clientSecret:"private",corpId:"company",adminUnionId:"owner"},"state"));
 assert.equal(url.searchParams.get("scope"),"openid corpid");assert.equal(url.searchParams.get("redirect_uri"),"https://service.example/api/auth/dingtalk/callback");assert(!url.href.includes("private"));
 for(const value of ["//foreign.example","https://foreign.example","/api/projects","/api/codex-own/admin/../elsewhere"])assert.equal(safeReturn(value),"/");
 assert.equal(safeReturn("/api/codex-own/admin"),"/api/codex-own/admin");
});
test("independent PostgreSQL sessions: corporate OAuth, browser binding, replay and administrator selection",async t=>{
 const schema="cow_auth_test_"+randomBytes(8).toString("hex"),connectionString=process.env.CODEX_GATEWAY_TEST_DATABASE_URL||"postgresql://localhost:55432/project_lab",admin=new pg.Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);
 const db=new pg.Pool({connectionString,options:"-c search_path="+schema});t.after(async()=>{await db.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});// Simulate a pre-avatar database, including a persisted employee.
 await db.query("CREATE TABLE auth_users(id text PRIMARY KEY,union_id text UNIQUE NOT NULL,open_id text,corp_id text NOT NULL,name text NOT NULL,system_role text NOT NULL DEFAULT 'member')");
 await db.query("INSERT INTO auth_users VALUES('existing','owner','open','company','旧名','admin')");
 await initAuth(db);await initAuth(db);assert.equal((await db.query("SELECT avatar_url FROM auth_users WHERE id='existing'")).rows[0].avatar_url,null);
 const app=express(),config={origin:"",clientId:"app",clientSecret:"private-app-secret",corpId:"company",adminUnionId:"owner",allowHttp:true};let foreign=false,exchanges=0,avatar:unknown="https://static.dingtalk.example/avatar.png",nick="管理员";
 const identity=installOAuth(app,{db,config,fetchApi:(async(url:any,opts:any)=>{
  if(String(url).endsWith("userAccessToken")){exchanges++;assert.equal(JSON.parse(opts.body).clientSecret,config.clientSecret);return new Response(JSON.stringify({accessToken:"provider-token",corpId:foreign?"other":"company"}));}
  return new Response(JSON.stringify({unionId:"owner",openId:"open",nick,avatarUrl:avatar}));
 }) as typeof fetch});
 app.get("/identity",async(req,res)=>res.json(await identity(req)));
 const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));config.origin="http://127.0.0.1:"+(server.address() as any).port;t.after(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
 const start=()=>fetch(config.origin+"/api/auth/dingtalk/start?returnTo="+encodeURIComponent("/api/codex-own/admin"),{redirect:"manual"});
 let response=await start(),state=new URL(response.headers.get("location")!).searchParams.get("state")!,cookie=response.headers.get("set-cookie")!.split(";")[0];
 assert(response.headers.get("set-cookie")!.includes("HttpOnly"));
 const callback=()=>fetch(config.origin+"/api/auth/dingtalk/callback?code=provider-code&state="+state,{headers:{cookie},redirect:"manual"});
 assert.equal((await fetch(config.origin+"/api/auth/dingtalk/callback?code=provider-code&state="+state,{redirect:"manual"})).status,401);assert.equal(exchanges,0);
 response=await callback();assert.equal(response.status,302);assert.equal(response.headers.get("location"),"/api/codex-own/admin");const sessionCookie=response.headers.get("set-cookie")!.match(/codex_own_browser=([^;]+)/)![0];
 const user=await(await fetch(config.origin+"/identity",{headers:{cookie:sessionCookie}})).json();assert.equal(user.systemRole,"admin");assert.equal(user.corpId,"company");assert.equal(user.id,"existing");assert.equal(user.avatarUrl,avatar);
 const rows=await db.query("SELECT * FROM auth_sessions");assert(!JSON.stringify(rows.rows).includes(sessionCookie.split("=")[1]));
 assert.equal((await callback()).status,401);assert.equal(exchanges,1);
 // An actual new OAuth exchange refreshes the same employee; invalid/missing avatars stay optional.
 for(const value of ["https://static.dingtalk.example/new.png","javascript:alert(1)",undefined]){
  avatar=value;nick="新姓名";response=await start();state=new URL(response.headers.get("location")!).searchParams.get("state")!;cookie=response.headers.get("set-cookie")!.split(";")[0];assert.equal((await callback()).status,302);
  const refreshed=await(await fetch(config.origin+"/identity",{headers:{cookie:sessionCookie}})).json();assert.equal(refreshed.id,user.id);assert.equal(refreshed.name,nick);assert.equal(refreshed.avatarUrl,safeAvatarUrl(value)||null);
 }
 const sessionsBefore=(await db.query("SELECT count(*) FROM auth_sessions")).rows[0].count;
 foreign=true;response=await start();state=new URL(response.headers.get("location")!).searchParams.get("state")!;cookie=response.headers.get("set-cookie")!.split(";")[0];assert.equal((await callback()).status,401);
 assert.equal((await db.query("SELECT count(*) FROM auth_sessions")).rows[0].count,sessionsBefore);
});

test("avatar URLs accept HTTPS and reject malformed or executable values",()=>{
 assert.equal(safeAvatarUrl("https://static.dingtalk.example/a.png?size=80"),"https://static.dingtalk.example/a.png?size=80");
 for(const value of [null,undefined,{},"","http://example.com/a","//example.com/a","javascript:alert(1)","data:image/svg+xml,x","https://user:secret@example.com/a","https:///example.com/a","https://example.com/\nimage","https://example.com/"+"a".repeat(2048),"https://[bad"])assert.equal(safeAvatarUrl(value),undefined,String(value));
});
