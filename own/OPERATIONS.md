# codex-own operations

## Building current official desktop inputs

`own/build.mjs` synchronizes only the runner's target platform and preserves the official bundled CLI by default, keeping the desktop and protocol engine together. `OWN_CLI_SOURCE=rebuild` explicitly selects the Rebuild vendor resolver; an unavailable selected vendor stops the build. Source package versions, program-tree identities, original ASAR and CLI hashes are recorded in the candidate manifest. macOS inputs must pass their original code signature check; Windows MSIX downloads must match the Microsoft Store package digest.

The upstream adapter locates one resource-bearing macOS application independently of its bundle name, preserves ASAR links and unpacked native entries, and updates the executable that actually contains the Windows ASAR integrity resource. Windows MSIX ZIP extraction preserves URI-encoded scoped directory names such as `%40worklouder`; the adapter restores the equivalent ASAR `@worklouder` paths using the original signed files. Restored file hashes and paths are recorded in candidate provenance. Missing unpacked files, path collisions and unexpected binary architectures stop the build. Unpacked native hashes in an ASAR can predate official code signing; preserve signed bytes and validate the complete official package rather than imposing stale pre-sign hashes.

Native archived deletion is accepted only when the archived-thread controls and deletion method call are present in executable frontend structure. Older layouts require both legacy patches. Unknown layouts fail instead of treating zero replacements as success. Candidate QA runs a real offline Responses turn and thread start/resume/archive/delete against a temporary profile, then verifies the desktop workbench and reads native device-service state through the application's own Owl-hosted RPC. Windows native bindings link against Owl's chrome.dll and are verified in that runtime. No real credential or external model endpoint is involved. Physical hardware input remains a separate acceptance check.

`own-build.yml` can be dispatched against an isolated branch for verification and short-lived CI artifacts. It has read-only repository permissions and contains no publish or merge job. This path does not change npm tags, GitHub Releases, installed applications or the scheduled sync policy.

## Incremental desktop distribution (0.4.0+)

Builds preserve the complete signed application as the recovery `.tar.gz` artifact. In parallel, `canonicalize.mjs` writes a deterministic uncompressed `.tar` with sorted paths, normalized modes/timestamps and relative symlinks. `canonical-tar-cdc-v1` uses content-defined 16–64 MiB raw blocks (32 MiB rolling-hash mask). npm compresses each payload independently. Do not gzip the whole canonical archive before splitting: that would invalidate unchanged content after a small edit.

The OIDC publisher validates both platforms and their complete block indexes before uploading, reuses exact existing content-addressed payload versions and publishes missing identities with at most four concurrent npm operations. Manifest block order is preserved independently of completion order. Authentication errors stop new submissions and drain active work; restore Trusted Publishing before retrying. `latest` moves only after all payloads and fresh registry readback pass. The full compressed recovery artifact remains available to future CI overlay builds; end-user downloads stay on npm. The npm manifest exposes only the canonical archive checksum and npm payload parts.

Both CLI installs and desktop preparation scan the managed application read-only, generate identical canonical blocks, retain only blocks needed by the target manifest, then fetch missing verified parts. This requires no specific base release and supports skipped versions. Assembly verifies the final canonical archive before the existing platform extraction/signature checks and transactional switch. Transfer receipts report actual npm tarball byte estimates and reused block counts; raw archive bytes represent disk space, not network traffic.

Migration from 0.3.x uses the new global manager once; older bundled updaters do not perform local reuse. Subsequent desktop updates use the bundled implementation. Validate deterministic native extraction roundtrips, Unicode/modes/links, insertion resynchronization, corrupt-cache and cancellation behavior on both runners. Keep credentials/history outside every archive, index and scan.

Repository: https://github.com/petercjl/codex-own
Default product branch: own-main. Upstream: Haleclipse/CodexDesktop-Rebuild master.
Package: @petercjl/codex-own, root own/. Canonical workflows live in the repository root .github/workflows; own/.github/workflows links to the same canonical workflows for package-root tooling.

## Daily ownership

own-sync.yml runs at 04:10 UTC (12:10 Asia/Shanghai). GitHub scheduling may be delayed. The desktop maintenance conversation observes runs; it must not duplicate the scheduled workflow or publish a second version. A dispatched/in-progress run is followed to completion.

No upstream changes means no new publication. New upstream changes are merged in a candidate branch and represented by a PR. Conflicts or changes to own/ overlay, own workflow files or own resources stop the run. Tests/builds run before the PR is merged. The tested base/head must still match; a changed base stops the merge. Then own-release.yml re-verifies the artifacts and publishes through npm OIDC.

## Release

