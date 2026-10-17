# codex-own

独立桌面应用的 npm 安装与更新工具。支持 Mac ARM64 和 Windows x64。管理工具和桌面资源均从 npm 下载。

## 独立 Node、npm 和 Python

从 0.5.0 起，安装或更新桌面程序会同时安装其固定版本的独立工具。第一版为 Node 24.22.0、npm 11.19.1、Python 3.12.15，保留发行包自带许可证。资源通过 npm 内容包分发，接收端无需连接 GitHub 或 Node/Python 下载站。工具版本独立于桌面版本；后续桌面更新复用相同工具和已校验分片。

Mac 工具位于 `~/Library/Application Support/codex-own-independent/runtimes`，Windows 位于 `%LOCALAPPDATA%\codex-own-independent\runtimes`。版本目录、npm 全局包与缓存、pip 缓存和 Python 字节码均归 codex-own 所有。应用启动后只为自己的进程及工作子进程设置 PATH；用户/系统 PATH、shell 配置和原版 Codex 缓存保持不变。项目的 `node_modules` 和 Python `.venv` 继续保存在项目中。Python 包安装使用项目虚拟环境，pip 默认要求虚拟环境，保证工具版本目录稳定。

Mac 任务使用运行时目录内的私有 zsh 启动文件和 Bash `BASH_ENV`，保证登录 shell 仍优先选择独立工具。这些配置只在 codex-own 进程中生效，用户原有 shell 文件保持不变。

可直接发给 Agent：

> 请检查 codex-own 的独立 Node、npm 和 Python 运行时，并验证实际执行路径。

> 请通过 @petercjl/codex-own 更新 codex-own 及其独立运行时，保留配置和对话。

开发者和终端测试入口：`codex-own runtime doctor` 查看工具版本和实际路径；`codex-own runtime run -- node --version`、`codex-own runtime run -- npm --version`、`codex-own runtime run -- python --version` 可在应用外使用同一套工具。`runtime env` 只返回工具环境合同，不输出 API Key 或继承的账户信息。独立更新使用 `runtime update --yes`，回到上个工具版本使用 `runtime rollback --yes`；已运行的应用在重启后采用新版本。安装失败保持原有活动版本，保留可恢复的版本记录。

首次通过 npm 安装管理工具仍需要机器已有 Node.js 22+ 和 npm；这只是引导安装的前提。安装完成后，桌面任务和应用内更新使用 codex-own 自己的工具。此工具集包含 Node、npm、Python、pip、venv；原版完整办公依赖集合、Git、编译器和额外项目库按实际任务另行安装。

从 0.4.x 的应用内更新按钮升级时，新应用首次打开会显示“正在准备 codex-own 工作环境”，自动从 npm 补齐工具并验证后再进入桌面。下载失败或取消后可重新打开重试，已验证分片会保留。

## Windows Agent 的命令环境

Windows 桌面在启动 Agent 会话时自动检测并验证系统安装的 Git Bash。通用命令优先显式使用 Bash；注册表、COM、Windows 服务及 PowerShell cmdlet 等操作显式使用 PowerShell。没有可用的 Git Bash 时保留 PowerShell 后备，并报告缺失或无法运行的原因。Git Bash 由系统的 Git for Windows 提供，独立 Node/npm/Python 继续来自 codex-own 私有运行时。

该行为随桌面程序交付，新建、恢复和派生会话均适用，保留用户已有指令与配置。集成终端下拉选项仍单独控制手动终端。底层 Windows 主机环境可以显示 PowerShell；实际执行的 shell 以工具调用中的 `shell` 和执行结果为准。失败命令不会被自动换 shell 重跑。

`codex-own doctor` 的 `agentShell` 显示发现的 Bash、PowerShell 路径和后备原因；`desktopAdapterBundled` 表示当前桌面是否包含此能力。只更新 npm 管理工具时，旧桌面需要继续完成桌面更新。复杂 JSON 或脚本优先通过 UTF-8 文件传递。

## 独立组件版本

组件绑定合同 2 分别记录 npm 管理器版本、桌面成品版本和 Node/npm/Python 工具版本。管理器升级可以继续使用已验证的旧桌面和工具；版本号不同是正常的。更新检查按绑定的实际组件判断，相同桌面无需退出、重新下载或切换程序。工具更新保留桌面，重启后采用新工具路径。

