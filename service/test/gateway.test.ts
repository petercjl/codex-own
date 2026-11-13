import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import pg from "pg";
import { randomBytes, createHash } from "node:crypto";
import { initGateway, installGateway, validateModels, publicModels } from "../gateway.ts";

const registry = { model: "claude/opus", provider: {
  claude: { npm: "@ai-sdk/anthropic", options: { baseURL: "https://claude.example/v1", apiKey: "sk-claude-private-test" }, models: { opus: { name: "Claude" } } },
  gateway: { options: { baseURL: "https://gateway.example/v1", apiKey: "sk-gateway-private-test" }, models: { deepseek: { name: "DeepSeek" } } },
  dashscope: { options: { baseURL: "https://bailian.example/v1", apiKey: "sk-bailian-private-test" }, models: { deepseek: { name: "DeepSeek 百炼" } } },
} };
test("model discovery omits keys and fixes proxy destinations", () => {
  const publicValue = publicModels(validateModels(registry), "https://service.example");
  assert.equal(Object.keys(publicValue.provider).length, 3);
  for (const p of Object.values(registry.provider)) assert(!JSON.stringify(publicValue).includes(p.options.apiKey));
  assert.equal(publicValue.provider.claude.options.baseURL, "https://service.example/api/codex-own/proxy/claude/v1");
  const bad = structuredClone(registry); bad.provider.claude.options.baseURL = "http://external.example";
  assert.throws(() => validateModels(bad));
});

