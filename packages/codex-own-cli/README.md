# codex-own conversation control

Control conversations through the running codex-own development desktop's own backend. Create chats, send messages, read intermediate tool events, query status, and retrieve final replies. The desktop owns model configuration, authentication, tools, approvals and conversation storage.

Requires Node.js 22+, local command/file access and a development build exposing control contract 1. macOS ARM64 is the initial live target; Windows is unverified. Any Agent satisfying these capabilities can use the package. The caller resolves its own Skill directory. This local candidate is not published to npm.

Send the current Agent: “使用 codex-own-cli，在开发版创建一个对话，发送‘列出 Tuda 画板’，展示工具调用过程和最终结果。”

Install and update procedures are in [INSTALL.md](INSTALL.md) and [UPDATE.md](UPDATE.md). A complete installation includes the CLI and a physical, independently executable copy of its companion Skill/runtime. Configuration, endpoint tokens and transcripts remain outside this package.

Developer commands are discoverable with `codex-own-cli help` and `capabilities --json`. Defaults select the local development profile. `--root` explicitly selects another compatible control profile. Mutations return operation IDs on stderr; preserve them before retrying. Events have bounded cursors; an expired cursor requires a fresh snapshot. The package does not approve requests, edit model credentials or start a separate backend. Read-only status and event queries do not call a model.
