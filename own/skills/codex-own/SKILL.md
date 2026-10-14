---
name: codex-own
description: Install, update, launch and diagnose the independent codex-own desktop application through its npm manager while preserving configuration and conversations.
---

# codex-own desktop lifecycle

Input: the requested install, update, diagnosis or recovery action, existing installation state, optional supplied API key file, and user authorization. Output: manager and desktop versions, verified installation paths, backup evidence and unresolved errors. Package installation alone does not configure model access.

Use the installed `codex-own` CLI. Resolve its current bundled instructions with `codex-own skill source --json`; probe `version`, `capabilities` and `doctor`. Requires Node.js 22+, tar, a supported desktop OS and access to registry.npmjs.org. Install the latest manager from npm; it downloads only the current platform’s desktop payloads from npm. Internal payload prereleases are data, not CLI entry points. macOS ARM64 and Windows x64 are implementation targets; a diagnostic result does not prove Windows GUI compatibility.

## Main line

1. Read `codex-own doctor --json` and `codex-own update check --json` as relevant. Report a missing dependency or unavailable platform explicitly.
2. For an authorized fresh installation, execute `codex-own install --yes`. An existing independent application requires `--adopt`; explain that the existing application and data are backed up. An unrelated application must be preserved.
3. For an authorized update, quit codex-own gracefully and run `codex-own update install --yes`. Do not terminate the original Codex. The manager and desktop versions are separate. Updating the npm manager alone does not update the desktop application.
4. Read `doctor` and `version`, retain the returned backup locations, then use `codex-own launch` when requested. Verify startup separately from installer success.

For installation-only acceptance, verify doctor, version, target and shortcut without configuring credentials or launching the GUI unless requested. Progress goes to stderr; final results remain JSON on stdout.

Desktop builds with the bundled npm updater check stable latest 15 seconds after startup and every six hours. The user-facing menu is 更新 → 检查 codex-own 更新…. Download runs while the app remains usable; 重启并安装 asks the user to end active tasks, then an independent helper waits for exit, backs up and replaces the app. The helper uses bundled Node and npm payloads, so daily in-app updates do not require updating global npm tooling. Inspect the installed app's own updater version separately from the global CLI version. Retain CLI step 3 for older builds and recovery. Prepared, verified downloads survive restarts; offline checks preserve the current installation. Install logs and unique result records live under the independent manager directory; never delete locks to bypass a failed update.

## Recovery and boundaries

- APP_RUNNING: request or perform authorized graceful exit, then return to step 3.
- CHECKSUM_MISMATCH, UNMANAGED_TARGET, UNSAFE_PATH, or incompatible patches: stop; preserve the current application.
- DOWNLOAD_FAILED: inspect npm registry connectivity and retry the same command; verified payload parts are reused. Ctrl+C during download cancels and releases the operation lock. Keep TLS verification enabled.
- BUSY or pending transactions: inspect the recorded transaction and process before recovery; do not blindly delete locks or replay an installation.
- Rollback requires `codex-own rollback --restore-data --yes`. Explain that this restores the matching old data snapshot; newer data is preserved separately. Obtain authorization covering this restoration, then verify state.
- Credentials and conversation data stay outside Git and npm. Never print API keys. Never modify original Codex directories or global model environment variables.
- Manage this bundled Skill through `skill status/install/update --agent codex|sealseek`. For another Agent use its configured `--target-root`, not a guessed path. Unknown existing Skill targets are refused, managed updates retain backups and customized UI metadata.

The portable contract uses a terminal that can invoke the same CLI on either Agent. Agent-specific scheduling and publication are repository operations, outside ordinary installation. Runtime must not rewrite its own source. A recurring failure belongs in an authorized implementation/test change.

Downloads use at most four parallel npm payload requests, label progress by part, preserve archive order, and cancel active peer downloads on failure.

Incremental releases use `canonical-tar-cdc-v1`: the manager reads only the installed program directory, rebuilds matching content blocks locally, and downloads missing blocks from npm. It works across skipped versions and verifies both each block and the final complete archive. The returned `transfer` reports `reusedBlocks`, `downloadBytes` and `fullDownloadBytes`; quote these measured values rather than promising a fixed update size. Fresh installations download all needed blocks. Large upstream binary changes may still require a large download. Keep cache and staging space available; no credential or conversation files are part of the scan.

When migrating a desktop older than 0.4.0, update the global npm manager to `@petercjl/codex-own@latest` and use CLI step 3 once to obtain local block reuse. Older in-app updaters lack this scanner and may download all resources or reject a larger block index. From 0.4.0 onward, the bundled updater provides the same incremental path without a global npm upgrade.
