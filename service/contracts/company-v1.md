# 公司身份、模型配置与存储授权合同 v1

版本：1.0.5。日期：2026-11-13。统一企业身份接口支持独立 Tuda 的文本直连配置与短期授权续验；客户端实际联调和部署证据分别记录。员工生图 Key 稳定身份绑定仍逐项核验。

## 1. 入口与兼容性

- 公网 origin：`https://codex.lumyne.cn`。新 API 前缀：`/api/company/v1`。
- 统一身份入口：**东轩AI授权**。使用一个钉钉企业内部应用完成企业身份验证，钉钉 Client ID、Client Secret 和 OAuth 回调保存在云端。产品登记标识包括 `tuda`、`codex-own`、`project-workbench`；新增应用继续按此登记。授权页明确显示申请应用，设备会话和权限按 appId 隔离。
- 钉钉身份、权限、会话、文本模型目录及代理、员工生图凭据绑定由云服务负责。云服务与自己的数据库独立运行。NAS 仅负责首次安装包或 Tuda 的共享业务存储。
- 已有 `/api/codex-own/*` 的参数、响应、`cow_` 凭证及模型代理保持兼容。新接口、新凭证和新字段不能改变既有客户端的含义；迁移通过适配层完成。
- 新接口成功统一 `{ "ok": true, "data": ... }`；失败统一 `{ "ok": false, "error": { "code": "...", "message": "..." } }`。模型代理保留对应模型协议的响应形状。
- 所有会话、配置与模型响应使用 HTTPS 和 `Cache-Control: no-store`。日志、遥测、提示词和普通 IPC 回执不得包含真实凭据、OAuth 授权码、Cookie 或配置响应正文。

## 2. 身份、授权与会话

- 员工身份的唯一业务键是经过钉钉验证的 `(CorpId, UnionId)`；显示姓名、昵称、拼音、文件名、邮箱和客户端自报字段不能建立授权绑定。
- 对客户端暴露持久的 opaque `member.id`、`organization.id`，不要求客户端理解原始钉钉标识。相同员工在两款应用中得到相同 member.id；不同企业的身份分开。
- 本企业钉钉身份核验通过后，员工在已登记的应用中按实时应用权限使用共享文本模型。独立 Tuda 会话可获取真实服务商端点和 Key 用于本机直连；既有代理客户端继续使用独立应用/设备凭证。
- 生图使用员工本人的独立 ToAPIs Key，以 `(CorpId, UnionId)` 绑定，供管理员按人监管消耗。Key 的上游配额、模型范围和用量保持各自独立；NAS 不接收 Key。应用登记、显式停用/会话撤销和存储 scope 仍由云端核验。
- `member` 包含持久 `id`、钉钉 `nick/name` 得到的 `name`，以及可选 `avatarUrl`。头像仅来自已核验企业的 OAuth profile，通过有主机名、无用户名密码、长度不超过2048字符的 HTTPS URL 校验；无头像或无效地址时省略字段，员工仍可登录。客户端使用头像时不附带设备、模型或存储凭据。
- 每次设备授权生成独立会话。会话绑定 appId、员工、组织和唯一 sessionId；数据库仅保存随机凭证的哈希。设备名可以显示，但不作为安全身份。
- v1 设备凭证默认有效七天；到期重新授权。跨应用、跨组织使用、已停用权限或已撤销会话必须拒绝。服务端每次重新检查有效性和授权。
- 现有 codex-own 会话不会因新增 Tuda 接口而被重签、替换或赋予 Tuda 权限。

## 3. 浏览器授权与一次性领取

### POST /auth/start

请求：

```json
{"appId":"tuda","verifierHash":"<sha256-of-local-random-verifier>"}
```

客户端用 CSPRNG 生成 32 字节 verifier，编码为无 padding 的 base64url（43 字符），本地主进程保留原文；verifierHash 是其 UTF-8 字符串的 SHA-256 小写十六进制。

响应 data：

```json
{
  "contract":1,
  "appId":"tuda",
  "requestId":"<opaque-43-character-base64url>",
  "verificationUrl":"https://codex.lumyne.cn/api/company/v1/auth/authorize?request=<requestId>",
  "userCode":"ABCDEFGH",
  "expiresIn":600,
  "intervalMs":2000
}
```