test("native HTTP and PostgreSQL: consent, one-time grants, dedicated credentials, streams and revocation", async t => {
  const schema = "cow_test_" + randomBytes(8).toString("hex");
  const connectionString = process.env.CODEX_GATEWAY_TEST_DATABASE_URL || "postgresql://localhost:55432/project_lab";
  const admin = new pg.Pool({ connectionString });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const db = new pg.Pool({ connectionString, options: "-c search_path=" + schema });
  t.after(async () => { await db.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });
  await db.query("CREATE TABLE auth_users(id text PRIMARY KEY,name text,corp_id text,system_role text)");
  await db.query("INSERT INTO auth_users VALUES('admin','管理员','company','admin'),('employee','同事','company','member'),('foreign','外部','other','admin')");
  await initGateway(db);
  const app = express(); app.use(express.json()); app.use(express.urlencoded({ extended: false }));
  const config = { origin: "", corpId: "company", modelFile: "unused" }, requests: any[] = [];
  installGateway(app, { db, config, browserIdentity: async req => {
    const result = await db.query('SELECT id,name,corp_id AS "corpId",system_role AS "systemRole" FROM auth_users WHERE id=$1', [req.headers["x-test-browser-user"] || ""]);
    return result.rows[0] || null;
  }, loadModels: async () => validateModels(registry), fetchApi: (async (url: any, options: any) => {
    requests.push({ url, options });
    if (options.body.includes("simulateUpstreamFailure")) return new Response("sk-claude-private-test upstream error", { status: 500 });
    return new Response('event: message\ndata: {"text":"中文流式响应"}\n\n', { headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch });
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(r => server.once("listening", r));
  config.origin = "http://127.0.0.1:" + (server.address() as any).port;
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); });
  const call = (p: string, data?: any, headers: any = {}) => fetch(config.origin + "/api/codex-own" + p, { method: data === undefined ? "GET" : "POST", headers: { ...data !== undefined ? { "content-type": "application/json" } : {}, ...headers }, body: data === undefined ? undefined : JSON.stringify(data), redirect: "manual" });
  const verifier = randomBytes(32).toString("base64url"), verifierHash = createHash("sha256").update(verifier).digest("hex");
  const start = await (await call("/auth/start", { verifierHash })).json(), requestId = start.data.requestId;
  assert.equal((await call("/auth/poll", { requestId, verifier })).status, 202);
  assert.equal((await call("/auth/poll", { requestId, verifier: randomBytes(32).toString("base64url") })).status, 403);
  assert.equal((await call("/auth/authorize?request=" + requestId)).status, 302);
  assert.equal((await call("/auth/authorize?request=" + requestId, undefined, { "x-test-browser-user": "foreign" })).status, 401);
  assert.equal((await call("/auth/authorize?request=" + requestId, undefined, { "x-test-browser-user": "employee" })).status, 200);
  const adminPage = await (await call("/admin", undefined, { "x-test-browser-user": "admin" })).text();
  const adminNonce = adminPage.match(/name="nonce" value="([^"]+)"/)![1];
  assert.equal((await call("/admin", { userId: "employee", enabled: "true", nonce: adminNonce }, { "x-test-browser-user": "admin", origin: "https://foreign.example" })).status, 403);
  assert.equal((await call("/admin", { userId: "employee", enabled: "true", nonce: adminNonce }, { "x-test-browser-user": "admin", origin: config.origin })).status, 302);
  const consent = await (await call("/auth/authorize?request=" + requestId, undefined, { "x-test-browser-user": "employee" })).text();
  const nonce = consent.match(/name="nonce" value="([^"]+)"/)![1];
  assert(consent.includes(start.data.userCode));
  assert.equal((await call("/auth/authorize", { request: requestId, nonce }, { "x-test-browser-user": "admin", origin: config.origin })).status, 403);
  assert.equal((await call("/auth/authorize", { request: requestId, nonce }, { "x-test-browser-user": "employee", origin: config.origin })).status, 200);
  const claimed = await (await call("/auth/poll", { requestId, verifier })).json(), token = claimed.data.token;
  assert.match(token, /^cow_/); assert.equal((await call("/auth/poll", { requestId, verifier })).status, 410);
  const stored = await db.query("SELECT * FROM codex_own_tokens"); assert(!JSON.stringify(stored.rows).includes(token));
  const headers = { authorization: "Bearer " + token };
  assert.equal((await call("/session", undefined, { authorization: "Bearer pro_" + randomBytes(36).toString("base64url") })).status, 401);
  assert.equal((await call("/admin", undefined, headers)).status, 302);
  const models = await (await call("/models", undefined, headers)).json(); assert.equal(Object.keys(models.data.provider).length, 3);
  assert(!JSON.stringify(models).includes("private-test"));
  assert.equal((await call('/direct-models')).status,401);
  const direct=await call('/direct-models',undefined,headers);assert.equal(direct.headers.get('cache-control'),'no-store');
  const configured=(await direct.json()).data;assert.equal(configured.contract,2);assert.equal(configured.transport,'direct');
  assert.equal(configured.provider.claude.options.baseURL,registry.provider.claude.options.baseURL);assert.equal(configured.provider.claude.options.apiKey,registry.provider.claude.options.apiKey);
  assert.equal(requests.length,0,'Configuration delivery must never invoke a model');
  const lease=(await(await call('/session',undefined,headers)).json()).data;assert.equal(lease.subject,configured.subject);assert.equal(lease.authorization.validForSeconds,300);

  for (const [provider, operation, model] of [["claude", "messages", "opus"], ["gateway", "responses", "deepseek"], ["dashscope", "responses", "deepseek"]]) {
    const response = await call(`/proxy/${provider}/v1/${operation}`, { model, stream: true }, headers);
    assert.equal(response.status, 200); assert((await response.text()).includes("中文流式响应"));
  }
  assert.equal(requests.length, 3); assert.equal(requests[0].options.headers["x-api-key"], registry.provider.claude.options.apiKey);
  assert(!JSON.stringify(requests).includes(token));
  assert.equal((await call("/proxy/claude/v1/responses", { model: "opus" }, headers)).status, 403);
  assert.equal((await call("/proxy/claude/v1/messages", { model: "unknown" }, headers)).status, 403);
  const error = await call("/proxy/claude/v1/messages", { model: "opus", simulateUpstreamFailure: true }, headers);
  assert.equal(error.status, 500); assert(!(await error.text()).includes("private-test"));
  assert.equal((await call("/admin", { userId: "employee", enabled: "false", nonce: adminNonce }, { "x-test-browser-user": "admin", origin: config.origin })).status, 302);
  assert.equal((await call("/session", undefined, headers)).status, 401);
  assert.equal((await call("/proxy/claude/v1/messages", { model: "opus" }, headers)).status, 401);
});