Use the installed npm-release-kit from the own/ package root, with --workflow own-release.yml. Stable releases use latest, prereleases use next. Never use local npm publish for a substantive release. The only initial local publication is the separately authorized minimal bootstrap placeholder.

Desktop assets are on versioned GitHub releases own-vX.Y.Z. npm versions and desktop artifact manifests must match. Draft assets are verified on macOS/Windows CI before activation. Releases from 0.1.1 distribute macOS ARM64 and Windows x64 desktop artifacts. Both platforms are required. Windows prepared artifacts also pass an installation/configuration smoke using the packed npm CLI in an isolated Windows user-data tree. The Windows GUI remains unverified unless a real application smoke is recorded.

If publication has an unknown outcome, inspect the npm exact version/tag, Git tag, Actions run and GitHub Release before retrying. A successful npm publication with still-draft desktop assets requires activating that same verified release, not bumping a new version. Monitor output includes version, tag, run URL and evidence.

## Local installation

### Local development builds and instance isolation

`node own/build.mjs --local-only --development --output <fresh-directory>` builds the Mac development identity and runs native checks without producing release archives. A previously signed, patched upstream app may be selected with `--prepared-app <path>`. Development output is `codex-own 开发版.app`, identifier `local.codex-own.development`, scheme `codex-own-dev`; its launcher keeps the native OS account HOME and selects data under `~/.codex-own-dev`. Stable launchers also resolve the OS account instead of inheriting another Agent's HOME. Existing profile roots and conversations remain in place. Development builds disable the npm updater and its cleanup controller; they cannot enter the release packaging pipeline.

For an overlay-only change, `--existing-app <signed-development-candidate> --refresh-overlay` copies the candidate to a fresh local output, backs up and refreshes the bundled updater and launcher, re-signs, and runs the same checks. It requires `--local-only --development`. The refresh updates only the owned ASAR runtime entry, preserves other packed/unpacked/link entries, regenerates ASAR/framework integrity, and backs up the previous runtime carriers. Install only after native and GUI checks pass, gracefully quit only the authorized development instance, and retain the old bundle outside application discovery before replacing the fixed development installation.

Each instance owns its `core`, `desktop`, `runtimes` and task `home` under its data root. Backend and task processes receive the private task HOME, XDG directories, npm/Python configuration, package caches and `CODEX_SKILLS_DIR=$CODEX_HOME/skills`. Initial task PATH contains the selected runtime plus platform system tools; foreign Agent bins, virtual environments and configuration overrides are discarded. Explicit project activation can select project tools afterward. The native desktop retains the OS HOME so macOS keychain and native services resolve the actual account; its instance identity independently selects the profile data root. Desktop maintenance retains the OS/profile HOME used to locate its installation. This is configuration and execution-environment isolation, not an OS filesystem sandbox against explicitly requested absolute paths.

Runtime startup verifies and regenerates its shell files from the current instance root, preserving changed originals as backups. Copied absolute shell paths cannot select a different instance. Test real login Bash/zsh plus the actual app-server spawn boundary; checking only desktop environment variables is insufficient. Do not automatically migrate or delete another instance's rules, Skills or conversations after discovering an earlier misdirected write.

The selected DeepSeek Responses bridge losslessly unwraps recognized single-field JSON envelopes around `apply_patch` input, including nested envelopes, in streamed events, completed responses and subsequent history. Other tools and outputs are untouched. Malformed or ambiguous input remains subject to the native patch handler. Run `node own/ci/test-patch-compat.mjs <app>` for real bundled-handler creation/update coverage with offline fixtures and no user credentials.

CLI entry: codex-own. Use help/capabilities/doctor before uncertain commands. Quit only codex-own before replacement. Existing installations require install --adopt --yes, which keeps app and data backups. Model credentials and conversation data stay outside Git/npm. The original Codex application and state are outside this manager's write scope.

The manager uses exclusive operation locks and transaction records. Interrupted operations require reading recorded paths and the current process state; never blindly remove locks or discard backups. Rollback restores a data snapshot only with explicit restoration authorization and preserves newer data separately.

## Verification boundaries

Unit tests are in own/test; actual isolated bundled CLI handshake is own/test-app.mjs. Passing package tests does not establish desktop GUI success. Upstream bundle identity or patch match changes fail closed. Do not bypass failed checks to satisfy the daily schedule.

Desktop verification also requires Simplified Chinese web/native resources and no remaining remote-controlled enable_i18n calls. The language preference continues to select the locale. A prepared Windows artifact may explicitly request repairWindowsI18n in its provenance; the original verified input and application resources are backed up before patching, PE/ASAR integrity is regenerated, and the repaired archive is installed and verified before publication. Merely reusing a previously tested archive does not bypass this gate.

