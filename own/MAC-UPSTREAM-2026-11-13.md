# Mac 开发版上游升级与验收（2026-11-13）

## 已验收组合

| 层级 | 采用版本 |
| --- | --- |
| Codex CLI 智能体运行时 / Harness | OpenAI 官方稳定版 `0.167.2` |
| Codex 桌面客户端 | Mac ARM64 `26.1111.21308`，构建 `27194` |
| codex-own 定制层 | 已发布 `0.6.14` 基线，加本次 Claude 工具参数兼容修复 |

定制基线提交为 `016a926b53a475c7a3567efaebae3e59efad8061`。桌面原配 CLI 为 `0.169.0-alpha.11.1`，本组合明确采用上述稳定版 Harness。Mac 开发版已编译、安装并启动，账号、配置与对话保留，升级前应用及数据恢复点已核验。

本次 GitHub 同步包含 Claude 兼容修复、回归测试和本验收记录。Windows 构建与发布等待用户确认；npm 版本和 NAS 安装包保持原状。

## 官方输入与完整性

- 桌面来源：[OpenAI Mac ARM64 appcast](https://persistent.oaistatic.com/codex-app-prod/appcast.xml)。
- 固定桌面输入：[26.1111.21308 官方 ZIP](https://persistent.oaistatic.com/codex-app-prod/ChatGPT-darwin-arm64-26.1111.21308.zip)，大小 `835870020` 字节，SHA-256 为 `8186e39bb166199f648979c7e26c14891908905da3f454b8e6fc2c23a739bae7`。
- 官方应用的完整签名、标识 `com.openai.codex`、OpenAI Team ID `2DC432GLL2`、版本与构建号均已核验。
- CLI 来源：官方 npm `@openai/codex@0.167.2-darwin-arm64`，完整 vendor 资源随开发版保留；包身份、布局、SHA-512 完整性及实际 `codex-cli 0.167.2` 输出均已核验。
- CLI 压缩包 SHA-256：`7dd03256d9c38110e8b5d26bb8f177cc938fa9603ee2f509a2c9fdb877fb363e`。
- CLI 压缩包 SHA-512：`JB6L+L2jefDIaNgoHi7ePZKK1u2riDhlbwgm6zK57ZWpMGAYAwKgDYDb7l+xie7oUkRZuCVx307wsB/k4VsMKw==`。

复建通过 `own/dev.mjs` 的 `--cli-version 0.167.2` 固定 Harness，并以 `--upstream-app` 指定已核验的上述官方桌面输入，再执行 `--install --launch`。两个组件的选择分别记录。

## Claude 参数兼容

新版电脑操控工具包含顶层 `oneOf` 参数定义。Claude Messages 接口会拒绝带此定义的请求。适配层将顶层 `oneOf`、`anyOf`、`allOf` 放入参数封装中，保留原始 Schema，并在工具调用返回和历史恢复时还原原始参数；其他工具继续使用原有合同。

回归检查覆盖组合 Schema、本地引用、原始定义不变、历史恢复，以及电脑操控代码执行和完成摘要两种分支的流式返回、中文与转义内容。

## 实际验证

- 单元检查：`76` 项通过，`1` 项 Windows 专用检查按平台跳过。
- App Server 协议、真实补丁工具、中文与字面转义、中断后恢复、后台重启、历史恢复检查通过。
- 最终安装中的 Claude、公司网关 DeepSeek、百炼 DeepSeek 逐个执行只读终端命令，实际退出码均为 `0`，并回复 `UPGRADE_QA_OK`。
- 原生桌面启动、工作台、输入框与企业登录保护检查通过，原有账号及历史对话可读取。
- 人名入口直接打开原生设置，生图方式为 ToAPIs（内置），默认模型为 GPT Image 2.6 Sunburst；本次核对设置与路由合同，未提交实际生图。
- Tuda、Canva、电脑操控与 Node REPL 的 MCP 启动状态为 `ready`。

官方 `codex_app` 工具桥仍存在 `Codex app tools pipe closed` 启动异常。升级前备份中已有 `41` 次同类记录，最后一条为 `2026-11-13T02:55:33Z`，早于本次安装。该既有问题单独保留，未计入通过项。

## 证据范围

已验收的冻结源码快照指纹为 `7a1611b2a3e07386a6bbb8beaee1835aadfed6b8a9d13362ebf23297e6655b13`。该快照包含本机当时使用的开发生命周期工具改动；本次提交限定为上述产品修复、测试和验收文档。此文档在验收后补充，未改变已安装应用。

完整构建日志、源码清单、三模型真实结果、配置与对话备份、恢复资料及清理清单保存在本机私有构建目录，独立于公开源码与 npm 包。Windows 实测与发布状态需在用户确认后的对应流程中另行记录。