可选请求字段 `refreshProfile:true` 表示本轮登录重新获取钉钉资料，响应 `verificationUrl` 追加 `&refreshProfile=1`。客户端应允许这个服务端提供的查询参数。授权页即使已有浏览器身份也转到钉钉 OAuth start，真实交换 code 并获取 profile；回调的 returnTo 只保留 request，随后正常确认授权。确认页也提供“刷新钉钉姓名与头像”链接。旧浏览器确认本身不更新 profile。

已有设备会话无需撤销。旧员工首次获取头像需重新完成一次 OAuth；可从应用发起 `refreshProfile:true` 登录，或直接访问可信 origin 的 `/api/auth/dingtalk/start` 完成 OAuth 后在应用刷新 session/bootstrap。新的姓名与头像按同一 `(CorpId, UnionId)` 更新，其他设备在下次读取身份时获得新资料。OAuth 未返回合法头像时字段保持缺失。

requestId 不携带凭证；userCode 是 requestId 前八字符的大写形式。客户端必须校验 contract、appId、可信 HTTPS origin、授权路径、request 参数和最长十分钟的有效期，再用系统浏览器打开 verificationUrl。verifier 不进入浏览器 URL、renderer 或 NAS。

浏览器授权页由服务端生成，绑定请求中的应用。它通过东轩AI授权统一钉钉 OAuth code flow 取得 `openid corpid`，核对企业，展示应用名称、当前员工和 userCode。员工主动确认后才能领取设备凭证。OAuth state、浏览器 Cookie、确认 nonce、过期时间与用户/应用绑定；确认及领取都防重放。

### POST /auth/poll

请求：`{"appId":"tuda","requestId":"...","verifier":"..."}`。

未确认时为 HTTP 202：`{"ok":true,"data":{"contract":1,"appId":"tuda","status":"pending"}}`。

已确认时为 HTTP 200：

```json
{
  "ok":true,
  "data":{
    "contract":1,
    "appId":"tuda",
    "status":"authorized",
    "token":"<opaque-company-device-token>",
    "sessionId":"<opaque-session-id>",
    "expiresAt":"<ISO-8601-UTC>",
    "member":{"id":"<member-id>","name":"员工显示名"},
    "organization":{"id":"<organization-id>","name":"组织显示名"}
  }
}
```

服务端校验 appId、verifier、批准员工和实时权限，在同一事务中一次性领取并删除授权请求。未知、已消费或过期请求统一 HTTP 410 `AUTH_REQUEST_EXPIRED`；校验值错误 HTTP 403 `AUTH_REQUEST_INVALID`；应用不匹配 HTTP 403 `APP_MISMATCH`。客户端不自动重新发起另一轮授权来掩盖未知领取结果；可由用户重新登录。轮询间隔至少为返回的 intervalMs，取消或超时后停止轮询。

## 4. 设备会话接口

以下接口需要 `Authorization: Bearer <device-token>` 和 `X-Company-App-Id: tuda`。服务端要求 Header 的 appId 与凭证绑定一致；新旧命名空间的凭证不混用。

- `/auth/poll`、`/handoff/exchange`、`/session`、`/bootstrap`（含 board-only）统一使用上述 member 字段；bootstrap 额外包含 role。姓名或头像更新改变 bootstrap 的 configVersion。
- `GET /session`：data 为 `{contract:1,appId,authenticated:true,sessionId,expiresAt,member,organization}`。
- `POST /logout`，空 JSON 对象：撤销当前设备会话及其派生存储授权；data 为 `{contract:1,appId,revoked:true}`。不退出另一应用或另一设备的会话。
- HTTP 401 `AUTH_REQUIRED` 表示凭证无效、过期或撤销；HTTP 403 `ACCESS_DENIED` 表示企业身份不匹配，或该员工/应用被显式停用。客户端清理当前账号的活动凭据，保留业务数据，提示重新登录或联系管理员。
- 本地网络失败不能被误判为已成功撤销远端会话。客户端可以先清理本机活动凭据，但应报告远端撤销尚未确认。

