import type {Express,Request,Response} from 'express';
import type {Pool} from 'pg';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {Readable} from 'node:stream';import {pipeline} from 'node:stream/promises';
import {employeeImage,organizationId} from './image.ts';
import {safeAvatarUrl} from './auth.ts';
import {directModels,type Identity,type validateModels} from './gateway.ts';
const prefix='/api/company/v1',random=()=>randomBytes(32).toString('base64url'),hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const eq=(a:string,b:string)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const opaque=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
class Fault extends Error{constructor(public code:string,public status=400){super(code);}}
export const companyRateLimits=Object.freeze({publicPerMinute:150,nasIntrospectionPerMinute:6000});
// These counters only meter requests. Authorization results are never cached.
export function companyLimiter(now=Date.now){
 const hits=new Map<string,{until:number,count:number}>();
 return (key:string,maximum:number,scope:string)=>{
  const time=now();if(hits.size>10000)for(const [k,v]of hits)if(v.until<time)hits.delete(k);
  let h=hits.get(key);if(!h||h.until<=time){h={until:time+60000,count:0};hits.set(key,h);}
  if(++h.count>maximum||hits.size>20000){if(h.count===maximum+1)console.warn(JSON.stringify({event:'company_rate_limited',scope,limit:maximum,windowSeconds:60}));throw new Fault('RATE_LIMIT',429);}
 };
}
export type CompanyApp={id:string;name:string;corpId:string;organizationName:string;oauthStart:string;identity:(req:Request)=>Promise<Identity|null>};
export type CompanyOptions={db:Pool;origin:string;apps:CompanyApp[];loadModels:()=>Promise<ReturnType<typeof validateModels>>;imageFile?:string;fetchApi?:typeof fetch;nas?:{organizationId:string;serviceToken:string;audience:string}};
export async function initCompany(db:Pool){
 await db.query(`CREATE TABLE IF NOT EXISTS company_access(user_id text REFERENCES auth_users(id) ON DELETE CASCADE,app_id text NOT NULL,enabled boolean NOT NULL DEFAULT true,storage_scopes text[] NOT NULL DEFAULT '{}',PRIMARY KEY(user_id,app_id))`);
 await db.query(`CREATE TABLE IF NOT EXISTS company_requests(id text PRIMARY KEY,app_id text NOT NULL,verifier_hash char(64) NOT NULL,user_id text REFERENCES auth_users(id) ON DELETE CASCADE,approval_user_id text REFERENCES auth_users(id) ON DELETE CASCADE,approval_hash char(64),approved boolean NOT NULL DEFAULT false,expires_at timestamptz NOT NULL)`);
 await db.query(`CREATE TABLE IF NOT EXISTS company_sessions(id text PRIMARY KEY,token_hash char(64) UNIQUE NOT NULL,user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,app_id text NOT NULL,expires_at timestamptz NOT NULL,revoked_at timestamptz)`);
 await db.query(`CREATE TABLE IF NOT EXISTS company_storage(token_hash char(64) PRIMARY KEY,session_id text NOT NULL REFERENCES company_sessions(id) ON DELETE CASCADE,audience text NOT NULL,scopes text[] NOT NULL,expires_at timestamptz NOT NULL)`);
 await db.query(`CREATE TABLE IF NOT EXISTS company_handoffs(code_hash char(64) PRIMARY KEY,verifier_hash char(64) NOT NULL,parent_hash char(64) NOT NULL,parent_kind text NOT NULL,user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,expires_at timestamptz NOT NULL)`);
 await db.query(`CREATE TABLE IF NOT EXISTS company_session_parents(session_id text PRIMARY KEY REFERENCES company_sessions(id) ON DELETE CASCADE,parent_hash char(64) NOT NULL,parent_kind text NOT NULL)`);
 await db.query('DELETE FROM company_handoffs WHERE expires_at<=now()');
 await db.query('DELETE FROM company_requests WHERE expires_at<=now()');await db.query('DELETE FROM company_storage WHERE expires_at<=now()');
}
export function installCompany(app:Express,options:CompanyOptions){
 const {db,origin,apps,loadModels,imageFile,nas,fetchApi=fetch}=options;
 const registry=new Map(apps.map(a=>[a.id,a])),limit=companyLimiter(),active=new Map<string,number>();let total=0;
 function application(id:unknown){const a=registry.get(String(id));if(!a)throw new Fault('APP_NOT_CONFIGURED',503);return a;}
 const publicLimit=(req:Request)=>limit('public:'+(req.ip||'unknown'),companyRateLimits.publicPerMinute,'public');
 const route=(method:'get'|'post',suffix:string,fn:(req:Request,res:Response)=>Promise<any>)=>app[method](prefix+suffix,async(req,res)=>{
  res.set({'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'});
  try{if(suffix!=='/storage/introspect')publicLimit(req);await fn(req,res);}catch(e){if(res.headersSent){res.destroy();return;}const f=e instanceof Fault?e:new Fault('SERVICE_FAILED',502);if(f.status===429)res.set('retry-after','60');res.status(f.status).json({ok:false,error:{code:f.code,message:'请求未完成，请检查登录状态或联系管理员'}});}
 });
 async function allowed(a:CompanyApp,user:Identity|null){
  if(!user)throw new Fault('AUTH_REQUIRED',401);if(user.corpId!==a.corpId)throw new Fault('ACCESS_DENIED',403);
  const access=await db.query('SELECT enabled,storage_scopes FROM company_access WHERE user_id=$1 AND app_id=$2',[user.id,a.id]);
  const legacy=a.id==='codex-own'?await db.query('SELECT enabled FROM codex_own_access WHERE user_id=$1',[user.id]):null;
  if(access.rows[0]?.enabled===false||legacy?.rows[0]?.enabled===false)throw new Fault('ACCESS_DENIED',403);
  return {user,scopes:access.rows[0]?.storage_scopes||[]};
 }
 async function session(req:Request){
  const token=String(req.headers.authorization||'').replace(/^Bearer /,'');if(!/^cdev_[A-Za-z0-9_-]{43}$/.test(token))throw new Fault('AUTH_REQUIRED',401);
  const found=await db.query(`SELECT s.id AS session_id,s.app_id,s.expires_at,u.id,u.name,u.avatar_url AS "avatarUrl",u.corp_id AS "corpId",u.union_id,u.system_role AS "systemRole" FROM company_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND s.revoked_at IS NULL`,[hash(token)]);
  const s=found.rows[0];if(!s)throw new Fault('AUTH_REQUIRED',401);if(req.headers['x-company-app-id']!==s.app_id)throw new Fault('APP_MISMATCH',403);
  const parents=await db.query('SELECT * FROM company_session_parents WHERE session_id=$1',[s.session_id]);
  if(parents.rows[0])await parent(parents.rows[0].parent_hash,parents.rows[0].parent_kind,s.id);
  const a=application(s.app_id),access=await allowed(a,s);return {...access,a,record:s,boardOnly:!!parents.rows[0]};
 }
 async function parent(tokenHash:string,kind:string,userId?:string){
  if(!['legacy','company'].includes(kind))throw new Fault('AUTH_REQUIRED',401);
  const table=kind==='legacy'?'codex_own_tokens':'company_sessions';
  const found=await db.query(`SELECT u.id,u.name,u.avatar_url AS "avatarUrl",u.corp_id AS "corpId",u.system_role AS "systemRole",t.expires_at FROM ${table} t JOIN auth_users u ON u.id=t.user_id WHERE t.token_hash=$1 AND t.revoked_at IS NULL AND t.expires_at>now()${kind==='company'?" AND t.app_id='codex-own'":''}`,[tokenHash]);
  const user=found.rows[0];if(!user||userId&&user.id!==userId)throw new Fault('AUTH_REQUIRED',401);
  await allowed(application('codex-own'),user);await allowed(application('tuda'),user);return user;
 }
 const member=(user:Identity)=>{const avatarUrl=safeAvatarUrl(user.avatarUrl);return {id:user.id,name:user.name,...(avatarUrl?{avatarUrl}:{})};};
 const shape=(s:any)=>({contract:1,appId:s.a.id,authenticated:true,sessionId:s.record.session_id,expiresAt:new Date(s.record.expires_at).toISOString(),member:member(s.user),organization:{id:organizationId(s.a.corpId),name:s.a.organizationName}});
 const ok=(res:Response,data:any)=>res.json({ok:true,data});
 const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const html=(res:Response,body:string)=>{res.set('referrer-policy','same-origin');res.set('content-security-policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");res.type('html').send('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>东轩AI授权</title><body style="font:16px system-ui;max-width:620px;margin:10vh auto;padding:24px">'+body+'</body></html>');};
 // Fixed codex-own -> Tuda integration. The receiver owns the PKCE verifier;
 // only an opaque, short-lived code crosses the desktop boundary.
 route('post','/handoff/issue',async(req,res)=>{
  if(req.body?.targetAppId!=='tuda'||req.headers['x-company-app-id']!=='codex-own'||! /^[a-f0-9]{64}$/.test(req.body?.verifierHash))throw new Fault('AUTH_REQUEST_INVALID',403);
  const token=String(req.headers.authorization||'').replace(/^Bearer /,'');
  const kind=/^cow_[A-Za-z0-9_-]{43}$/.test(token)?'legacy':/^cdev_[A-Za-z0-9_-]{43}$/.test(token)?'company':null;
  if(!kind)throw new Fault('AUTH_REQUIRED',401);
  const tokenHash=hash(token),user=await parent(tokenHash,kind),code=random();
  await db.query("INSERT INTO company_handoffs VALUES($1,$2,$3,$4,$5,now()+interval '60 seconds')",[hash(code),req.body.verifierHash,tokenHash,kind,user.id]);
  ok(res,{contract:1,sourceAppId:'codex-own',targetAppId:'tuda',code,expiresIn:60});
 });
 route('post','/handoff/exchange',async(req,res)=>{
  if(req.headers.authorization||req.headers['x-company-app-id']!=='tuda'||req.body?.appId!=='tuda'||!opaque(req.body?.code)||!opaque(req.body?.verifier))throw new Fault('AUTH_REQUEST_INVALID',403);
  const client=await db.connect();try{
   await client.query('BEGIN');
   const found=await client.query('SELECT * FROM company_handoffs WHERE code_hash=$1 AND expires_at>now() FOR UPDATE',[hash(req.body.code)]),r=found.rows[0];
   if(!r)throw new Fault('AUTH_REQUEST_EXPIRED',410);
   if(!eq(r.verifier_hash,hash(req.body.verifier)))throw new Fault('AUTH_REQUEST_INVALID',403);
   const user=await parent(r.parent_hash,r.parent_kind,r.user_id),token='cdev_'+random(),sessionId=random(),expiresAt=new Date(Math.min(Date.now()+7*86400000,new Date(user.expires_at).getTime())).toISOString();
   await client.query('INSERT INTO company_sessions(id,token_hash,user_id,app_id,expires_at) VALUES($1,$2,$3,$4,$5)',[sessionId,hash(token),user.id,'tuda',expiresAt]);
   await client.query('INSERT INTO company_session_parents VALUES($1,$2,$3)',[sessionId,r.parent_hash,r.parent_kind]);
   await client.query('DELETE FROM company_handoffs WHERE code_hash=$1',[hash(req.body.code)]);await client.query('COMMIT');
   const a=application('tuda');ok(res,{contract:1,appId:'tuda',status:'authorized',token,sessionId,expiresAt,member:member(user),organization:{id:organizationId(a.corpId),name:a.organizationName}});
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 });
 route('post','/auth/start',async(req,res)=>{
  const a=application(req.body?.appId);if(!/^[a-f0-9]{64}$/.test(req.body?.verifierHash))throw new Fault('AUTH_REQUEST_INVALID',403);
  const id=random();await db.query("INSERT INTO company_requests(id,app_id,verifier_hash,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')",[id,a.id,req.body.verifierHash]);
  ok(res,{contract:1,appId:a.id,requestId:id,verificationUrl:origin+prefix+'/auth/authorize?request='+id+(req.body?.refreshProfile===true?'&refreshProfile=1':''),userCode:id.slice(0,8).toUpperCase(),expiresIn:600,intervalMs:2000});
 });
 async function authorization(req:Request,id:unknown){
  if(!opaque(id))throw new Fault('AUTH_REQUEST_EXPIRED',410);
  const found=await db.query('SELECT * FROM company_requests WHERE id=$1 AND expires_at>now()',[id]);if(!found.rows[0])throw new Fault('AUTH_REQUEST_EXPIRED',410);
  const a=application(found.rows[0].app_id),identity=await a.identity(req);return {request:found.rows[0],a,identity};
 }
 route('get','/auth/authorize',async(req,res)=>{
  const {request:r,a,identity}=await authorization(req,req.query.request);
  if(!identity||req.query.refreshProfile==='1'){res.redirect(a.oauthStart+'?returnTo='+encodeURIComponent(prefix+'/auth/authorize?request='+r.id));return;}
  const {user}=await allowed(a,identity),nonce=random();
  const changed=await db.query('UPDATE company_requests SET approval_user_id=$2,approval_hash=$3 WHERE id=$1 AND approved=false RETURNING id',[r.id,user.id,hash(nonce)]);if(!changed.rowCount)throw new Fault('AUTH_REQUEST_EXPIRED',410);
  html(res,`<h1>东轩AI授权</h1><p>申请应用：<strong>${escape(a.name)}</strong></p><p>当前账号：${escape(user.name)}</p><p>请核对应用中的校验码 <strong>${escape(r.id.slice(0,8).toUpperCase())}</strong>，确认本次登录由你发起。</p><form method="post"><input type="hidden" name="request" value="${r.id}"><input type="hidden" name="nonce" value="${nonce}"><button>确认授权</button></form><p><a href="${escape(a.oauthStart+'?returnTo='+encodeURIComponent(prefix+'/auth/authorize?request='+r.id))}">刷新钉钉姓名与头像</a></p>`);
 });
 route('post','/auth/authorize',async(req,res)=>{
  if(req.headers.origin&&req.headers.origin!==origin)throw new Fault('ORIGIN',403);
  const {request:r,a,identity}=await authorization(req,req.body?.request),{user}=await allowed(a,identity);
  if(!opaque(req.body?.nonce))throw new Fault('AUTH_REQUEST_INVALID',403);
  const found=await db.query('UPDATE company_requests SET approved=true,user_id=$2,approval_hash=NULL WHERE id=$1 AND approval_user_id=$2 AND approval_hash=$3 AND approved=false AND expires_at>now() RETURNING id',[r.id,user.id,hash(req.body.nonce)]);if(!found.rowCount)throw new Fault('AUTH_REQUEST_INVALID',403);
  html(res,'<h1>东轩AI授权成功</h1><p>可以关闭本页并返回应用。</p>');
 });
 route('post','/auth/poll',async(req,res)=>{
  const a=application(req.body?.appId),id=req.body?.requestId,verifier=req.body?.verifier;if(!opaque(id)||!opaque(verifier))throw new Fault('AUTH_REQUEST_INVALID',403);
  const client=await db.connect();try{
   await client.query('BEGIN');const found=await client.query('SELECT * FROM company_requests WHERE id=$1 FOR UPDATE',[id]),r=found.rows[0];
   if(!r||new Date(r.expires_at).getTime()<=Date.now())throw new Fault('AUTH_REQUEST_EXPIRED',410);if(r.app_id!==a.id)throw new Fault('APP_MISMATCH',403);if(!eq(r.verifier_hash,hash(verifier)))throw new Fault('AUTH_REQUEST_INVALID',403);
   if(!r.approved){await client.query('COMMIT');res.status(202);ok(res,{contract:1,appId:a.id,status:'pending'});return;}
   const users=await client.query('SELECT id,name,avatar_url AS "avatarUrl",corp_id AS "corpId",system_role AS "systemRole" FROM auth_users WHERE id=$1',[r.user_id]),{user}=await allowed(a,users.rows[0]||null);
   const token='cdev_'+random(),sessionId=random(),expiresAt=new Date(Date.now()+7*86400000).toISOString();
   await client.query('INSERT INTO company_sessions(id,token_hash,user_id,app_id,expires_at) VALUES($1,$2,$3,$4,$5)',[sessionId,hash(token),user.id,a.id,expiresAt]);await client.query('DELETE FROM company_requests WHERE id=$1',[id]);await client.query('COMMIT');
   ok(res,{contract:1,appId:a.id,status:'authorized',token,sessionId,expiresAt,member:member(user),organization:{id:organizationId(a.corpId),name:a.organizationName}});
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 });
 route('get','/session',async(req,res)=>{
  const s=await session(req);
  // Only independent Tuda sessions receive a direct-model authorization lease.
  const authorization=s.a.id==='tuda'&&!s.boardOnly?{subject:hash(JSON.stringify([s.user.corpId,s.user.id])),configVersion:hash(JSON.stringify(await loadModels())),authorization:{validForSeconds:300,refreshAfterSeconds:120}}:{};
  ok(res,{...shape(s),...authorization});
 });
 route('get','/direct-models',async(req,res)=>{
  const s=await session(req);
  if(s.a.id!=='tuda'||s.boardOnly)throw new Fault('SCOPE_DENIED',403);
  ok(res,{...shape(s),...directModels(await loadModels(),hash(JSON.stringify([s.user.corpId,s.user.id])))});
 });
 route('post','/logout',async(req,res)=>{const s=await session(req);await db.query('UPDATE company_sessions SET revoked_at=now() WHERE id=$1',[s.record.session_id]);ok(res,{contract:1,appId:s.a.id,revoked:true});});
 route('get','/bootstrap',async(req,res)=>{
  const s=await session(req);
  const storage=nas&&s.a.id==='tuda'&&nas.organizationId===organizationId(s.a.corpId)?(s.scopes.length?{enabled:true,audience:nas.audience,scopes:s.scopes}:{enabled:false,reason:'STORAGE_NOT_GRANTED'}):{enabled:false,reason:'STORAGE_NOT_CONFIGURED'};
  if(s.boardOnly){ok(res,{...shape(s),profile:'board-only',configVersion:hash(JSON.stringify(['board-only',storage,member(s.user)])),member:{...member(s.user),role:s.user.systemRole},text:{enabled:false,reason:'BOARD_ONLY_SESSION',defaultModel:null,providers:[]},image:{enabled:false,reason:'BOARD_ONLY_SESSION',models:[]},storage});return;}
  const models=await loadModels(),image=await employeeImage(imageFile,s.a.corpId,s.record.union_id);
  const providers=Object.entries(models.providers).map(([id,p]:[string,any])=>({id,name:p.name,protocol:p.protocol==='anthropic'?'anthropic-messages':p.protocol==='chat'?'openai-chat-completions':'openai-responses',baseUrl:origin+prefix+'/proxy/'+s.a.id+'/'+id+'/v1',models:Object.entries(p.models).map(([id,m]:[string,any])=>({id,name:m.name,contextWindow:m.limit.context,maxOutputTokens:m.limit.output,reasoning:m.reasoning}))}));
  const configVersion=hash(JSON.stringify([models,image,storage,member(s.user)]));ok(res,{...shape(s),configVersion,member:{...member(s.user),role:s.user.systemRole},text:{enabled:true,defaultModel:models.model,providers},image,storage});
 });
 const scopes=['boards:read','boards:write','assets:read','assets:write'];
 route('post','/storage/token',async(req,res)=>{
  const s=await session(req),requested=req.body?.scopes;
  if(!nas||s.a.id!=='tuda'||nas.organizationId!==organizationId(s.a.corpId)||req.body?.audience!==nas.audience)throw new Fault('STORAGE_NOT_GRANTED',403);
  if(!Array.isArray(requested)||!requested.length||!requested.every(v=>scopes.includes(v)&&s.scopes.includes(v)))throw new Fault('SCOPE_DENIED',403);
  const token='csto_'+random(),expiresAt=new Date(Math.min(Date.now()+300000,new Date(s.record.expires_at).getTime())).toISOString();
  await db.query('INSERT INTO company_storage VALUES($1,$2,$3,$4,$5)',[hash(token),s.record.session_id,nas.audience,[...new Set(requested)],expiresAt]);ok(res,{contract:1,appId:s.a.id,tokenType:'Bearer',token,audience:nas.audience,expiresAt,organizationId:organizationId(s.a.corpId),memberId:s.user.id,scopes:[...new Set(requested)]});
 });
 route('post','/storage/introspect',async(req,res)=>{
  const auth=String(req.headers.authorization||'');if(!nas||nas.serviceToken.length<32||!eq(hash(auth),hash('Bearer '+nas.serviceToken))){publicLimit(req);throw new Fault('AUTH_REQUIRED',401);}
  limit('nas:'+nas.organizationId+':'+nas.audience,companyRateLimits.nasIntrospectionPerMinute,'nas-introspection');
  const token=req.body?.token;if(typeof token!=='string'||!/^csto_[A-Za-z0-9_-]{43}$/.test(token)){ok(res,{contract:1,active:false});return;}
  const found=await db.query(`SELECT t.*,s.app_id,s.user_id,s.revoked_at,s.expires_at AS parent_expires,u.corp_id AS "corpId",u.name,u.id,u.system_role AS "systemRole" FROM company_storage t JOIN company_sessions s ON s.id=t.session_id JOIN auth_users u ON u.id=s.user_id WHERE t.token_hash=$1 AND t.expires_at>now() AND s.expires_at>now() AND s.revoked_at IS NULL`,[hash(token)]),r=found.rows[0];
  if(!r||r.app_id!=='tuda'||r.audience!==nas.audience||organizationId(r.corpId)!==nas.organizationId){ok(res,{contract:1,active:false});return;}
  try{const parents=await db.query('SELECT * FROM company_session_parents WHERE session_id=$1',[r.session_id]);if(parents.rows[0])await parent(parents.rows[0].parent_hash,parents.rows[0].parent_kind,r.user_id);const {scopes}=await allowed(application(r.app_id),r);if(!r.scopes.every((v:string)=>scopes.includes(v)))throw Error();}catch{ok(res,{contract:1,active:false});return;}
  ok(res,{contract:1,active:true,appId:r.app_id,audience:r.audience,organizationId:nas.organizationId,memberId:r.user_id,sessionId:r.session_id,scopes:r.scopes,expiresAt:new Date(r.expires_at).toISOString()});
 });
 route('post','/proxy/:appId/:provider/v1/:operation{/:suffix}',async(req,res)=>{
  const s=await session(req);if(req.params.appId!==s.a.id)throw new Fault('APP_MISMATCH',403);if(s.boardOnly)throw new Fault('SCOPE_DENIED',403);
  const models=await loadModels(),id=String(req.params.provider),p=Object.hasOwn(models.providers,id)&&models.providers[id],operation=String(req.params.operation)+(req.params.suffix?'/'+req.params.suffix:'');
  if(!p||!(p.protocol==='anthropic'?['messages']:p.protocol==='chat'?['chat/completions']:['responses']).includes(operation)||!Object.hasOwn(p.models,req.body?.model))throw new Fault('MODEL_NOT_ALLOWED',403);
  if((active.get(s.user.id)||0)>=2||total>=8)throw new Fault('RATE_LIMIT',429);
  const body=JSON.stringify(req.body);if(Buffer.byteLength(body)>16*1024*1024)throw new Fault('REQUEST_TOO_LARGE',413);
  active.set(s.user.id,(active.get(s.user.id)||0)+1);total++;const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),300000),close=()=>{if(!res.writableEnded)abort.abort();};res.on('close',close);
  try{const headers:Record<string,string>={'content-type':'application/json',accept:'application/json, text/event-stream',authorization:'Bearer '+p.options.apiKey};if(p.protocol==='anthropic'){headers['x-api-key']=p.options.apiKey;headers['anthropic-version']='2023-06-01';if(typeof req.headers['anthropic-beta']==='string')headers['anthropic-beta']=req.headers['anthropic-beta'];}
   const upstream=await fetchApi(p.options.baseURL.replace(/\/$/,'')+'/'+operation,{method:'POST',headers,body,signal:abort.signal,redirect:'error'});if(!upstream.ok){await upstream.body?.cancel();throw new Fault('MODEL_UPSTREAM_FAILED',502);}res.set({'content-type':upstream.headers.get('content-type')||'application/json','x-accel-buffering':'no'});res.status(upstream.status);if(upstream.body)await pipeline(Readable.fromWeb(upstream.body as any),res);else res.end();
  }finally{clearTimeout(timer);res.off('close',close);active.set(s.user.id,Math.max(0,(active.get(s.user.id)||1)-1));total--;}
 });
}
