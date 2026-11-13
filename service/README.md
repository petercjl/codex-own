# 东轩AI授权与模型服务

云服务器运行独立的钉钉 OAuth、员工授权、设备会话和模型配置发放，并使用自己的 PostgreSQL 数据卷。NAS 保存 Windows 首次安装包；npm 分发应用更新。认证及日常模型调用不依赖 NAS 或项目工作台的运行状态。

桌面合同 1：`POST /api/codex-own/auth/start` 提交随机校验值的 SHA-256；浏览器在 `/auth/authorize` 完成企业钉钉登录、核对校验码并确认；桌面通过 `/auth/poll` 提交原始校验值，一次性领取七天有效的专用凭证。浏览器会话和桌面凭证分别保存哈希，桌面凭证只可访问 codex-own 服务。

新版桌面通过认证后的 `GET /api/codex-own/direct-models` 自动领取三个共享文本模型的真实服务地址与 Key，响应 contract 为2、transport 为direct，禁止缓存。客户端以操作系统保护的加密存储保管文本模型凭据，模型请求、图片、工具结果和流式回复由电脑直接连接实际服务商。`GET /session` 同时返回绑定当前员工的应用授权租约参数：有效300秒、120秒后续期。公司凭证仅用于认证接口；模型 Key 仅用于对应服务商。生图继续按已核验身份发放每名员工独立的 ToAPIs 配置。

codex-own 旧代理已停用：`/api/codex-own/proxy/*` 和 `/api/company/v1/proxy/codex-own/*` 在解析正文前返回 HTTP 410、`CLIENT_UPDATE_REQUIRED`，提示更新到支持模型直连的版本。登录、会话、直连配置与个人生图配置发放保持可用；其他应用按各自合同处理。新客户端不回退云代理；直连模型内容不经过公司服务的请求体解析或流量转发。共用文本模型 Key 的轮换影响所有持有客户端，应用权限撤销与服务商 Key 撤销分别处理。

生产环境使用固定 HTTPS 服务地址，在钉钉应用登记对应的 `/api/auth/dingtalk/callback`。指定管理员 UnionId，禁止首次登录自动成为管理员。AppSecret、模型配置和数据库密码保存在源码及镜像以外的私有目录。`compose.yaml` 通过现有 HTTPS 网关的 Docker 网络提供入口，数据库端口不对宿主发布；独立数据卷保留会话和权限。容器日志轮转，健康检查为 `/health`。

部署前运行 `npm ci`、`npm run check` 和 `npm test`。测试默认在本机 PostgreSQL 的独立临时 schema 中执行，可通过 `CODEX_GATEWAY_TEST_DATABASE_URL` 指定测试数据库。生产部署记录源码清单与 SHA-256，更新前备份数据库和私有配置，保留上一镜像及配置用于回退。普通更新保持数据卷与密钥配置。不要删除生产数据库卷。

当前自动测试使用模拟钉钉和模型服务，真实钉钉授权、三个模型及桌面功能需在目标部署完成后另行验收；部署成功与登录成功分别记录。

公司统一身份入口使用一个“东轩AI授权”钉钉应用。`/api/company/v1` 按 appId 登记 codex-own、Tuda、项目工作台及后续应用，应用/设备凭证分别签发。合同见 `contracts/company-v1.md`；旧 `/api/codex-own` 合同保持兼容。

`COMPANY_APPLICATIONS_FILE` 为600权限的私有应用登记与 NAS 服务配置，包含 schemaVersion:1、applications 数组及可选 nas 对象。默认登记三个应用；新增应用提供 id、name、corpId、organizationName。NAS 对象提供 organizationId、audience:tuda-nas、独立 serviceToken。存储权限由 company_access.storage_scopes 明确配置，五分钟存储 token 在线内省，设备退出及 scope 减少立即失效。

`CODEX_OWN_IMAGE_BINDINGS_FILE` 为600权限的私有员工 Key 绑定：schemaVersion:1、bindings 数组，记录明确的 corpId/unionId、verified、enabled、credential 和 models。未经稳定身份核验的记录返回 KEY_BINDING_UNVERIFIED；文本模型保持可用。客户端内置 toapiscli，主进程完成免费凭证校验与当前应用 Skill 安装，无须员工另行安装包。
