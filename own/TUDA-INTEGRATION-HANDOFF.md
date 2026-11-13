# Tuda 独立软件连接契约

## 产品与责任

Tuda 与 codex-own 独立安装、独立编号和独立通过 npm 更新。Tuda 的 Windows 正式版由 Tuda 项目发布。codex-own 的构建输入仅包含 `@petercjl/tuda` 的 board-only CLI/MCP 连接组件、许可证与能力清单；构建清单 contract=2，connection=independent-existing，记录插件版本和包树摘要。桌面安装包由 Tuda 项目管理。

codex-own 负责原生 MCP 注册、board-only 工具白名单、原生审批、员工身份检查、一次性授权交接以及连接插件的私有 npm 更新。Tuda 负责本地桌面协议、画板业务、隔离插件授权及独立桌面的 Agent、生图和更新。插件包从 latest 正式渠道更新；内置连接包作为离线初始插件，连接固定启动时的版本，新连接采用更新后的指针。桌面版本独立核验。

## 实例与生命周期

连接模式为 existing-only。默认使用 Tuda 标准用户数据目录，以 `desktop prepare --no-launch --user-data-path ... --startup-timeout 120 --json` 连接已运行的软件。Mac Dev 可通过 codex-own 独立数据根的私有 `tuda-connection.json` 指定现有 Dev 的数据目录：`{"contract":1,"userDataPath":"绝对路径"}`；文件权限为 0600。连接配置由本机维护，保持在产品源码和包外。

codex-own 不拥有独立 Tuda 的进程；退出仅结束自身 MCP 和清理短期交接文件。用户保存和退出 Tuda 由 Tuda 自己负责。旧 `root/tuda` 的画板、配置和凭据保持原位，迁移由有明确输入输出合同的 Tuda 能力承接。软件缺失或未打开时给出安装/打开提示；协议、实际版本或共享授权能力不兼容时给出升级提示。连接不会创建软件副本或私有桌面实例。

## 身份与授权

公司来源固定为随包的可信 HTTPS origin。业务前核对 codex-own 员工登录，并核对准备结果的真实桌面版本、协议和隔离授权能力。工具发现无需桌面、员工登录或网络。

沿用 `POST /api/company/v1/handoff/issue` 的 codex-own → tuda 交接：随机 verifier、60 秒单次 code、prepare 返回的 instanceId，0700 临时目录及 0600 私有文件；源 token 保留在宿主，交接文件在 MCP 结束时移除。实例变化重新交接，宿主账号变化要求重连。board-only 会话仅用于插件画板操作；独立桌面的公司账号、Agent 与生图权限保持独立。真实旧协议记录见 `TUDA-INTEGRATION-HISTORY.md`。

## 连接级自动授权合同

插件包声明 `nativePlugin.sharedDesktopSession={contract:1,authScope:"connection",preservesDesktopSession:true}`。`desktop prepare --no-launch` 从运行桌面取得 `desktopVersion` 及相同形状的 `boardPlugin`，保留 ready、instanceId、protocolVersion。codex-own 同时核对包声明、真实能力与最低桌面版本。

插件进程生成随机连接密钥，在本机 `/board-plugin/auth` 与 `/board-plugin/call` 请求头 `x-tuda-plugin-session` 中传递。接收端核对当前实例后，为该连接创建内存中的 CompanyAccount 和独立存储客户端；企业画板命令在 AsyncLocalStorage 的连接账号/组织/工作区上下文中执行。桌面主账号、会话文件与空间偏好保持独立。普通桌面调用继续使用桌面账号。

每次业务调用先刷新并校验连接授权，父会话失效时拒绝执行。未授权连接、其他连接的密钥及越界空间请求不能回退到桌面账号。宿主在签发前核对登录，后台实例变化时重新交接；同一实例超过5分钟后更新交接文件，插件按交接内容指纹识别续期。员工无需在 Tuda 重复登录。

## 开发验收与分发

当前连接包为公开 npm 正式版 `@petercjl/tuda@0.1.1`，通过 latest 渠道分发。构建使用锁文件中的公开 SRI，以及 `own/defaults/tuda-inputs.json` 中的 Mac/Windows 包树摘要。Tuda 桌面版本独立记录，运行能力以真实握手合同为准。

连接插件由 codex-own 宿主管理自动更新：使用时触发后台异步检查，持久化检查时间并按约24小时节流；当前业务继续使用已选版本，新版本校验完成后供下一连接使用。检查失败保留当前版本。完整 Tuda 桌面由自身管理更新。

