# codex-own operations

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

CLI entry: codex-own. Use help/capabilities/doctor before uncertain commands. Quit only codex-own before replacement. Existing installations require install --adopt --yes, which keeps app and data backups. Model credentials and conversation data stay outside Git/npm. The original Codex application and state are outside this manager's write scope.

The manager uses exclusive operation locks and transaction records. Interrupted operations require reading recorded paths and the current process state; never blindly remove locks or discard backups. Rollback restores a data snapshot only with explicit restoration authorization and preserves newer data separately.

## Verification boundaries

Unit tests are in own/test; actual isolated bundled CLI handshake is own/test-app.mjs. Passing package tests does not establish desktop GUI success. Upstream bundle identity or patch match changes fail closed. Do not bypass failed checks to satisfy the daily schedule.

Desktop verification also requires Simplified Chinese web/native resources and no remaining remote-controlled enable_i18n calls. The language preference continues to select the locale. A prepared Windows artifact may explicitly request repairWindowsI18n in its provenance; the original verified input and application resources are backed up before patching, PE/ASAR integrity is regenerated, and the repaired archive is installed and verified before publication. Merely reusing a previously tested archive does not bypass this gate.

## npm-only runtime distribution

Stable managers embed schema-2 desktop manifests and expose the same manifest in npm metadata as ownDesktopManifest. Runtime downloads are pinned to registry.npmjs.org; GitHub artifacts remain build/release inputs only. Desktop archives are split into at most 128 MiB chunks. Each content-addressed payload is a prerelease of the same npm package, 0.0.0-payload.h<SHA256>, published through the existing OIDC workflow under desktop-assets. They contain only package metadata and payload.bin, have no CLI, and never change latest. End users install @petercjl/codex-own@latest. Exact-version registry integrity and full reassembly are verified before publishing the stable manager. Existing identical payloads are reused; failed payload publication never triggers a version bump or unverified manager release. Runtime retries keep verified chunks, print progress on stderr, and preserve the JSON result on stdout.

The asset publisher submits missing payloads and then waits up to 30 minutes for npm publish-time scanning. Every exact version must have the expected integrity and tarball URL before assembly verification and manager publication. A timeout leaves latest unchanged; inspect exact registry versions and the existing run before retrying.

Runtime downloads use four bounded workers with shared cancellation and ordered assembly. This improves direct npm throughput without adding mirrors or changing the user’s network configuration.