## npm-only runtime distribution

Stable managers embed schema-2 desktop manifests and expose the same manifest in npm metadata as ownDesktopManifest. Runtime downloads are pinned to registry.npmjs.org; GitHub artifacts remain build/release inputs only. Desktop archives are split into at most 128 MiB chunks. Each content-addressed payload is a prerelease of the same npm package, 0.0.0-payload.h<SHA256>, published through the existing OIDC workflow under desktop-assets. They contain only package metadata and payload.bin, have no CLI, and never change latest. End users install @petercjl/codex-own@latest. Exact-version registry integrity and full reassembly are verified before publishing the stable manager. Existing identical payloads are reused; failed payload publication never triggers a version bump or unverified manager release. Runtime retries keep verified chunks, print progress on stderr, and preserve the JSON result on stdout.

The asset publisher submits missing payloads and then waits up to 30 minutes for npm publish-time scanning. Every exact version must have the expected integrity and tarball URL before assembly verification and manager publication. A timeout leaves latest unchanged; inspect exact registry versions and the existing run before retrying.

Runtime downloads use four bounded workers with shared cancellation and ordered assembly. This improves direct npm throughput without adding mirrors or changing the user’s network configuration.

## Desktop npm updater

The own overlay starts own/desktop/controller.cjs from both platform runtimes. Upstream official feeds remain disabled; our check source is exclusively @petercjl/codex-own/latest on registry.npmjs.org. Checks run 15 seconds after app readiness and every six hours. An independent Chinese update window and persistent menu entry expose check, download and restart/install. Only this window's main frame can call the privileged update IPC. Downloads require a click; replacement requires a separate restart confirmation. Offline checks never replace the current app.

own/lib/app-update.mjs owns stable version comparison, schema-2 manifest validation, locked preparation, verified restart receipts and expected-current-version guards. Downloading is allowed while the desktop runs. The install path retains the running-app guard. Before quitting, the controller copies the bundled updater including its standalone Node to a unique independent manager/handoffs directory. The detached helper uses file logs rather than parent-owned pipes, confirms readiness, waits up to two minutes for all own processes to exit, then calls the transactional manager. It never force-kills processes. Failed replacement attempts restart the retained installation; launch failure is recorded separately from install success. Handoff logs and unique update-result records are kept for recovery.

Desktop builds bundle only the updater code, runtime dependencies and standalone Node for their platform. On macOS a Homebrew-linked Node is refused; use an official standalone binary through OWN_UPDATER_NODE when building locally. GitHub setup-node supplies the platform runtime in CI. Global npm manager and desktop updater may have different versions after in-app updates, which is expected. Bundled Skills remain managed by the global CLI's skill commands; an App update does not silently edit Agent skill directories.

Prepared archive migration can explicitly set provenance.upgradeNpmUpdater=true. Verification then upgrades a fresh extracted copy, preserving original resources and regenerating ASAR/PE/framework integrity and macOS signatures. Existing and fresh artifacts must pass the bundled-runtime import gate in own/test-app.mjs. Unit tests cover checks, failed/tampered downloads, ready-state recovery, safe handoff, menu reconstruction and IPC sender validation; those gates do not by themselves establish native GUI success.

## Official desktop adaptation checks

API-mode policy routes authenticated API-key and authentication-free custom-provider sessions directly into the Codex workbench. Existing authentication, provider readiness and gateway checks still run. ChatGPT personalization onboarding remains available to subscription sessions; this overlay does not rewrite saved onboarding data.

The isolated GUI smoke requires workbench controls and a composer, and preserves screenshots and renderer errors. Its credentials are fixtures and its provider is loopback-only. macOS uses Chromium's test-only mock keychain to avoid real keychain access; this switch is confined to the test launcher. Real-keychain integration and live provider credentials require separate acceptance evidence. Test cleanup includes Owl child processes bound to the unique candidate/profile.

Experimental own-build and build workflow dispatches only create and verify CI artifacts. They do not publish npm, activate GitHub releases or merge own-main. Bind GUI verification to the successful native-build run and matching native-source fingerprint.

The Bailian Responses adapter pairs completed parallel tool history by call ID before transport. This preserves native parallel execution and persisted conversations while avoiding the provider's separate-assistant conversion error. Incomplete or ambiguous groups remain unchanged; the adapter never invents a result. `node own/ci/test-history-resume.mjs APP` exercises native parallel shell/patch calls, interruption, backend restart and resume with offline credentials. Live acceptance must separately verify the configured model accepts the complete resumed history; a new single-tool conversation does not cover that case.
