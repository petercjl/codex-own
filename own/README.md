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

## 更新后的自动清理

从桌面 0.6.4 起，主界面加载并持续正常运行 30 秒后，codex-own 会确认当前受管理版本，再自动清理已成功安装的完整归档和已退出的更新助手。升级前的程序及配置/对话快照成套保留最近一次完整回滚，更早且有成功事务记录的备份会回收。当前应用、密钥、配置、对话、独立 Node/npm/Python 运行时及手动备份保持完整。

已校验分片缓存默认上限为 2 GiB，优先回收长期未使用的分片；待安装或失败更新需要的分片受保护，期间可能暂时超过上限。无法识别的目录、未完成事务、被占用文件和不完整的回滚资料会保留。清理异常不影响当前应用及正常更新；“更新”窗口会显示本次启动回收的空间。清理计划、结果和启动确认记录各保留最近 20 条。

可直接发给 Agent：

> 请检查 codex-own 的更新文件占用，并预览自动清理范围和保留的回滚备份。

> 请通过 @petercjl/codex-own 清理已用完的更新文件和更旧的受管理备份，保留最近一次完整回滚。

开发者入口：`codex-own cleanup plan` 只读预览；`codex-own cleanup run --yes` 按相同策略执行。`--cache-limit-mib <0..16384>` 可指定本次清理的缓存上限。清理需要当前桌面已记录成功启动；仅升级 npm 管理工具不会产生这份启动证明。清理使用安装操作锁，原版 Codex 和系统/npm 全局缓存不在范围内。

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

**API Key 文件路径必须改为你实际下载的位置，不能直接复制占位路径。** 配置前先保存任务；命令会关闭 codex-own，完成配置后从 Mac“应用程序”打开 codex-own。

```bash
apiKeyFile="【填写 API Key 文件的实际完整路径】"
if [ -f "$apiKeyFile" ]; then
    ownPattern='^/Applications/codex-own[.]app/Contents/'
    pkill -TERM -f "$ownPattern" || true
    for i in {1..10}; do
        pgrep -f "$ownPattern" >/dev/null || break
        sleep 1
    done
    pkill -KILL -f "$ownPattern" || true
    "$HOME/.local/bin/codex-own" configure --api-key-file "$apiKeyFile" --yes &&
    "$HOME/.local/bin/codex-own" doctor
else
    printf '%s\n' "请先填写 apiKeyFile，确认文件路径和文件名正确。"
fi
```

以后更新：先退出 codex-own，再更新 npm 管理工具和桌面程序。配置与对话保存在 ~/Library/Application Support/codex-own-independent。

```bash
npm install --global --prefix "$HOME/.local" @petercjl/codex-own@latest
"$HOME/.local/bin/codex-own" update check
"$HOME/.local/bin/codex-own" update install --yes
```

## 在 Windows 上通过 PowerShell 安装和测试

适用于 Windows x64，使用包含 npm 的官方 Node.js 22+ x64 发行包。可使用系统安装或用户目录的官方便携版。先核对实际 node.exe 位置；多套 Node、第三方 Agent 便携 Node 和 npm 的 .cmd 入口可能选择不同运行时。

**下列 $node 使用常见安装路径。请按实际 Node 安装位置修改后执行。** 普通用户 PowerShell 即可，无需改变脚本执行策略。建议首次安装预留至少 10 GB；更新还需保留旧程序和用户数据快照所需空间。

第一步：在当前窗口设置 UTF-8，并检查真正执行安装的 Node 和 npm：

```powershell
$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
chcp.com 65001 > $null
$node = "C:\Program Files\nodejs\node.exe"
if (-not (Test-Path -LiteralPath $node -PathType Leaf)) { throw "请填写实际的 Node.js 22+ x64 可执行文件路径。" }
$bootstrap = (& $node -p 'JSON.stringify({version:process.versions.node,arch:process.arch,executable:process.execPath})') | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or [int]($bootstrap.version.Split('.')[0]) -lt 22 -or $bootstrap.arch -ne "x64") { throw "安装引导要求 Node.js 22+ x64，请核对实际路径。" }
$bootstrap | Format-List
$npmCli = Join-Path (Split-Path -Parent $node) "node_modules\npm\bin\npm-cli.js"
if (-not (Test-Path -LiteralPath $npmCli -PathType Leaf)) { throw "所选 Node 目录缺少 npm，请使用包含 npm 的官方 Node.js 发行包。" }
& $node $npmCli --version
if ($LASTEXITCODE -ne 0) { throw "npm 检查失败。" }
```

