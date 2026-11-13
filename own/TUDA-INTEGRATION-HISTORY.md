# Tuda 集成历史记录

以下为 2026-11-12 架构修订前的原始记录，保留当时的实现与验收证据。当前规范见 `TUDA-INTEGRATION-HANDOFF.md`。

# Tuda 内置画板集成交接 v1

2026-11-12。状态：宿主源码、内置分发和云端 board-only 交接已实现。数据库及真实员工交接已验证；Mac开发版的最终构建身份与验收进度统一记录在本轮 result.json、source-inventory.json 和 `out/tuda-integration-evidence-pekmm4ob/acceptance.json`，不以安装成功代替功能验收。

## 分工及执行边界

codex-own 使用内置 ToAPIs CLI 生成和编辑图片。Tuda 受限 stdio MCP 只管理画板、已有本地图片、布局、文字与导出。Tuda 项目拥有工具 schema、白名单后台、鉴权接收及桌面候选；本项目拥有内置分发、私有 Node、宿主适配和公司授权交接。双方只修改自己的仓库。

## 云端一次性交接

可信 origin 为现有公司 HTTPS origin（生产 https://codex.lumyne.cn），前缀 `/api/company/v1`。服务成功形状 `{ok:true,data:...}`，失败 `{ok:false,error:{code,message}}`。本轮接口实现位于 `service/company.ts`，已部署至上述生产 origin。

1. 每次有效 tools/call 前，宿主先用私有 Node 调用 `<pkg>/dist/main.js desktop prepare --app-path <内置桌面> --user-data-path <独立目录> --startup-timeout 120 --json`。该操作只启动/等待本机后台，不登录、不调用模型或业务、不安装Skill、不检查更新。必须返回 `{schemaVersion:1,ok:true,data:{ready:true,instanceId:"<64位SHA256>",protocolVersion:1}}`。工具发现完全离线。首次及后台instanceId变化时，宿主再生成32随机字节base64url verifier（43字符），计算UTF-8 SHA256小写十六进制。
2. `POST /handoff/issue`，头 `Authorization: Bearer <codex-own cow_ 或 appId=codex-own 的 cdev_>`、`X-Company-App-Id: codex-own`；JSON `{targetAppId:"tuda",verifierHash:"<64 hex>"}`。返回 data `{contract:1,sourceAppId:"codex-own",targetAppId:"tuda",code:"<43 base64url>",expiresIn:60}`。
3. 私有 `TUDA_AUTH_HANDOFF_FILE` 内容：`{contract:1,origin:"<trusted HTTPS origin>",appId:"tuda",instanceId:"<prepare实例指纹>",code:"...",verifier:"...",expiresAt:"<ISO UTC>"}`。宿主负责创建独立 0700 目录、0600 文件及退出后的清理。MCP初始化只配置文件路径；每次业务前完成prepare；后台ready且需要新会话时才签发并原子写入，避免冷启动、工具发现和闲置消耗60秒有效期。同实例复用会话，实例变化即重新签发；插件每次核对local-api实例，匹配fresh文件instanceId再兑换，拒绝旧实例文件。该内容与路径不作为模型工具参数/响应；源 token 不写入文件，不传给 Tuda。
4. 插件在业务调用前经 `/board-plugin/auth` 把交接信息送给 Tuda 主进程。Tuda 检查 schema、可信 origin、appId、当前后台instanceId与时限后调用 `POST /handoff/exchange`，头 `X-Company-App-Id: tuda`，无 Authorization；JSON `{appId:"tuda",code,verifier}`。
5. 返回 data `{contract:1,appId:"tuda",status:"authorized",token:"cdev_...",sessionId,expiresAt,member:{id,name},organization:{id,name}}`。Tuda 在嵌入模式只在主进程内存保留自己的 token，独立持久化组织/账号业务数据，复用统一公司 session/bootstrap/空间初始化合同；后台重启通过新交接恢复会话，不依赖OS Keychain恢复。handoff派生会话固定为 board-only：bootstrap 的 text.enabled=false、providers=[]、defaultModel=null，image.enabled=false、models=[]且无credential；模型代理拒绝并返回403 SCOPE_DENIED。组织身份与已授权画板存储保持可用，普通Tuda直接登录会话遵循原合同。原始交接、token 和 bootstrap 正文不进入 renderer、模型、普通日志。

交接码仅存哈希、60秒有效、PKCE校验、事务内一次性消费。错误 verifier 返回403且保留正确接收端的领取机会；重复/过期返回410。目标固定 Tuda。签发和兑换均检查两端员工权限与企业；Tuda派生会话最长不超过父会话。后续 session/bootstrap/代理每次检查父会话有效和双方权限。Tuda退出只撤销自己的会话；codex-own退出使派生会话失效。存储内省同样需要父会话检查。

