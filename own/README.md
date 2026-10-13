# codex-own

独立桌面应用的 npm 安装与更新工具。支持 Mac ARM64 和 Windows x64。Node.js 22 或以上为必要环境。

## 在 Mac 上通过 Terminal 安装和更新

适用于 Apple 芯片 Mac（ARM64）。先从 Node.js 官网安装 LTS 版本（要求 Node.js 22 或以上，包含 npm），然后重新打开 Terminal。以下命令逐段执行，每一步成功后再继续。

[Node.js 官方下载](https://nodejs.org/en/download)

第一步：检查环境并安装 npm 管理工具。工具安装到当前用户的 ~/.local，后续使用完整路径运行。

```bash
node --version
npm --version
npm install --global --prefix "$HOME/.local" @petercjl/codex-own@latest
```

第二步：首次安装桌面应用。此步骤会下载程序，完成后应用位于 /Applications/codex-own.app。

```bash
"$HOME/.local/bin/codex-own" install --yes
```

如果已有手动安装的 codex-own，请先退出应用，将第二步替换为下面的接管命令。工具会备份已有安装，并保留独立配置和对话。

```bash
"$HOME/.local/bin/codex-own" install --adopt --yes
```

第三步：配置 API Key。将单独的 Key 文件放到下载目录，命名为 codex-own-api-key.txt，文件只包含一行有效的 DashScope API Key。文件在其他位置时修改命令中的路径。已有可用配置可以跳过这一步；配置前先退出 codex-own。

```bash
"$HOME/.local/bin/codex-own" configure --api-key-file "$HOME/Downloads/codex-own-api-key.txt" --yes
```

第四步：检查并启动。doctor 输出安装路径和配置状态，version 分别显示管理工具与桌面版本；两者版本号可以不同。

```bash
"$HOME/.local/bin/codex-own" doctor
"$HOME/.local/bin/codex-own" version
"$HOME/.local/bin/codex-own" launch
```

以后更新：先退出 codex-own，再执行以下命令。npm 更新管理工具，update install 更新桌面应用。配置、Key 和对话保存在 ~/Library/Application Support/codex-own-independent，更新时保留。

```bash
npm install --global --prefix "$HOME/.local" @petercjl/codex-own@latest
"$HOME/.local/bin/codex-own" update check
"$HOME/.local/bin/codex-own" update install --yes
"$HOME/.local/bin/codex-own" launch
```

## 在 Windows 上通过 PowerShell 安装和测试

适用于 Windows x64。先从 Node.js 官网安装 Windows x64 的 LTS 版本（要求 Node.js 22 或以上，包含 npm），然后重新打开普通用户 PowerShell。以下命令逐段执行，每一步成功后再继续。

[Node.js 官方下载](https://nodejs.org/en/download)

第一步：检查环境并安装 npm 管理工具。使用 npm.cmd 和 codex-own.cmd 执行，无需调整 PowerShell 脚本执行策略。

```powershell
node --version
npm.cmd --version
npm.cmd install --global @petercjl/codex-own@latest
```

第二步：安装桌面应用。先解析 npm 工具的实际路径，再调用安装命令。$codexOwn 变量只在当前 PowerShell 窗口有效；新开窗口后请重新执行赋值行。

```powershell
$codexOwn = Join-Path (npm.cmd prefix --global) "codex-own.cmd"
& $codexOwn install --yes
```

如果已有手动安装的 codex-own，请先退出应用，将安装命令替换为下面的接管命令。接管前会备份已有安装。

```powershell
& $codexOwn install --adopt --yes
```

第三步：将单独的 API Key 文件放到下载目录，命名为 codex-own-api-key.txt。文件只包含一行有效的 DashScope API Key。文件在其他位置时修改路径；已有可用配置可以跳过这一步。配置前先退出 codex-own。

```powershell
& $codexOwn configure --api-key-file "$HOME\Downloads\codex-own-api-key.txt" --yes
```

第四步：检查并启动。安装后也可从开始菜单打开 codex-own。

```powershell
& $codexOwn doctor
& $codexOwn version
& $codexOwn launch
```

程序目录：%LOCALAPPDATA%\Programs\codex-own\current。配置和对话目录：%LOCALAPPDATA%\codex-own-independent。它们与原版 Codex 的目录独立。

测试时先发送一条简单消息，确认模型正常回复；关闭应用后重新打开，确认对话保留。Windows 的 npm 安装、配置隔离和底层服务连接已通过自动检查，图形界面体验由本机测试确认。

以后更新：先退出 codex-own，再执行以下命令。

```powershell
npm.cmd install --global @petercjl/codex-own@latest
$codexOwn = Join-Path (npm.cmd prefix --global) "codex-own.cmd"
& $codexOwn update check
& $codexOwn update install --yes
& $codexOwn launch
```

故障记录：如果某一步出现错误，先停止后续操作，保留错误输出，并运行 doctor 和 version。反馈时附上这些输出与弹窗截图；API Key 文件只用于配置。

管理工具与桌面版本分别报告。API Key 和用户数据保存在 npm 包之外。更多命令见 `codex-own help`。