现有 0.5.1 客户端首次切换需要一个支持此合同的桥接桌面版本。之后的 CLI、Skill 和说明文档小更新可以走轻量发布。开发和发布流程见仓库中的 `ARTIFACT-LIFECYCLE.md`；公开 npm 当前版本以注册表为准。

## 应用内更新

带有 npm 更新组件的桌面版本会在启动 15 秒后、以及运行期间每 6 小时检查稳定版。也可以打开菜单“更新 → 检查 codex-own 更新…”。发现新版后点击“下载更新”，下载期间可以继续使用 App。下载完成后结束正在运行的任务，点击“重启并安装”；更新进程会等待 App 退出，备份程序及独立数据，再安装并重新打开。

从 0.6.3 起，Mac 菜单栏和 Windows 标题栏的独立“更新”入口会显示提醒：`更新 ↓` 表示有新版可下载，`更新 ✓` 表示已下载、等待重启安装。提醒在关闭更新窗口后保留；菜单重建或 Windows 窗口重新加载后继续显示。自动检查仅在应用运行时进行，下载和重启安装由用户确认。

日常应用内更新使用随 App 交付的更新组件，无需手动更新全局 npm 管理工具。API Key、配置、对话和语言偏好会保留。断网时当前 App 保持可用；下载失败可以重试，已校验分片会复用；已准备好的更新会在下次打开时恢复。旧版本首次升级到带更新组件的版本，以及故障恢复，可以使用下文的终端更新命令。

## 增量下载

从 0.4.0 起，更新前会扫描已安装的 codex-own 程序，复用与新版相同的内容块，只从 npm 下载缺少的块。支持跳过版本；首次安装仍下载完整资源。进度会显示“复用多少块、需要下载多少 MiB、全量多少 MiB”，结果中的 `transfer` 保留这些统计。少量代码改动通常只影响部分块；上游引擎、大型二进制或签名资源变化时，下载量会相应增加。

0.3.x 首次迁移：先退出 codex-own，使用下文对应系统的终端命令更新 npm 管理工具，再执行桌面更新。升级后的管理工具即可从现有程序复用内容。之后直接使用应用内“更新”菜单，随 App 交付的更新组件会自动执行相同的增量下载。

本地扫描只读取程序目录，密钥、配置和对话继续保存在独立数据目录。下载结束后在本地重建完整归档、核对 SHA256，再备份并切换程序。请继续预留完整安装和备份的磁盘空间。

## 在 Mac 上通过 Terminal 安装和更新

适用于 Apple 芯片 Mac（ARM64）。从 Node.js 官网安装 LTS 版本（要求 Node.js 22 或以上，包含 npm），重新打开 Terminal。建议预留 10 GB 空间，用于下载、解压和备份。

