# 公司 Skill 与 CLI 工具集

codex-own 订阅公开 npm 包 `@petercjl/taobao-ai-ops` 的能力集合合同 v1，安装到各自独立数据根下的 `company-tools`。集合负责组件注册、版本解析、完整 Skill 与运行时准备；codex-own 负责私有 Node/npm、候选验证、原生发现、启用和诊断。各组件继续负责业务方法、服务登录及操作授权。

首次启动下载 latest 稳定版集合和全部注册成员，关闭 npm 安装脚本，核对集合身份、成员版本、运行入口、资源 SHA-256 及路径边界。完整候选通过检查后安装到原生 Skill 目录。每个 Skill 携带 `.collection-runtime.json`，Agent 用其准确入口和环境执行；私有 PATH 包含固定的 `company-tools/bin`，套件和成员 CLI 每次调用均解析当前已启用版本。工具集安装不配置外部业务账户。

应用打开后 15 秒及每六小时检查并更新集合和全部成员，即使集合版本未变也检查成员。默认纳入以后注册的新成员，并沿用 sealwork 的 stable latest 前进更新策略，包含主版本或 0.x 次版本迁移；候选中仍被拦截的成员会阻止启用。候选验证完成后在线切换 Skill 目录与活动版本指针，通过当前 App Server 的 `skills/list`（`forceReload: true`）刷新缓存，并通知原生界面失效重取。新命令同样放入固定 PATH 目录，移除命令保留可诊断的入口，防止回退到旧版本。已启动的 CLI 继续使用其已加载版本，旧运行时保留可用。

新建组件发布后，登记到 taobao-ai-ops 并发布集合；既有组件升级只需发布该组件。员工通过 codex-own 获得完整集合，日常无需手动安装单个 Skill。

侧栏的“公司工具集”提供独立管理页面，以每个 npm 包一行的表格展示名称、包名、能力类型和版本。“检查更新”查询可用版本；“更新工具集”下载、校验并立即启用。“自动检查并更新”开关持久保存，关闭后仍可手动更新。状态与进度条反映检查、下载准备、校验、启用和 Skill 刷新阶段；下载量未知时显示不定进度。已下载的旧式候选可直接在线应用，Skill 缓存刷新失败可单独重试。主进程验证应用页面来源，统一串行处理自动和手动操作。

离线、下载、合同、资源校验或原生安装失败保留现有集合。本地 Skill 或命令入口修改、未知所有权目标会阻止替换；恢复副本及不可变旧运行时保持可用。状态见独立数据根的 `company-tools/status.json`，记录 current、available、activated、failed、检查时间与错误阶段。`active.json` 记录当前和上一代；`pending.json` 保留激活事务的中断恢复点。配置、凭据、对话和其他独立 Skill 保持各自管理。

维护代码位于 `lib/company-tools.mjs`，启动门控和后台检查位于 `desktop/company-tools.cjs`。构建和离线 GUI 探针使用 `OWN_COMPANY_TOOLS_AUTO_UPDATE=0` 冻结获取；真实开发版另行验证公开 npm 安装、原生 Skill 发现及 CLI 调用。Mac 开发实测、Windows CI 与正式发布分别记录真实证据。
