---
name: codex-own-cli
description: Create, send to and inspect conversations in a running codex-own development desktop using its own backend. Use for repeated desktop debugging, intermediate tool events, status and final replies.
---

# codex-own conversation control

Package: `@petercjl/codex-own-cli`, version `0.1.0`. Requires command execution, Node.js 22+, local file access and a running codex-own development build with local control contract 1. The calling Agent may be any host with these capabilities. macOS ARM64 is the first live verification target; Windows remains unverified.

Use this Skill's physically bundled `.runtime/bin/codex-own-cli.mjs` through the current Node.js runtime. Resolve the path relative to this SKILL.md. Do not rely on a different Agent's installation. `version`, `capabilities --json` and `doctor --json` discover the current contract. The runtime owns transport and validation; the Agent owns the user's task, prompt and acceptance criteria.

## Input and output

Input is an authorized conversation task, optional existing chat ID, project directory, selected model, message and event cursor. Output is the real desktop chat/turn ID, observed status, tool events, final reply and any unresolved attention request. Sending can incur normal model/tool costs and side effects; honor the user's scope. Read/status/events do not invoke a model.

## Main line

1. Run `doctor --json`. Default target is the local development profile. Supply `--root` only for an explicitly selected compatible profile. If unavailable, report the error and start/rebuild the requested desktop through its lifecycle tooling; never substitute a standalone App Server. Return here after the desktop is ready.
2. Find an existing chat with `chat list`, or create the requested chat with `chat create --cwd <absolute project directory> --title <title>`. The desktop supplies default model/provider and approvals; `--model` preserves an explicit user selection. Save the returned thread ID and mutation operation ID.
3. Send with `chat send <thread-id> --text <message>` or `--message-file <file>`. Use a stable `--operation-id` for recovery. Capture it from stderr before interpreting a transport failure. The same ID and identical request is safe to query/reuse; a changed request needs a new ID after resolving the old outcome.
4. Read `chat events <thread-id> [--after <cursor>]` for actual intermediate messages/tool calls and retain its returned cursor. Query `chat status` and use `chat wait <thread-id> --timeout 30` for bounded waiting. Keep the user informed on meaningful changes. A timeout means still pending, not failure.
5. On completion, read `chat result` and, when needed, `chat read` for the persisted transcript. Check real tool results and errors against the user's acceptance criteria; a confident final message alone does not prove a tool succeeded. Report the final result with the thread ID so the user can open it in the desktop. Return to step 3 for an authorized next test.

## Branches and recovery

- `needs_attention`: inspect the exact request. When the user has authorized that specific tool action, submit a one-time response with `chat respond <thread-id> --request-id <id> --decision accept --yes`. Otherwise request the missing authorization or use an explicit decline/cancel. This entry supports MCP tool approvals only and never persists permission. Resume status checks after resolution.
- Unknown send/create outcome: inspect `operations read --operation-id <id>`, then chat status/events/list. Do not automatically send again under a new ID. Submitted receipts survive desktop restart; completed receipts return the original result.
- `CHAT_BUSY`: inspect the current turn. Wait, or use `chat interrupt` only when the user authorizes interruption.
- `EVENT_CURSOR_EXPIRED`: recover a snapshot using `chat read` and restart event polling without a cursor. The event ring is process-local and bounded; final transcript is desktop-owned.
- `BACKEND_DISCONNECTED` or `DESKTOP_BACKEND_NOT_READY`: preserve IDs, wait for the selected desktop to reconnect, then return to status. For a persisted chat after reconnect, use `chat resume <thread-id>` before sending. The CLI cannot start an independent writer.
- Failed/interrupted turns: report the recorded error and partial messages. A retry is a new user-authorized turn, distinct from recovering an unknown transport outcome.

## Maintenance

`skill source/status/install/update` accepts an explicit `--target-root` identifying the calling Agent's resolved Skill parent. `update check` is read-only; authorized `update install --target-root <parent> --yes` synchronizes this physical Skill/runtime only and retains a complete backup. Doctor makes a bounded advisory latest check; offline/unpublished candidates retain the current installation. Do not modify other Agent targets. Verify the returned runtime's version and managed hashes, load the installed Skill and refresh host discovery if required. Installation/update guidance is bundled in `.runtime/INSTALL.md` and `.runtime/UPDATE.md`.

## QA and evolution

Verify transport readiness, matching thread/turn IDs, observed tool completion, final reply and persisted transcript. Keep acceptance evidence outside the distributed Skill. Classify recurring failures at desktop transport, protocol adapter, package lifecycle or task acceptance; fix their owner through an authorized development task and rerun the affected gate. Clean-context regression is separately user-authorized.