通过 codex-own-cli 恢复真实开发版对话并发送“列出 Tuda 画板”，模型实际调用 `codex_own_tuda.list_boards` 成功，返回“画板3”（2张图）和“画板1”（0张图）。调用前后桌面员工、组织、空间、三个文本模型、会话文件及空间偏好保持一致。自动授权无需 Tuda 人工登录；原生工具审批按用户授权单独处理。

接收端13项针对性测试、宿主12项针对性回归与开发构建检查通过。测试覆盖桌面A与插件B/C并发作用域、独立工作区、父会话撤销拒绝和桌面配置保留。真实验收及构建身份位于 `out/tuda-auto-auth-xKOESK/acceptance.json`，最终开发构建为 `out/dev-build-r5mwBu.noindex`。本文件为构建后的说明更新，运行时代码以该构建快照为准；独立的codex-own-cli包按其实际安装收据核验。

当前发布按 AGENTS.md 的内部软件流程执行：Mac dev 实测通过后，执行 Windows 自动构建和基础检查，再发布 npm；peter-new 按需做安装后抽查。完整离线安装包和 NAS 分发按用户单独要求执行。

## NAS 授权内省限流（2026-11-13）

共享授权服务已将通过服务凭据验证的 NAS 内省请求独立计数：每组织/audience 每 60 秒 6,000 次；公共接口及错误服务凭据保持每 IP 每 60 秒 150 次。超限返回 429 RATE_LIMIT 与 Retry-After:60。每次内省继续查询数据库，核对组织、scope、父会话及撤销状态，授权结果不缓存。客户端应区分 429、401 与传输/上游错误，诊断仅记录 HTTP 状态和错误码。

类型检查和7项服务测试通过；真实 NAS 连续160次内省均200，无效测试存储token全部 active:false；缺少服务凭据为401。云端新镜像为 `sha256:16a8edd9d86ae098fbb30051ee8dfd9275a37fe8bee17e6b9e4e2ce6d9b28993`。私有备份、源码及回滚镜像已核验，员工会话未撤销。完整证据：`out/nas-introspection-rate-jkl61dms/acceptance.json`、`deployment-receipt.json`。本次未操作 Tuda 桌面、未发布 npm；本节为云端部署后的交接记录。


## 钉钉姓名与头像合同（2026-11-13）

共享授权服务在已核验企业的 OAuth profile 中读取 nick/name 与 avatarUrl，并按同一 `(CorpId, UnionId)` 更新员工。`auth_users.avatar_url` 使用可重复执行的兼容迁移，历史用户初始为空。头像仅接受有主机名、无用户名密码、最长2048字符的 HTTPS URL；无头像或无效地址时省略返回字段，员工仍可登录并获得共享文本能力。

`GET /api/company/v1/session`、`GET /bootstrap`、`POST /auth/poll` 和 `POST /handoff/exchange` 统一返回 `member:{id,name,avatarUrl?}`；bootstrap（含 board-only）另保留 role。姓名和头像变化会更新 configVersion。组织、appId、员工和父会话校验继续执行；设备凭证保持有效，每次身份读取查询最新员工资料。Tuda 主进程负责从新 member 刷新姓名头像，图片请求不附带公司凭据。

`POST /api/company/v1/auth/start` 支持可选 `refreshProfile:true`。返回的 verificationUrl 增加 `&refreshProfile=1`，客户端 URL 校验允许此服务端参数。授权页即使已有浏览器登录态也转到真实钉钉 OAuth，交换 code 并重新获取 profile；回调只保留 request 后进入确认页。确认页提供“刷新钉钉姓名与头像”入口。历史员工补齐头像需完成一次 OAuth；也可访问 `https://codex.lumyne.cn/api/auth/dingtalk/start`，完成后让应用刷新 session/bootstrap。现有浏览器确认授权本身不会重新获取资料。

类型检查与8项服务测试通过，覆盖旧表迁移、合法与无效头像、OAuth 更新同一员工、统一 member、无生图Key登录、应用/企业隔离及父会话撤销。线上合成身份通过 session/bootstrap、资料刷新、app隔离、已有浏览器重新进入真实 OAuth 入口和公网 HTTPS 健康检查；临时身份与状态已清理。真实员工的重新 OAuth、钉钉实际头像返回与 Tuda 界面显示由 Tuda 主对话继续验收。

云端镜像为 `sha256:5014042531e5752981398a8b86c1e76177df14f90a02d1f1778d8c6a5b1092a9`。部署前保留数据库、私有配置和旧镜像；数据库归档可读、配置备份逐字节核验，运行源码摘要与本地一致。证据为 `out/company-avatar-cq7rfs7i/acceptance.json`、`deployment-receipt.json` 与 `before-inventory.json`。未撤销真实员工会话，未修改或操作 Tuda 桌面，未发布 npm；本节是云端变更后的交接记录。
