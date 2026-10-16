---
name: codex-own
description: Install, update, launch and diagnose the independent codex-own desktop application through its npm manager while preserving configuration and conversations.
---

# codex-own desktop lifecycle

Input: the requested install, update, diagnosis or recovery action, existing installation state, optional supplied API key file, and user authorization. Output: manager, desktop and tool-runtime versions/identities, verified installation paths, backup evidence and unresolved errors. Package installation alone does not configure model access.

Use the installed `codex-own` CLI. Resolve its current bundled instructions with `codex-own skill source --json`; probe `version`, `capabilities` and `doctor`. Requires Node.js 22+, tar, a supported desktop OS and access to registry.npmjs.org. Install the latest manager from npm; it downloads only the current platform’s desktop payloads from npm. Internal payload prereleases are data, not CLI entry points. macOS ARM64 and Windows x64 are implementation targets; a diagnostic result does not prove Windows GUI compatibility.

## Main line

1. Read `codex-own doctor --json` and `codex-own update check --json` as relevant. Report a missing dependency or unavailable platform explicitly.
2. For an authorized fresh installation, execute `codex-own install --yes`. An existing independent application requires `--adopt`; explain that the existing application and data are backed up. An unrelated application must be preserved.
3. For an authorized update, inspect the bound component differences from `update check`. A matching desktop remains open: `codex-own update install --yes` performs no desktop download or activation. Quit codex-own gracefully only when its desktop changes. Do not terminate the original Codex. Report npm manager, desktop artifact and tool-runtime versions separately; a newer manager can retain an older desktop.
4. Read `doctor` and `version`, retain the returned backup locations, then use `codex-own launch` when requested. Verify startup separately from installer success.

For installation-only acceptance, verify doctor, version, target and shortcut without configuring credentials or launching the GUI unless requested. Progress goes to stderr; final results remain JSON on stdout.

Desktop builds with the bundled npm updater check stable latest 15 seconds after startup and every six hours. The user-facing menu is 更新 → 检查 codex-own 更新…. Download runs while the app remains usable; 重启并安装 asks the user to end active tasks, then an independent helper waits for exit, backs up and replaces the app. The helper uses bundled Node and npm payloads, so daily in-app updates do not require updating global npm tooling. Inspect the installed app's own updater version separately from the global CLI version. Retain CLI step 3 for older builds and recovery. Prepared, verified downloads survive restarts; offline checks preserve the current installation. Install logs and unique result records live under the independent manager directory; never delete locks to bypass a failed update.

## Private tool runtime (contract 1)

Desktop installations from 0.5.0 include a separately versioned Node/npm/Python toolchain. The manager's release manifest pins verified npm payloads for macOS ARM64 and Windows x64. Install/update ensures these tools before switching the app. Runtime bytes retain upstream licenses and contain no user configuration. The initial npm manager bootstrap still requires existing Node.js 22+; ordinary app updates use the bundled updater.

When migrating through a 0.4.x in-app updater, the new desktop's async startup gate downloads and verifies its pinned tools from npm before loading the desktop backend. A progress window supports cancellation and retry; no system Node/npm/Python is required for this migration. Inspect unique `logs/runtime-bootstrap-*.log` files if preparation fails. An installed valid runtime allows offline startup without a registry check.

Use `codex-own runtime doctor` to discover the actual version and executable paths. Use `runtime env` for a sanitized JSON environment contract; it returns only tool settings, never inherited credentials. `runtime run -- node|npm|npx|python|python3|pip [args]` executes the selected private tool and propagates its exit status. Do not infer availability from system PATH, Windows App Execution Aliases or Start-menu Python groups. The app reapplies its private environment after importing the login shell.

On macOS, the runtime owns its task-only `ZDOTDIR` and `BASH_ENV` startup files. Login shells retain private tool precedence without editing the user's profiles. Verify paths through the backend's actual command execution, including login zsh/Bash, rather than checking only the parent process PATH. Project activation inside a task can explicitly select its own venv or toolchain.

For authorized installation or update, use `runtime install --yes` or `runtime update --yes`. Immutable versions are stored below the independent data root's `runtimes/versions`, with `active.json` recording the active version and predecessor. Updates keep the old version; already running processes keep their prior paths until restart. `runtime rollback --yes` verifies and reactivates the predecessor without restoring conversation data. BUSY and interrupted staging require inspecting the lock/process and receipts, not deleting state blindly. RUNTIME_VERSION_EXISTS preserves an unexpected existing target for diagnosis. Failed verification leaves the old active receipt unchanged.

Tools own their npm prefix/cache and pip cache; no user/system PATH, shell profile or original Codex runtime is modified. Project npm dependencies belong in project `node_modules`; Python dependencies belong in the project's `.venv`, created with the private Python. pip requires a virtual environment, so use its Python executable with `-m pip` after creating the venv. A project explicitly selecting another interpreter remains an explicit caller choice. Additional Git, compilers and office/media libraries are separate dependencies, not guaranteed by this toolchain. Never copy the original Codex cached runtime or account files to fill a missing dependency.

## Recovery and boundaries

For Windows Agent shell diagnosis, inspect `doctor.agentShell`: verified system Git Bash is preferred for general task commands, PowerShell remains available for Windows-specific operations, and missing/unusable Bash reports a fallback reason. `desktopAdapterBundled` distinguishes a capable desktop from an upgraded manager with an older desktop. The desktop adds this execution policy to new, resumed and forked Agent sessions while preserving existing developer instructions and the private Node/npm/Python environment. Integrated-terminal settings are independent; verify the actual tool call's explicit `shell` and command result. The Windows host context may still say PowerShell. An explicit user shell choice takes precedence. Never replay a failed command in a different shell without checking its side effects.

Component binding contract 2 requires a bridge desktop with embedded updater contract 2 and tool environment contract 1. Manager releases pin exact immutable artifacts, so their version numbers may differ. A manager-only release is not a desktop update; a tool-only update retains the desktop and uses new paths after restart. Legacy pre-bridge clients may need one CLI upgrade. INCOMPATIBLE_BINDING preserves the installed components; inspect the published binding and compatibility instead of forcing a version match.

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
