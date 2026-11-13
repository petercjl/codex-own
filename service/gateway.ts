// Dedicated desktop grants and model proxy. Project API credentials are never accepted here.
import type { Express, Request, Response } from "express";
import type { Pool } from "pg";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import fs from "node:fs/promises";

import {employeeImage,organizationId} from './image.ts';

const prefix = "/api/codex-own";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const random = () => randomBytes(32).toString("base64url");
const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
class AccessError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export type Identity = { id: string; name: string; avatarUrl?: string; corpId: string; systemRole: string };
export type GatewayConfig = { origin: string; corpId: string; modelFile: string; imageFile?: string; allowHttp?: boolean };

export function gatewayConfig(): GatewayConfig | null {
  if (process.env.CODEX_OWN_ENABLED !== "true") return null;
  const origin = String(process.env.CODEX_OWN_PUBLIC_URL || "").replace(/\/$/, "");
  const url = new URL(origin);
  const allowHttp = process.env.CODEX_OWN_ALLOW_HTTP_LAN === "true";
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password ||
      !(url.protocol === "https:" || allowHttp && url.protocol === "http:")) throw Error("Invalid codex-own public URL");
  const corpId = process.env.DINGTALK_CORP_ID || "", modelFile = process.env.CODEX_OWN_MODELS_FILE || "";
  if (process.env.AUTH_MODE !== "dingtalk" || !corpId || !modelFile) throw Error("codex-own requires enterprise DingTalk and a private model file");
  return { origin: url.origin, corpId, modelFile, imageFile:process.env.CODEX_OWN_IMAGE_BINDINGS_FILE, allowHttp };
}

export async function initGateway(db: Pool) {
  await db.query(`CREATE TABLE IF NOT EXISTS codex_own_access (
    user_id text PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
    enabled boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now())`);
  await db.query(`CREATE TABLE IF NOT EXISTS codex_own_requests (
    request_id text PRIMARY KEY, verifier_hash char(64) NOT NULL,
    user_id text REFERENCES auth_users(id) ON DELETE CASCADE,
    approval_user_id text REFERENCES auth_users(id) ON DELETE CASCADE,
    approval_hash char(64), status text NOT NULL DEFAULT 'pending', expires_at timestamptz NOT NULL)`);
  await db.query(`CREATE TABLE IF NOT EXISTS codex_own_tokens (
    token_hash char(64) PRIMARY KEY, user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now())`);
  await db.query("DELETE FROM codex_own_requests WHERE expires_at<=now()");
}

export function validateModels(input: any) {
  if (!input || typeof input.model !== "string" || !input.provider || typeof input.provider !== "object") throw Error("Invalid private model registry");
  const providers: Record<string, any> = {};
  for (const [id, p] of Object.entries<any>(input.provider)) {
    if (input.enabled_providers && !input.enabled_providers.includes(id)) continue;
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id) || ["constructor", "prototype"].includes(id)) throw Error("Invalid provider");
    const protocol = p.wire_api || (p.npm === "@ai-sdk/anthropic" ? "anthropic" : [undefined, "@ai-sdk/openai-compatible", "@ai-sdk/openai"].includes(p.npm) ? "responses" : null);
    const url = new URL(p.options?.baseURL);
    if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search ||
        typeof p.options?.apiKey !== "string" || p.options.apiKey.length < 10 || /[\r\n]/.test(p.options.apiKey) ||
        !["anthropic", "responses"].includes(protocol) || !p.models || !Object.keys(p.models).length) throw Error("Invalid upstream configuration");
    const models: Record<string, any> = {};
    for (const [model, m] of Object.entries<any>(p.models)) {
      if (![model, m.name || model].every(s => typeof s === "string" && s.length > 0 && s.length < 256 && !/[\x00-\x1f]/.test(s)) || ["__proto__", "constructor", "prototype"].includes(model)) throw Error("Invalid model");
      const context = m.limit?.context || 128000, output = m.limit?.output || 32768;
      if (![context, output].every(n => Number.isSafeInteger(n) && n > 0) || output > context) throw Error("Invalid model limits");
      models[model] = { name: m.name || model, reasoning: m.reasoning === true, limit: { context, output },
        modalities: { input: m.modalities?.input || ["text"] }, options: { thinking: { type: m.options?.thinking?.type === "adaptive" ? "adaptive" : "disabled" } } };
    }
    providers[id] = { name: String(p.name || id).slice(0, 100), protocol, options: { baseURL: url.href.replace(/\/$/, ""), apiKey: p.options.apiKey }, models };
  }
  const at = input.model.indexOf("/");
  if (!providers[input.model.slice(0, at)]?.models[input.model.slice(at + 1)]) throw Error("Invalid default model");
  return { model: input.model, providers };
}