## 启动与分发

受限入口：私有 Node `<bundled @petercjl/tuda>/dist/board-plugin.js`，MCP stdio。固定企业空间。显式 `TUDA_USER_DATA_PATH` 为独立宿主数据目录；`TUDA_APP_PATH` 指向内置兼容桌面。`TUDA_NO_LAUNCH=1` 仅用于已有后台场景。宿主设置 `TUDA_PLUGIN_SPACE=enterprise`、`TUDA_EMBEDDED_HOST=codex-own`、`TUDA_COMPANY_URL=<内置可信origin>`、`TUDA_STARTUP_TIMEOUT_MS=120000`。宿主MCP工具时限240秒，准备子进程135秒超时，均可随MCP退出取消。宿主登录origin必须与内置公司origin一致。

宿主将完整兼容 Tuda 桌面与npm运行时一同纳入构建，保留精确版本、文件摘要和来源。桌面缺失必须阻止集成构建或报告明确不可用；不能仅凭CLI工具可发现认定完整可用。内置离线候选0.1.0及桌面输入的摘要锁定在 `own/defaults/tuda-inputs.json`；运行时公开npm制品的来源与SRI记录在私有安装收据及本轮验收记录中。宿主注册保留原生审批，不设置auto_approve。嵌入式界面提供画板库、文件管理、已有图片导入与导出、图片和文字画布，生成和模型服务仍由codex-own的ToAPIs路由承接。Mac只构建开发版；Windows候选及正式发布按仓库独立门禁，本轮不发布codex-own npm包，不同步其他Agent。

## 私有桌面退出合同

`POST http://127.0.0.1:<local-api.port>/board-plugin/host/quit`，Bearer为独立数据目录local-api.json中的本机token，body `{}`。仅 `TUDA_EMBEDDED_HOST=codex-own` 可用，不注册为模型工具。Tuda完成窗口布局flush及存储写入后返回 `{result:{quitting:true}}`，再按正常保存门禁退出。宿主before-quit等待端口关闭后继续退出；失败保留两端应用并报告。

## npm 安装与自动更新消费

Tuda 对话负责发布 `@petercjl/tuda`；codex-own 默认安装该包，并消费 `next` 渠道。内置完整桌面保持固定，包的 `nativePlugin.desktopCompatibility` 必须声明 contract=1、protocolVersion=1、minimumVersion 与内置桌面兼容；包不能独立改写签名桌面。

宿主 `own/lib/tuda-package.mjs` 在独立数据根 `native-plugins/tuda` 管理实体不可变版本、文件摘要与原子 active 指针。初始内置版本离线安装；工具发现不联网。有效业务前在空闲点按24小时节流检查 npm next，元数据请求时限1500ms，校验固定包名/渠道、同小版本（0.x）或同大版本（1.x）、sha512 SRI、归档路径、许可证及能力合同。失败保留旧版；当前MCP连接固定它启动时选择的版本，新连接使用新指针。旧版本保持可用，避免删除运行中的文件。不安装Agent Skill、全局CLI或其他Agent配置。

## 验收进度

本轮交付边界为默认安装、内部授权与自动更新消费；图文业务的扩展调试独立跟踪。包/更新与授权定向回归、开发构建结果及真实公开npm来源核对统一写入 `out/tuda-integration-evidence-pekmm4ob/acceptance.json`，关联精确源码、包和桌面摘要。Windows原生验收与codex-own正式发布遵循仓库独立门禁，本轮不发布codex-own正式版。

云端已核实：真实员工签发/兑换/会话查询通过，错误校验及跨应用拒绝，重放与撤销拒绝；派生bootstrap为board-only，不下发文本模型或生图Key，模型代理403 SCOPE_DENIED。数据库备份已在隔离数据库完整恢复12张表，临时库清理完成。

云端源码摘要 `5f50d270d31ec866810950dea95a5384e6420304eb1d26cef2a4c80d0690c924`；镜像 `sha256:49c61e15637d65253492a3e6083252047d43ed559b7af9b3f67c22ac2fb4f512`。恢复点位于云主机私有目录 `/home/pechen/AI/codex-own-access/handoff-board-backup.bXW3qYTN`，包含数据库、配置及旧镜像/源码引用。

最终开发版验收：构建 `out/dev-build-1UFpWw.noindex`，源码指纹 `f4ac5a3bdcc6060024d31e1c9b4232781aacd13faa1b4b8fc3beb065a17e2101`。默认私有安装、内部企业授权及公开npm next消费已通过实测；新连接使用公开 `@petercjl/tuda@0.1.0`，发现29个工具，企业空间及画板列表读取成功。定向回归10项通过。本段为构建后的文档更新，不改变已安装运行时代码。