[Node.js 官方下载](https://nodejs.org/en/download)

安装验收只需完成前三步。无需 Agent、API Key 或模型登录。

第一步：检查环境并安装 npm 管理工具。以下工具安装在当前用户的 ~/.local。逐段执行，每一步成功后再继续。

```bash
node --version
npm --version
npm install --global --prefix "$HOME/.local" @petercjl/codex-own@latest
```

第二步：安装桌面程序。管理工具按当前平台从 npm 下载资源分片，依次显示下载进度、校验、解压和安装阶段。

```bash
"$HOME/.local/bin/codex-own" install --yes
```

若已有手动安装的 codex-own，请先退出应用，将第二步命令替换为以下命令，备份后接管原安装。

```bash
"$HOME/.local/bin/codex-own" install --adopt --yes
```

第三步：检查安装结果。安装结果应显示 ok: true、downloadSource: registry.npmjs.org；doctor 中 installed 有版本且 lock 为 false，version 显示管理工具和桌面版本。应用位于 /Applications/codex-own.app。

```bash
"$HOME/.local/bin/codex-own" doctor
"$HOME/.local/bin/codex-own" version
```

可选：需要使用模型时，再配置 API Key 并启动。将只包含一行 DashScope API Key 的文件放到下载目录，命名为 codex-own-api-key.txt；文件在其他位置时修改路径。配置前退出应用，已有可用配置可跳过配置命令。

```bash
"$HOME/.local/bin/codex-own" configure --api-key-file "$HOME/Downloads/codex-own-api-key.txt" --yes
"$HOME/.local/bin/codex-own" launch
```

以后更新：先退出 codex-own，再更新 npm 管理工具和桌面程序。配置与对话保存在 ~/Library/Application Support/codex-own-independent。

```bash
npm install --global --prefix "$HOME/.local" @petercjl/codex-own@latest
"$HOME/.local/bin/codex-own" update check
"$HOME/.local/bin/codex-own" update install --yes
```

## 在 Windows 上通过 PowerShell 安装和测试

适用于运行 x64 Node.js 的 Windows。先从 Node.js 官网安装 Windows x64 的 LTS 版本（要求 Node.js 22 或以上，包含 npm），再重新打开普通用户 PowerShell。建议预留 10 GB 空间，用于下载、解压和备份。

[Node.js 官方下载](https://nodejs.org/en/download)

安装验收只需完成前三步。无需 Agent、API Key 或模型登录。

第一步：检查环境并安装 npm 管理工具。使用 .cmd 入口，无需修改 PowerShell 脚本执行策略。逐段执行，每一步成功后再继续。

```powershell
node --version
node -p "process.arch"
npm.cmd --version
npm.cmd install --global @petercjl/codex-own@latest
```

process.arch 应输出 x64。第二步：解析命令路径并安装桌面程序。$codexOwn 只在当前窗口有效；打开新窗口后重新执行赋值行。

```powershell
$codexOwn = Join-Path (npm.cmd prefix --global) "codex-own.cmd"
& $codexOwn install --yes
```

管理工具和桌面资源全部从 registry.npmjs.org 下载。Windows 桌面资源约 1 GB，具体大小随版本变化。最多并行下载 4 个分片，安装时显示分片编号、下载百分比和已接收大小，然后显示校验、解压、安装。看到“安装完成”和 ok: true 才表示完成。

若已有手动安装的 codex-own，先退出应用，将第二步的安装命令替换为以下接管命令；原安装会被备份。

```powershell
& $codexOwn install --adopt --yes
```

第三步：检查安装结果。doctor 中 installed 应有版本、lock 为 false，pendingTransactions 为空；开始菜单出现 codex-own。仅检查安装时，configured: false 是正常状态。

```powershell
& $codexOwn doctor
& $codexOwn version
```

程序目录：%LOCALAPPDATA%\Programs\codex-own\current。配置与对话目录：%LOCALAPPDATA%\codex-own-independent。二者独立于原版 Codex。

安装测试通过后即可停止；账号配置和模型对话属于后续使用测试。

可选：需要使用模型时，将只包含一行 DashScope API Key 的文件放到下载目录，命名为 codex-own-api-key.txt。配置前先退出应用，文件位置不同则修改路径；已有可用配置可跳过配置命令。

```powershell
& $codexOwn configure --api-key-file "$HOME\Downloads\codex-own-api-key.txt" --yes
& $codexOwn launch
```

以后更新：先退出 codex-own，再执行以下命令。更新保留独立配置和对话。

```powershell
npm.cmd install --global @petercjl/codex-own@latest
$codexOwn = Join-Path (npm.cmd prefix --global) "codex-own.cmd"
& $codexOwn update check
& $codexOwn update install --yes
```

下载失败：连续 30 秒无数据会重试当前分片，最多 3 次。出现 DOWNLOAD_FAILED 时检查 npm 网络连接，再执行同一安装命令；已校验分片会复用。下载期间按 Ctrl+C 可以取消。遇到 BUSY 时先确认是否有另一安装进程，保留错误信息，不直接删除锁文件。

npm 安装出现缓存 ENOENT 或缓存损坏提示时，先检查缓存，再重新安装 npm 工具：

```powershell
npm.cmd cache verify
npm.cmd install --global @petercjl/codex-own@latest
```

管理工具与桌面版本分别报告。API Key 和用户数据保存在 npm 包之外。更多命令见 `codex-own help`。
