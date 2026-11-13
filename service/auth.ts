// The workbench's browser code flow and device-consent pattern, with independent state.
import type { Express, Request, Response } from "express";
import type { Pool } from "pg";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Identity } from "./gateway.ts";
const cookie = "codex_own_browser", stateCookie = "codex_own_oauth_state";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const random = () => randomBytes(32).toString("base64url");
export type OAuthConfig = { origin: string; clientId: string; clientSecret: string; corpId: string; adminUnionId: string; allowHttp?: boolean; appId?: string; pathPrefix?: string };
export function safeAvatarUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048 || !/^https:\/\/[^/?#]+(?:[/?#]|$)/i.test(value) || /[\s\\\u0000-\u001f\u007f]/.test(value)) return;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname && !url.username && !url.password) return url.href;
  } catch {}
}
function jar(req: Request) {
  const result: Record<string, string> = {};
  for (const item of String(req.headers.cookie || "").split(";")) { const at = item.indexOf("="); if (at < 1) continue; try { result[item.slice(0, at).trim()] = decodeURIComponent(item.slice(at + 1).trim()); } catch {} }
  return result;
}
export function safeReturn(value: unknown) {
  return typeof value === "string" && /^\/api\/codex-own\/(auth\/authorize\?request=[A-Za-z0-9_-]{43}|admin)$/.test(value) ? value : (typeof value === "string" && /^\/api\/company\/v1\/auth\/authorize\?request=[A-Za-z0-9_-]{43}$/.test(value) ? value : "/");
}
export function authorizeUrl(config: OAuthConfig, state: string) {
  const url = new URL("https://login.dingtalk.com/oauth2/auth");
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.origin + (config.pathPrefix || "/api/auth/dingtalk") + "/callback", state, response_type: "code", prompt: "consent", scope: "openid corpid" }).toString();
  return url.href;
}
export async function initAuth(db: Pool) {
  await db.query(`CREATE TABLE IF NOT EXISTS auth_users(id text PRIMARY KEY,union_id text UNIQUE NOT NULL,open_id text,corp_id text NOT NULL,name text NOT NULL,system_role text NOT NULL DEFAULT 'member')`);
  await db.query('ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS avatar_url text');
  await db.query(`CREATE TABLE IF NOT EXISTS auth_sessions(token_hash char(64) PRIMARY KEY,user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,expires_at timestamptz NOT NULL)`);
  await db.query(`CREATE TABLE IF NOT EXISTS oauth_states(state_hash char(64) PRIMARY KEY,return_to text NOT NULL,expires_at timestamptz NOT NULL)`);
  await db.query("ALTER TABLE auth_users DROP CONSTRAINT IF EXISTS auth_users_union_id_key");
  await db.query("CREATE UNIQUE INDEX IF NOT EXISTS auth_users_corp_union_key ON auth_users(corp_id,union_id)");
  await db.query("ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS app_id text NOT NULL DEFAULT 'codex-own'");
  await db.query("ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS app_id text NOT NULL DEFAULT 'codex-own'");
  await db.query("DELETE FROM auth_sessions WHERE expires_at<=now()");
  await db.query("DELETE FROM oauth_states WHERE expires_at<=now()");
}
export function installOAuth(app: Express, { db, config, fetchApi = fetch }: { db: Pool; config: OAuthConfig; fetchApi?: typeof fetch }) {
  const appId=config.appId||'codex-own',pathPrefix=config.pathPrefix||'/api/auth/dingtalk';
  const cookie=appId==='codex-own'?'codex_own_browser':'company_'+appId+'_browser',stateCookie=cookie+'_state';
  const secure = !config.allowHttp;
  const cookieOptions = { httpOnly: true, secure, sameSite: "lax" as const, path: "/" };
  const callbackPath = pathPrefix+"/callback";
  const rate = new Map<string, {count: number; until: number}>();
  app.use(pathPrefix, (req, res, next) => {
    const key = req.ip || "unknown", now = Date.now();
    if (rate.size > 10000) for (const [k,v] of rate) if (v.until < now) rate.delete(k);
    let record = rate.get(key); if (!record || record.until < now) { record = {count: 0, until: now + 60000}; rate.set(key, record); }
    if (++record.count > 20 || rate.size > 20000) { res.status(429).send("请求过多，请稍后重试"); return; } next();
  });
  app.get(pathPrefix+"/start", async (req, res) => {
    try {
      const state = random(); await db.query("INSERT INTO oauth_states(state_hash,return_to,expires_at,app_id) VALUES($1,$2,now()+interval '10 minutes',$3)", [digest(state), safeReturn(req.query.returnTo),appId]);
      res.cookie(stateCookie, state, {...cookieOptions, path: callbackPath, maxAge: 600000});
      res.set("cache-control", "no-store");res.redirect(authorizeUrl(config, state));
    } catch { res.status(503).send("登录服务暂时不可用"); }
  });
  app.get(callbackPath, async (req, res) => {
    res.set({"cache-control": "no-store", "referrer-policy": "no-referrer"});
    const state = String(req.query.state || ""), prior = jar(req)[stateCookie] || "", code = String(req.query.authCode || req.query.code || "");
    res.clearCookie(stateCookie, {...cookieOptions, path: callbackPath});
    let stage='state';
    try {
      if (!/^[A-Za-z0-9_-]{43}$/.test(state) || prior.length !== state.length || !timingSafeEqual(Buffer.from(state), Buffer.from(prior)) || !code || code.length > 4096 || req.query.error) throw Error("Invalid OAuth state");
      const request = await db.query("DELETE FROM oauth_states WHERE state_hash=$1 AND app_id=$2 AND expires_at>now() RETURNING return_to", [digest(state),appId]);
      if (!request.rowCount) throw Error("Expired OAuth state");
      async function json(url: string, options: RequestInit) {
        const response = await fetchApi(url, {...options,redirect:"error",signal:AbortSignal.timeout(15000)});
        if (!response.ok) { let providerCode='UNKNOWN';try{const data=await response.json();if(typeof data.code==='string'&&/^[A-Za-z0-9_.-]{1,100}$/.test(data.code))providerCode=data.code;}catch{}throw Object.assign(Error('DingTalk unavailable'),{httpStatus:response.status,providerCode}); } return response.json();
      }
      stage='token-exchange';
      const token = await json("https://api.dingtalk.com/v1.0/oauth2/userAccessToken", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({clientId:config.clientId,clientSecret:config.clientSecret,code,grantType:"authorization_code"})});
      if (typeof token.accessToken !== "string" || !token.accessToken) throw Error("Missing identity token");
      stage='user-profile';
      const profile = await json("https://api.dingtalk.com/v1.0/contact/users/me", {headers:{"x-acs-dingtalk-access-token":token.accessToken}});
      const corpId = String(token.corpId || profile.corpId || ""), unionId = String(profile.unionId || profile.unionid || ""), openId = String(profile.openId || profile.openid || "");
      stage='enterprise-check';
      if (corpId !== config.corpId || !unionId || unionId.length > 256) throw Error("Enterprise identity not allowed");
      const name = String(profile.nick || profile.name || "钉钉用户").slice(0,100), role = unionId === config.adminUnionId ? "admin" : "member";
      stage='database';
      const user = await db.query(`INSERT INTO auth_users(id,union_id,open_id,corp_id,name,system_role,avatar_url) VALUES($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT(corp_id,union_id) DO UPDATE SET open_id=$3,corp_id=$4,name=$5,system_role=$6,avatar_url=$7 RETURNING id`, [random(),unionId,openId,corpId,name,role,safeAvatarUrl(profile.avatarUrl)||null]);
      const raw = random(); await db.query("INSERT INTO auth_sessions(token_hash,user_id,expires_at,app_id) VALUES($1,$2,now()+interval '7 days',$3)", [digest(raw),user.rows[0].id,appId]);
      res.cookie(cookie,raw,{...cookieOptions,maxAge:7*86400000});res.redirect(safeReturn(request.rows[0].return_to));
    } catch(error:any) { console.warn(JSON.stringify({event:'oauth_failure',appId,stage,status:Number.isInteger(error.httpStatus)?error.httpStatus:undefined,providerCode:error.providerCode}));res.status(401).type("html").send('<!doctype html><meta charset="utf-8"><title>登录未完成</title><h1>登录未完成</h1><p>请使用本企业钉钉账号，从 codex-own 重新发起登录。若仍失败，请联系管理员检查企业和应用授权配置。</p>'); }
  });
  return async function browserIdentity(req: Request): Promise<Identity | null> {
    const raw = jar(req)[cookie]; if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return null;
    const result = await db.query(`SELECT u.id,u.name,u.avatar_url AS "avatarUrl",u.corp_id AS "corpId",u.system_role AS "systemRole" FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.app_id=$2 AND s.expires_at>now()`, [digest(raw),appId]);
    const identity = result.rows[0];return identity?.corpId === config.corpId ? identity : null;
  };
}
