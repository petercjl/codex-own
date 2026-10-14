# codex-own

独立桌面应用的 npm 安装与更新工具。支持 Mac ARM64 和 Windows x64。管理工具和桌面资源均从 npm 下载。

## 应用内更新

带有 npm 更新组件的桌面版本会在启动 15 秒后、以及运行期间每 6 小时检查稳定版。也可以打开菜单“更新 → 检查 codex-own 更新…”。发现新版后点击“下载更新”，下载期间可以继续使用 App。下载完成后结束正在运行的任务，点击“重启并安装”；更新进程会等待 App 退出，备份程序及独立数据，再安装并重新打开。

日常应用内更新使用随 App 交付的更新组件，无需手动更新全局 npm 管理工具。API Key、配置、对话和语言偏好会保留。断网时当前 App 保持可用；下载失败可以重试，已校验分片会复用；已准备好的更新会在下次打开时恢复。旧版本首次升级到带更新组件的版本，以及故障恢复，可以使用下文的终端更新命令。

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

管理工具和桌面资源全部从 registry.npmjs.org 下载。Windows 桌面下载量约 878 MiB，最多并行下载 4 个分片，安装时显示分片编号、下载百分比和已接收大小，然后显示校验、解压、安装。看到“安装完成”和 ok: true 才表示完成。

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
