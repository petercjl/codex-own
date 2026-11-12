# macOS 开发版构建与安装

## 日常开发与正式发布

默认顺序为：修改源码 → 在 Mac 构建并安装开发版 → 自动验证和实际功能测试 → 用户确认并授权发布 → Windows 自动构建与基础检查 → 发布 npm → Windows 安装后抽查。peter-new 人工测试按需安排。

正式发布目标为 `win32-x64`，包括 Windows 桌面和配套 Node/npm/Python 运行时。Mac 只维护本机开发版；历史 Mac 制品保留。CI 构建、清单合并、验收证明、npm 内容块及发布前打包检查使用一致的 Windows 目标，历史双平台绑定仍按其原始平台集合验证。Mac 开发运行时使用 `own/runtime/mac-development.json` 中保留的独立来源，不依赖后续 Windows 正式包包含 Mac 资源。

每次修改后执行下方的开发构建入口。以本次 `result.json`、`source-inventory.json` 和已安装应用的 `own-development.json` 为验收依据，记录本次功能测试结果。新的产品源码先加入 Git 索引，以进入构建清单。代码变化后重新构建测试，确保正式发布的功能与开发版验收一致。

开发版配置、凭据及对话保留在独立目录，替换应用前创建恢复备份。正式版与原版 Codex 保持各自的安装和数据，只有用户明确要求时才更新正式版。

用户确认测试通过并要求发布后，通过现有 npm-release-kit / GitHub Actions OIDC 流程发布，执行 Windows 自动构建和基础检查，发布后核对准确版本与渠道。日常更新通过 npm；完整离线安装包和 NAS 交付仅在用户明确要求时手动执行。每日上游同步保留自动检查、验证和无冲突合并，后续只运行 `verify_only` 发布前检查，等待开发版实测后再正式发布。

## 构建入口

源码入口是仓库根目录；正式版与开发版共用 `own/` 的实现。
开发版专用脚本负责本地构建、验证、备份和安装，底层继续使用 `own/build.mjs`。

在仓库根目录运行：

```sh
node own/dev.mjs --install --launch
```

仅构建和验证时运行 `node own/dev.mjs`，查看参数运行 `node own/dev.mjs --help`。
评估指定官方稳定版 CLI 时，运行 `node own/dev.mjs --cli-version 0.167.1 --install --launch`。
该选项从官方 npm 包下载固定版本，校验 SHA-512 完整性、包身份、布局与实际版本，保留完整配套资源，并将来源与摘要写入本次构建记录。此覆盖入口仅用于本地 Mac 开发版。
开发版应用尚未安装时，入口先验证候选、备份已有开发版数据，再进行首次安装；验证失败的候选保留在报告目录。
单独评估 CLI 与现有桌面外壳的兼容性时，追加 `--upstream-app /Applications/ChatGPT.app` 明确选择本机官方输入。入口验证 OpenAI 官方签名，并分别记录所选外壳版本、CLI 版本及其与当前官方桌面版本的关系。
安装命令应从开发版以外的终端或 Agent 执行。脚本仅支持 macOS ARM64，要求已安装仓库依赖、独立 Node 22+ 和已配置可信的开发签名身份。

脚本冻结当前提交及工作区已跟踪文件，另收录本入口、开发说明和入口测试。其他未跟踪文件需先加入 Git 索引，才成为构建输入。冻结时发现文件变化会停止；冻结后的修改留给下一次构建。源码清单与摘要保存在报告目录，依赖使用本机已安装版本。

每次构建使用全新 `out/dev-build-*.noindex` 目录，记录提交、源码摘要、签名指纹、实际 Node 版本和各阶段日志。先查询当前官方 Mac 版本；本机原版 App 的版本、构建号和官方签名全部通过校验时，直接复用其只读程序输入，否则同步下载官方输入。两条路径随后都完整应用当前上游适配与产品源码，并验证包签名、隔离后台握手、离线模型协议、真实工具与补丁调用、中断后恢复，以及真实桌面工作台和输入框。验证使用隔离测试配置和本地模拟服务。

全部验证通过后，安装流程正常退出开发版，等待其主进程与后台退出，备份开发版数据，再替换固定位置 `/Applications/codex-own 开发版.app`。备份保留文件权限、时间及符号链接，临时通信 socket 单独记录并跳过。旧 App 保存在本次报告目录的 `previous-development.bundle`；安装签名校验失败会恢复旧 App，失败候选另存。安装后启动失败会记录错误并保留备份，供检查。

开发版继续使用 `~/.codex-own-dev/Library/Application Support/codex-own-independent`，固定 Bundle ID 为 `local.codex-own.development`。配置、认证与对话保持原位，npm 自动更新处于关闭状态。

结果入口为本次目录中的 `result.json`，其中包含旧 App 和数据备份路径。签名证书与密钥由既有本机开发签名配置管理。脚本不执行发布；正式版发布由仓库现有流程管理。

## Tuda 独立软件边界

Tuda 与 codex-own 分别安装、版本管理和发布。codex-own 仅打包经过摘要和能力合同核验的 Tuda board-only 插件/CLI/MCP 连接组件；通过已运行的独立 Tuda 本地协议连接，宿主退出保留 Tuda。开发入口验证连接包，打包检查拒绝 Tuda 桌面树。独立软件与插件更新分别处理；真实桌面版本、协议和授权隔离核对通过后再交接员工身份。Dev 联调复用现有实例与明确 userDataPath。当前合同、生产端缺口及验收边界见 `own/TUDA-INTEGRATION-HANDOFF.md`（从 own 目录访问时为 `TUDA-INTEGRATION-HANDOFF.md`）。