### 独立 Tuda 文本直连

`GET /direct-models` 要求 `cdev_` Bearer、`X-Company-App-Id: tuda`，并且为独立登录的 Tuda 会话。成功为 `{ok:true,data:{contract:2,appId:'tuda',authenticated:true,sessionId,expiresAt,member,organization,transport:'direct',subject,configVersion,model,provider}}`。

- `subject` 是 `sha256(JSON.stringify([corpId,user.id]))` 的小写十六进制摘要，绑定服务端核验的企业与员工。
- `configVersion` 复用 `gateway.directModels` 的当前文本模型配置摘要；`model` 是 `providerId/modelId`。`provider[id]` 含 `name`、`wire_api`（`anthropic` 或 `responses`）、`options:{baseURL,apiKey}` 和 `models`。baseURL 为真实服务商端点，apiKey 为真实服务商 Key。
- 同一独立 Tuda 会话的 `GET /session` 保持 `contract:1` 和既有字段，并增加 `subject`、相同文本摘要 `configVersion`、`authorization:{validForSeconds:300,refreshAfterSeconds:120}`。该摘要与包含生图、存储和个人信息的 bootstrap.configVersion 分别使用。
- 两个接口每次实时核验会话、应用权限和企业身份并读取当前模型配置，响应 `Cache-Control:no-store`。配置响应按凭据处理，禁止写日志或传入普通渲染进程。设备 Bearer 仅访问公司接口，模型 Key 仅访问相应服务商。
- board-only 会话请求直连配置返回 HTTP 403 `SCOPE_DENIED`，session 不包含 subject、文本 configVersion 或 authorization；已登记的其他应用也不能领取直连 Key。未知应用拒绝，跨应用 Header 返回 `APP_MISMATCH`；禁用、撤销或过期按既有状态拒绝。
- 客户端按120秒续验，正向授权最长300秒；拒绝、退出及配置版本改变后停用旧直连配置。公司授权撤销与服务商长期 Key 撤销分别处理，已下发 Key 的立即失效需要服务商侧撤销或轮换。

既有 bootstrap、ToAPIs、NAS、代理与 handoff 合同保持兼容；直连配置接口只交付配置。

## 5. GET /bootstrap

本企业核验通过的当前员工/应用可领取三个共享文本模型；生图字段按本人已核实的 ToAPIs 绑定返回。接口不接受 userId、姓名、Key 文件名或任意员工选择参数。响应中 appId、组织、员工和 sessionId 必须与当前会话一致。

```json
{
  "ok":true,
  "data":{
    "contract":1,
    "appId":"tuda",
    "sessionId":"<session-id>",
    "configVersion":"<opaque-revision>",
    "organization":{"id":"<organization-id>","name":"组织显示名"},
    "member":{"id":"<member-id>","name":"员工显示名","role":"member"},
    "text":{
      "enabled":true,
      "defaultModel":"gateway-deepseek/deepseek-flash",
      "providers":[{
        "id":"gateway-deepseek",
        "name":"公司文本模型",
        "protocol":"openai-responses",
        "baseUrl":"https://codex.lumyne.cn/api/company/v1/proxy/tuda/gateway-deepseek/v1",
        "models":[{"id":"deepseek-flash","name":"DeepSeek Flash","contextWindow":1000000,"maxOutputTokens":32768,"reasoning":true}]
      }]
    },
    "image":{
      "enabled":true,
      "adapter":"toapiscli",
      "package":"@petercjl/toapiscli",
      "credential":{"schemaVersion":1,"site":"cn","apiKey":"<only-this-employee-key>","label":"员工配置"},
      "models":["doubao-seedream-5-5","gemini-nano-banana-2.1","gpt-image-2.6-sunburst"]
    },
    "storage":{"enabled":false,"reason":"STORAGE_NOT_CONFIGURED"}
  }
}
```

示例名称及模型是合同示例；三个共享文本模型取当前企业云端目录；当前为网关 Claude、网关 DeepSeek、百炼 DeepSeek。生图目录取本人 Key 与公司批准模型的交集。image.models 必须同时属于公司批准目录和员工现有 Key 可用范围，不通过空数组表达无限权限。

