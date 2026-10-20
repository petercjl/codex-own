# codex-own 完整安装包

首次安装可选择图形安装包，后续通过应用内“更新”菜单从 npm 获取增量资源。公开的 `@petercjl/codex-own` 命令行安装方式继续保留。

## 下载安装包

从本项目 GitHub Release 中标题为“codex-own <版本> 完整安装包”的页面下载：

| 系统 | 文件 |
| --- | --- |
| Windows x64 | `codex-own-<版本>-windows-x64-setup.exe` |
| Mac Apple 芯片 | `codex-own-<版本>-mac-arm64.dmg` |

安装包包含桌面应用、安装管理器以及独立 Node、npm、Python，下载完成后可离线安装。首次使用模型仍需要自行提供 API 访问凭据及网络。请预留至少 10 GB 空间，安装前完全退出 codex-own。

## Windows

1. 双击 Setup EXE，进入安装界面。
2. 如需配置 API，在“API 配置文件”页面选择自己保存的 txt 文件。**文件位置以你实际的下载或保存位置为准**；已有配置时可跳过。
3. 点击安装，等待完整资源校验与安装完成。
4. 从 Windows 开始菜单找到 **codex-own** 并打开。

应用安装在当前用户的 `%LOCALAPPDATA%\Programs\codex-own\current`，独立数据目录为 `%LOCALAPPDATA%\codex-own-independent`。安装器提供 Windows 应用卸载入口；卸载程序时保留配置、密钥、对话和恢复备份。

## Mac

1. 双击 DMG，打开其中的 **codex-own 安装器**。
2. 如需配置 API，点击“选择 API 配置 txt”，选取自己保存的文件。**请按文件实际位置选择**；已有配置时可跳过。
3. 点击“安装 codex-own”，等待完成。
4. 从 Finder 的“应用程序”中打开 **codex-own**。安装成功后可推出安装磁盘。

应用安装在 `/Applications/codex-own.app`，独立数据目录为 `~/Library/Application Support/codex-own-independent`。当前 Mac 目标为 Apple 芯片，安装账户需要具有“应用程序”目录的写入权限。

## 后续更新与数据

在应用中打开 **更新 → 检查 codex-own 更新**，下载后按提示重启安装。它与命令行入口使用相同的版本绑定、增量分片及恢复机制。

API 文件只在本机读取，密钥不进入安装包和更新服务器。正式版、开发版及原版 Codex 使用各自的数据目录。重复安装保留已有配置与对话；较旧安装包会拒绝覆盖更新版本。未知已有安装会保留原目录，并提示先进行修复。

安装成功后可删除下载的 EXE 或 DMG；应用内更新无需保留首次安装文件。

## 当前验证与签名状态

发布附带安装包 SHA-256 和双端验证记录。自动化验证覆盖 Windows Setup 执行、Mac DMG 内安装工作器、离线安装、重复安装、API 配置导入、独立运行时及现有更新器接管。交互式界面操作与真实下载后的系统提示需在使用机器上继续验收。

当前 Mac 安装器使用项目自签名身份，尚未完成 Apple 公证；Windows 安装器尚未配置组织持有的受信任 Authenticode 证书。系统可能提示无法验证发布者。请核对本项目下载来源与附带校验清单，再按系统针对该应用提供的确认流程操作；不要全局关闭系统保护。公司广泛分发前应完成可信签名、公证与真实机器验收。