第二步：通过同一个 Node 安装并调用管理工具：

```powershell
& $node $npmCli install --global @petercjl/codex-own@latest --registry=https://registry.npmjs.org
if ($LASTEXITCODE -ne 0) { throw "管理工具安装失败。" }
$npmRoot = (& $node $npmCli root --global).Trim()
if ($LASTEXITCODE -ne 0) { throw "无法取得 npm 全局目录。" }
$codexOwn = Join-Path $npmRoot "@petercjl\codex-own\bin\codex-own.mjs"
& $node $codexOwn install --yes --progress stdout
if ($LASTEXITCODE -ne 0) { throw "桌面安装失败，请保留错误并先诊断。" }
```

第三步：验收结果。doctor 的 bootstrap 应指向所选 Node；installed 有版本，lock 为 false，pendingTransactions 为空；runtime doctor 验证独立 Node/npm/Python。先完成 API 配置，再从 Windows 开始菜单打开 codex-own。

```powershell
& $node $codexOwn doctor --json
& $node $codexOwn version
& $node $codexOwn runtime doctor
```

$node、$npmCli、$codexOwn 仅对当前窗口有效；换窗口后按前两步重新赋值。已有未受管理的独立安装可用 install --adopt --yes 接管并保留备份。程序位于 %LOCALAPPDATA%\Programs\codex-own\current，配置和对话位于 %LOCALAPPDATA%\codex-own-independent。

**API Key 文件路径必须改为你实际下载的位置，不能直接复制占位路径。** 配置前先保存任务并退出 codex-own；已有可用配置可跳过。安装验收无需 API Key。

```powershell
$apiKeyFile = "【填写 API Key 文件的实际完整路径】"
if (-not (Test-Path -LiteralPath $apiKeyFile -PathType Leaf)) { throw "请先填写实际 Key 文件路径。" }
Get-Process -Name "codex-own" -ErrorAction SilentlyContinue | Stop-Process -Force
if (Get-Process -Name "codex-own" -ErrorAction SilentlyContinue) { throw "应用尚未完全退出。" }
& $node $codexOwn configure --api-key-file $apiKeyFile --yes
if ($LASTEXITCODE -ne 0) { throw "API 配置失败。" }
```

日常优先使用应用内“更新”。需要手动更新时，退出应用，用同一 $node 和 $npmCli 更新 @petercjl/codex-own@latest，再执行 & $node $codexOwn update install --yes --progress stdout。保留配置与对话。

## 安装失败与恢复

安装器直接读取 TAR/PAX/gzip/ZIP 归档中的 Unicode 名称、类型、大小及内容 SHA256，核对解压结果，最多重试 3 次。UNPACK_INCOMPLETE/UNPACK_FAILED 提供缺失样例；持续缺失同一批 DLL 或脚本时检查安全软件拦截记录和可信来源，按设备安全策略处理，安装器不会关闭防护。正常和失败安装都尝试清理本次 staging，被占用目录会报告并保留，已校验分片缓存仍可复用。

Windows 先查看诊断及恢复计划：

```powershell
& $node $codexOwn doctor --json
& $node $codexOwn repair plan
```

确认 allowed: true 并同意回收失败安装的临时目录后：

```powershell
& $node $codexOwn repair run --yes
& $node $codexOwn doctor --json
```

Mac 使用 "$HOME/.local/bin/codex-own" doctor --json、repair plan 和 repair run --yes。恢复备份并移走确认死亡进程的 operation.lock，清理 inactive stage 和有所有权回执的 next 副本；保留应用、配置、密钥、对话、缓存及回滚。活动或未知锁、recovery.lock 和未完成事务需要维护者检查，不能通过删文件强行继续。

默认 stdout 仅为 JSON，进度走 stderr；--progress stdout 是交互终端显示模式，与 --json 互斥；--quiet 关闭进度。CLI 入口在加载管理器前验证 Node 22+。doctor.bootstrap 返回实际可执行路径、版本及架构。

可发送给 Agent：

> 请检查 codex-own 的安装环境和失败残留，使用 @petercjl/codex-own 的恢复计划诊断，保留配置与对话。

> 请通过 @petercjl/codex-own 修复已确认可清理的安装残留，然后重试安装。