- `configVersion` 在员工权限、可见模型、默认模型、ToAPIs 绑定或相关策略变化时更新。客户端在登录后、重新打开应用及运行期间定期刷新；建议每十五分钟刷新且在 401/403 后立即停止受影响调用。
- text/image/storage 各自可禁用。禁用形状为 `{enabled:false,reason:"CODE"}`；不返回 credential。企业身份核验正常且未显式停用时，text.enabled 为 true 并包含三个模型；文本服务未配置或显式停用时 providers 为空、defaultModel 为 null；生图禁用时 models 为空。
- 明确原因包括 `TEXT_NOT_CONFIGURED`、`IMAGE_NOT_GRANTED`、`KEY_NOT_BOUND`、`KEY_BINDING_UNVERIFIED`、`IMAGE_MODELS_NOT_CONFIGURED`、`STORAGE_NOT_CONFIGURED`、`STORAGE_NOT_GRANTED`。
- text.defaultModel 是 providerId/modelId；provider.models[].id 是上游原始模型 ID，不能把两者混淆。
- 文本不返回真实上游 Key。文本代理使用当前应用的设备 token。bootstrap 的文本 baseUrl 必须位于可信 origin 和对应 appId 的代理路径下。
- image.credential 必须是该稳定员工身份明确绑定、已确认的现有 ToAPIs Key；管理员以 CorpId + UnionId 核对发放记录后绑定。姓名或拼音文件名只能辅助人工定位，未核对时返回 KEY_BINDING_UNVERIFIED，不自动猜配或新建 Key。
- image.credential 只交给桌面主进程，在该账号隔离的配置位置通过 toapiscli 合同导入；不进入 renderer、普通 IPC、任务记录、共享目录或 NAS。当前 Agent/应用实例的配置互相隔离。
- 生图执行固定使用 `@petercjl/toapiscli → ToAPIs MCP`，客户端发现当前 CLI 合同并让 CLI 校验 Key 权限。云端发配置不等于获准生成；执行、费用、未知提交结果和恢复仍遵循 CLI 合同。
- 公共配置回执只能包含 appId、member.id、configVersion、能力状态与脱敏认证状态；不能序列化原始 bootstrap 响应。

## 6. 文本协议与模型代理

protocol 取值固定为：

| protocol | 相对 baseUrl 的请求 | 行为 |
| --- | --- | --- |
| `anthropic-messages` | `POST /messages` | 原生 Messages；官方 SDK 自动加 `/v1` 时，适配其 base URL 规则，不能重复 `/v1`。 |
| `openai-responses` | `POST /responses` | 原生 Responses；远程压缩仅在该 provider 明确支持时提供 `/responses/compact`。 |
| `openai-chat-completions` | `POST /chat/completions` | 原生 Chat Completions；不将 Responses 地址自动当作此协议。 |

代理地址是 `/api/company/v1/proxy/{appId}/{providerId}/v1`。token 的 appId 必须与路径一致；provider 与 body.model 必须属于当前企业的三个共享文本模型目录，且员工/应用未被显式停用。客户端不得传任意上游 URL、Key 或选择另一个员工身份。

协议不在代理层互相猜测或静默转换。服务端只暴露已配置且实际支持的协议；客户端在自己的 harness 边界适配。Anthropic、Responses、Chat Completions 的工具定义、tool call ID/输出和流式事件原样保留。代理过滤客户端认证头，使用服务器私有上游凭据；上游错误正文不能泄露 Key。客户端断开时取消上游请求，已开始的计费请求不自动重放。

默认请求体上限 16 MiB；限流和并发冲突 HTTP 429。错误在响应开始前使用安全的协议错误体；流式输出开始后的失败结束连接，客户端按流未完成处理。

## 7. NAS 存储授权

NAS 不接收设备/model token、ToAPIs Key、钉钉凭证或 bootstrap 正文。客户端仅在选择 NAS 存储并已获准使用该组织空间时获取短期存储 token；选择公司本地文件夹时不请求 NAS 授权。