export function publicModels(models: ReturnType<typeof validateModels>, origin: string) {
  return { contract: 1, model: models.model, provider: Object.fromEntries(Object.entries<any>(models.providers).map(([id, p]) => [id, {
    name: p.name, wire_api: p.protocol, options: { baseURL: origin + prefix + "/proxy/" + id + "/v1" }, models: p.models,
  }])) };
}
export function directModels(models: ReturnType<typeof validateModels>,subject:string) {
  return {contract:2,transport:'direct',subject,configVersion:hash(JSON.stringify(models)),model:models.model,provider:Object.fromEntries(Object.entries(models.providers).map(([id,p]:[string,any])=>[id,{
    name:p.name,wire_api:p.protocol,options:{...p.options},models:p.models,
  }]))};
}

export function installGateway(app: Express, { db, config, browserIdentity, fetchApi = fetch, loadModels }: {
  db: Pool; config: GatewayConfig; browserIdentity: (req: Request) => Promise<Identity | null>;
  fetchApi?: typeof fetch; loadModels?: () => Promise<ReturnType<typeof validateModels>>;
}) {
  const readModels = loadModels || (async () => validateModels(JSON.parse(await fs.readFile(config.modelFile, "utf8"))));
  const hits = new Map<string, { until: number; count: number }>(), active = new Map<string, number>();
  let totalActive = 0;
  function limited(req: Request, kind: string, maximum: number) {
    const key = kind + ":" + req.ip, now = Date.now();
    if (hits.size > 10000) for (const [k, v] of hits) if (v.until < now) hits.delete(k);
    if (hits.size > 20000) throw new AccessError("RATE_LIMIT", "请求过多，请稍后重试", 429);
    let value = hits.get(key); if (!value || value.until < now) { value = { until: now + 60000, count: 0 }; hits.set(key, value); }
    if (++value.count > maximum) throw new AccessError("RATE_LIMIT", "请求过多，请稍后重试", 429);
  }
  async function allowed(user: Identity | null, admin = false) {
    if (!user || user.corpId !== config.corpId) throw new AccessError("AUTH_REQUIRED", "请使用本企业钉钉账号登录", 401);
    if (user.systemRole === "admin") return user;
    if (admin || (await db.query("SELECT user_id FROM codex_own_access WHERE user_id=$1 AND enabled=false", [user.id])).rowCount)
      throw new AccessError("ACCESS_DENIED", "当前账号的服务权限已停用，请联系管理员", 403);
    return user;
  }
  async function desktopIdentity(req: Request) {
    const raw = String(req.headers.authorization || "").replace(/^Bearer /, "");
    if (!/^cow_[A-Za-z0-9_-]{43}$/.test(raw)) throw new AccessError("AUTH_REQUIRED", "请重新登录 codex-own", 401);
    const found = await db.query(`SELECT u.id,u.name,u.corp_id AS "corpId",u.system_role AS "systemRole"
      FROM codex_own_tokens t JOIN auth_users u ON u.id=t.user_id
      WHERE t.token_hash=$1 AND t.revoked_at IS NULL AND t.expires_at>now()`, [hash(raw)]);
    return allowed(found.rows[0] || null);
  }
  const route = (method: "get" | "post", suffix: string, handler: (req: Request, res: Response) => Promise<any>) => {
    app[method](prefix + suffix, async (req, res) => {
      res.set({ "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" });
      try { limited(req, suffix.startsWith("/auth/poll") ? "poll" : suffix, suffix === "/auth/start" ? 20 : 120); await handler(req, res); }
      catch (e) { if (res.headersSent) { res.destroy(); return; } const err = e instanceof AccessError ? e : new AccessError("SERVICE_FAILED", "服务暂时不可用，请稍后重试", 502); res.status(err.status).json({ ok: false, error: { code: err.code, message: err.message } }); }
    });
  };
  function checkBrowserOrigin(req: Request) {
    if (req.headers.origin && req.headers.origin !== config.origin) throw new AccessError("ORIGIN", "请求来源不匹配", 403);
  }
  function html(res: Response, title: string, body: string) {
    res.set("referrer-policy","same-origin");
    res.set("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    res.type("html").send(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{font:16px system-ui;max-width:620px;margin:10vh auto;padding:24px}button{padding:12px 20px}p{line-height:1.7}</style><h1>${title}</h1>${body}</html>`);
  }
  const escape = (v: unknown) => String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

  route("post", "/auth/start", async (req, res) => {
    if (!/^[a-f0-9]{64}$/.test(req.body?.verifierHash)) throw new AccessError("VALIDATION", "授权校验值无效");
    const requestId = random();
    await db.query("INSERT INTO codex_own_requests(request_id,verifier_hash,expires_at) VALUES($1,$2,now()+interval '10 minutes')", [requestId, req.body.verifierHash]);
    res.json({ ok: true, data: { contract: 1, requestId, verificationUrl: config.origin + prefix + "/auth/authorize?request=" + requestId, userCode: requestId.slice(0, 8).toUpperCase(), intervalMs: 2000, expiresIn: 600 } });
  });
  route("get", "/auth/authorize", async (req, res) => {
    const requestId = String(req.query.request || "");
    if (!/^[A-Za-z0-9_-]{43}$/.test(requestId)) throw new AccessError("VALIDATION", "授权请求无效");
    const identity = await browserIdentity(req);
    if (!identity) { res.redirect("/api/auth/dingtalk/start?returnTo=" + encodeURIComponent(prefix + "/auth/authorize?request=" + requestId)); return; }
    const user = await allowed(identity), nonce = random();
    const found = await db.query("UPDATE codex_own_requests SET approval_user_id=$2,approval_hash=$3 WHERE request_id=$1 AND status='pending' AND expires_at>now() RETURNING request_id", [requestId, user.id, hash(nonce)]);
    if (!found.rowCount) throw new AccessError("AUTH_REQUEST_EXPIRED", "授权请求已完成或过期，请从应用重新发起登录", 410);
    html(res, "东轩AI授权", `<p>申请应用：<strong>codex-own</strong></p><p>当前账号：${escape(user.name)}</p><p>请确认桌面应用中的校验码为 <strong>${escape(requestId.slice(0, 8).toUpperCase())}</strong>，且本次登录由你本人发起。</p><p>授权后可使用公司提供的模型服务。</p><form method="post"><input type="hidden" name="request" value="${escape(requestId)}"><input type="hidden" name="nonce" value="${nonce}"><button>确认授权</button></form>`);
  });
  route("post", "/auth/authorize", async (req, res) => {
    checkBrowserOrigin(req); const user = await allowed(await browserIdentity(req));
    const nonce = String(req.body?.nonce || ""), requestId = String(req.body?.request || "");
    if (!/^[A-Za-z0-9_-]{43}$/.test(nonce)) throw new AccessError("AUTH_REQUEST_INVALID", "授权确认已失效", 403);
    const result = await db.query(`UPDATE codex_own_requests SET user_id=$2,status='approved',approval_hash=NULL
      WHERE request_id=$1 AND approval_user_id=$2 AND approval_hash=$3 AND status='pending' AND expires_at>now() RETURNING request_id`, [requestId, user.id, hash(nonce)]);
    if (!result.rowCount) throw new AccessError("AUTH_REQUEST_INVALID", "授权确认已失效", 403);
    html(res, "授权成功", "<p>可以关闭此页面并返回 codex-own。</p>");
  });
  route("post", "/auth/poll", async (req, res) => {
    const requestId = String(req.body?.requestId || ""), verifier = String(req.body?.verifier || "");
    if (!/^[A-Za-z0-9_-]{43}$/.test(requestId) || !/^[A-Za-z0-9_-]{43}$/.test(verifier)) throw new AccessError("AUTH_REQUEST_INVALID", "授权校验失败", 403);
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query("SELECT * FROM codex_own_requests WHERE request_id=$1 FOR UPDATE", [requestId]);
      const request = found.rows[0];
      if (!request || new Date(request.expires_at).getTime() <= Date.now()) throw new AccessError("AUTH_REQUEST_EXPIRED", "授权请求已失效", 410);
      if (!equal(hash(verifier), request.verifier_hash)) throw new AccessError("AUTH_REQUEST_INVALID", "授权校验失败", 403);
      if (request.status !== "approved") { await client.query("COMMIT"); res.status(202).json({ ok: true, data: { status: "pending" } }); return; }
      const users = await client.query('SELECT id,name,corp_id AS "corpId",system_role AS "systemRole" FROM auth_users WHERE id=$1', [request.user_id]);
      const user = await allowed(users.rows[0] || null), token = "cow_" + random(), expiresAt = new Date(Date.now() + 7 * 86400000);
      await client.query("INSERT INTO codex_own_tokens(token_hash,user_id,expires_at) VALUES($1,$2,$3)", [hash(token), user.id, expiresAt]);
      await client.query("DELETE FROM codex_own_requests WHERE request_id=$1", [requestId]); await client.query("COMMIT");
      res.json({ ok: true, data: { contract: 1, token, expiresAt: expiresAt.toISOString(), member: { name: user.name } } });
    } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
  });
  route("get", "/session", async (req, res) => { const user = await desktopIdentity(req); res.set('cache-control','no-store').json({ ok: true, data: { contract: 1, authenticated: true, name: user.name,subject:hash(JSON.stringify([user.corpId,user.id])),configVersion:hash(JSON.stringify(await readModels())),authorization:{validForSeconds:300,refreshAfterSeconds:120} } }); });
  route("post", "/logout", async (req, res) => { await desktopIdentity(req); await db.query("UPDATE codex_own_tokens SET revoked_at=now() WHERE token_hash=$1", [hash(String(req.headers.authorization).slice(7))]); res.json({ ok: true }); });
  route("get", "/bootstrap", async (req,res) => {
    const user=await desktopIdentity(req);
    const found=await db.query("SELECT union_id FROM auth_users WHERE id=$1 AND corp_id=$2",[user.id,config.corpId]);
    if(!found.rows[0])throw new AccessError("AUTH_REQUIRED","请重新登录",401);
    const image=await employeeImage(config.imageFile,config.corpId,found.rows[0].union_id);
    res.json({ok:true,data:{contract:1,organization:{id:organizationId(config.corpId)},member:{id:user.id},image}});
  });
  route("get", "/models", async (req, res) => { await desktopIdentity(req); res.json({ ok: true, data: publicModels(await readModels(), config.origin) }); });
  // Authenticated configuration delivery only. Model request/response bytes stay on the client.
  route('get','/direct-models',async(req,res)=>{const user=await desktopIdentity(req);res.set('cache-control','no-store').json({ok:true,data:directModels(await readModels(),hash(JSON.stringify([user.corpId,user.id])))});});

  route("post", "/proxy/:provider/v1/:operation{/:suffix}", async (req, res) => {
    const user = await desktopIdentity(req), registry = await readModels(), provider = String(req.params.provider), operation = String(req.params.operation) + (req.params.suffix ? "/" + req.params.suffix : "");
    const p = Object.hasOwn(registry.providers, provider) && registry.providers[provider];
    if (!p || !(p.protocol === "anthropic" ? ["messages"] : ["responses", "responses/compact"]).includes(operation) || !Object.hasOwn(p.models, req.body?.model)) throw new AccessError("MODEL_NOT_ALLOWED", "模型或接口不可用", 403);
    if ((active.get(user.id) || 0) >= 2 || totalActive >= 8) throw new AccessError("BUSY", "模型请求较多，请稍后重试", 429);
    const body = JSON.stringify(req.body); if (Buffer.byteLength(body) > 16 * 1024 * 1024) throw new AccessError("REQUEST_TOO_LARGE", "请求内容超过服务上限", 413);
    active.set(user.id, (active.get(user.id) || 0) + 1); totalActive++;
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 300000);
    const disconnected = () => { if (!res.writableEnded) abort.abort(); }; res.once("close", disconnected);
    try {
      const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer " + p.options.apiKey };
      if (p.protocol === "anthropic") { headers["x-api-key"] = p.options.apiKey; headers["anthropic-version"] = "2023-06-01"; if (typeof req.headers["anthropic-beta"] === "string") headers["anthropic-beta"] = req.headers["anthropic-beta"]; }
      const url = p.options.baseURL.replace(/\/$/, "") + "/" + operation;
      const response = await fetchApi(url, { method: "POST", headers, body, signal: abort.signal, redirect: "error" });
      if (!response.ok) { await response.body?.cancel(); res.status(response.status >= 400 && response.status < 600 ? response.status : 502).json({ error: { code: "MODEL_UPSTREAM_FAILED", message: "模型服务暂时不可用，请稍后重试" } }); return; }
      res.status(response.status); res.set("content-type", response.headers.get("content-type") || "application/json"); res.set("x-accel-buffering", "no");
      if (response.body) await pipeline(Readable.fromWeb(response.body as any), res); else res.end();
    } finally { clearTimeout(timer); res.off("close", disconnected); active.set(user.id, Math.max(0, (active.get(user.id) || 1) - 1)); totalActive--; }
  });

  // Browser-only administration. A project CLI token cannot grant model access.
  const adminNonces = new Map<string, { nonce: string; expires: number }>();
  route("get", "/admin", async (req, res) => {
    const identity = await browserIdentity(req);
    if (!identity) { res.redirect("/api/auth/dingtalk/start?returnTo=" + encodeURIComponent(prefix + "/admin")); return; }
    const user = await allowed(identity, true), nonce = random();
    adminNonces.set(user.id, { nonce, expires: Date.now() + 600000 });
    const users = await db.query(`SELECT u.id,u.name,u.system_role,COALESCE(a.enabled,true) AS enabled FROM auth_users u LEFT JOIN codex_own_access a ON a.user_id=u.id WHERE u.corp_id=$1 ORDER BY u.name`, [config.corpId]);
    html(res, "codex-own 用户管理", users.rows.map(u => `<form method="post"><input type="hidden" name="nonce" value="${nonce}"><input type="hidden" name="userId" value="${escape(u.id)}"><p>${escape(u.name)} · ${u.system_role === "admin" ? "管理员" : u.enabled ? "可使用文本模型" : "已停用"}${u.system_role === "admin" ? "" : `<button name="enabled" value="${u.enabled ? "false" : "true"}">${u.enabled ? "停用" : "恢复"}</button>`}</p></form>`).join("") + "<p>本企业员工完成钉钉登录后自动获得三个共享文本模型，并出现在此列表。生图使用本人独立的 ToAPIs Key。</p>");
  });
  route("post", "/admin", async (req, res) => {
    checkBrowserOrigin(req); const user = await allowed(await browserIdentity(req), true), grant = adminNonces.get(user.id);
    if (!grant || grant.expires < Date.now() || !equal(hash(grant.nonce), hash(String(req.body?.nonce || "")))) throw new AccessError("CSRF", "请刷新管理页面后重试", 403);
    if (!["true", "false"].includes(req.body?.enabled)) throw new AccessError("VALIDATION", "权限状态无效");
    const enabled = req.body.enabled === "true", id = String(req.body?.userId || "");
    const target = await db.query("SELECT id FROM auth_users WHERE id=$1 AND corp_id=$2 AND system_role<>'admin'", [id, config.corpId]);
    if (!target.rowCount) throw new AccessError("VALIDATION", "员工身份不可修改");
    await db.query("INSERT INTO codex_own_access(user_id,enabled) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET enabled=$2,updated_at=now()", [id, enabled]);
    if (!enabled) await db.query("UPDATE codex_own_tokens SET revoked_at=now() WHERE user_id=$1", [id]);
    res.redirect(prefix + "/admin");
  });
  app.use(prefix, (_req, res) => { res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "接口不存在" } }); });
}