### POST /storage/token

使用当前应用设备凭证及 X-Company-App-Id，请求：

```json
{"audience":"tuda-nas","scopes":["boards:read","boards:write","assets:read","assets:write"]}
```

audience 必须在云端登记并绑定当前组织，scopes 只能是该员工/应用权限的子集。v1 仅向 Tuda 开放该存储 audience。响应 data：

```json
{"contract":1,"appId":"tuda","tokenType":"Bearer","token":"<opaque-storage-token>","audience":"tuda-nas","expiresAt":"<ISO-8601-UTC>","organizationId":"<organization-id>","memberId":"<member-id>","scopes":["boards:read","assets:read"]}
```

有效期最长五分钟，绑定父设备 sessionId、应用、组织、员工、audience 与 scopes。父会话退出、停用、到期或权限减少时，派生存储授权失效。存储 token 不能调用 bootstrap、文本代理或领取另一个 token。

### POST /storage/introspect

已通过独立服务凭据验证的 NAS 内省请求，按登记组织与 audience 使用独立的每 60 秒 6,000 次限额，与登录、会话和其他接口的每 IP 每 60 秒 150 次限额分别计数。错误或缺少服务凭据的内省请求受公共 IP 限额约束；凭据有效但存储 token 无效时返回 active:false。命中限额返回 HTTP 429、RATE_LIMIT 和 Retry-After:60。限流计数不缓存授权结果，每次有效存储 token 的会话、父会话、组织、scope 与撤销状态仍重新查询数据库。

仅 NAS 服务端调用；使用独立的、绑定 organization/audience 的 NAS 服务凭证 `Authorization: Bearer <nas-service-token>`。凭证保存在 NAS 私有配置，不发给桌面。请求为 `{token:"<storage-token>"}`。

有效响应 data：`{contract:1,active:true,appId:"tuda",audience,organizationId,memberId,sessionId,scopes,expiresAt}`。无效、撤销、越权或到期存储 token 返回 HTTP 200 `{contract:1,active:false}`；NAS 服务凭证错误为 HTTP 401，不返回身份详情。

NAS 必须检查 active、audience、组织、到期时间和该操作所需 scope；服务端从受验证的身份派生实际组织空间，拒绝客户端传任意文件系统根路径。内省结果不能超出 token 有效期缓存；v1 按请求内省。无法完成验证时拒绝 NAS 操作，桌面允许用户继续使用公司本地文件夹。v1 采用在线内省，不承诺 JWKS 或离线 JWT 验签。

## 8. 实现与验收状态

| 项目 | 当前证据 |
| --- | --- |
| `/api/codex-own` 既有模型代理 | 三个真实模型的云端请求均已返回验收标记；临时测试身份已清理。 |
| codex-own Mac 开发版 | 已构建、签名、安装并启动内置 toapiscli 0.1.1 的开发版；已实际导入三个云端模型并查询已登录状态，目视账户页确认企业账号。 |
| HTTPS/DNS | 公网域名与有效证书已验证。 |
| 东轩AI授权钉钉应用 | 已更名并发布 1.0.0，企业全员可用；本人信息权限已开通。OAuth 身份、应用确认及一次性领取真实通过。 |
| `/api/company/v1` | 已部署；PostgreSQL 原生合同测试通过，真实 Tuda 设备授权及三个模型调用通过。 |
| ToAPIs 稳定身份绑定 | 发放记录待核验，未核验记录不得下发。 |
| NAS 存储授权 | 已实现独立短期存储 token 及在线内省，真实 NAS /api/me、boards:list 均 200；成员匹配，组织映射保留原空间。 |
| Windows 与 npm | 先前钉钉包已构建；含统一名称与内置 toapiscli 的新包正在 NAS 暂存构建，安装由用户验收；尚未发布 npm。 |

验收应覆盖应用/设备/组织隔离、授权请求重放、停用及注销、配置降权、ToAPIs 错人绑定拒绝、代理协议与工具/流式输出、NAS 仅接受存储 token，以及 NAS 离线时公网身份/模型和公司本地空间可用。模拟验证与真实服务证据分别报告。
