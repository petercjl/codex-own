# codex-own operations

Repository: https://github.com/petercjl/codex-own
Default product branch: own-main. Upstream: Haleclipse/CodexDesktop-Rebuild master.
Package: @petercjl/codex-own, root own/. Canonical workflows live in the repository root .github/workflows; own/.github/workflows contains the npm-release-kit initialization reference.

## Daily ownership

own-sync.yml runs at 04:10 UTC (12:10 Asia/Shanghai). GitHub scheduling may be delayed. The desktop maintenance conversation observes runs; it must not duplicate the scheduled workflow or publish a second version. A dispatched/in-progress run is followed to completion.

No upstream changes means no new publication. New upstream changes are merged in a candidate branch and represented by a PR. Conflicts or changes to own/ overlay, own workflow files or own resources stop the run. Tests/builds run before the PR is merged. The tested base/head must still match; a changed base stops the merge. Then own-release.yml re-verifies the artifacts and publishes through npm OIDC.

## Release

Use the installed npm-release-kit from the own/ package root, with --workflow own-release.yml. Stable releases use latest, prereleases use next. Never use local npm publish for a substantive release. The only initial local publication is the separately authorized minimal bootstrap placeholder.

Desktop assets are on versioned GitHub releases own-vX.Y.Z. npm versions and desktop artifact manifests must match. Draft assets are verified on macOS/Windows CI before activation. First 0.1.0 migration release contains the previously validated macOS ARM64 app; Windows unit checks run but no Windows application is distributed for this initial version. Subsequent automatic candidates require both platforms. The Windows GUI remains unverified unless a real application smoke is recorded.

If publication has an unknown outcome, inspect the npm exact version/tag, Git tag, Actions run and GitHub Release before retrying. A successful npm publication with still-draft desktop assets requires activating that same verified release, not bumping a new version. Monitor output includes version, tag, run URL and evidence.

## Local installation

CLI entry: codex-own. Use help/capabilities/doctor before uncertain commands. Quit only codex-own before replacement. Existing installations require install --adopt --yes, which keeps app and data backups. Model credentials and conversation data stay outside Git/npm. The original Codex application and state are outside this manager's write scope.

The manager uses exclusive operation locks and transaction records. Interrupted operations require reading recorded paths and the current process state; never blindly remove locks or discard backups. Rollback restores a data snapshot only with explicit restoration authorization and preserves newer data separately.

## Verification boundaries

Unit tests are in own/test; actual isolated bundled CLI handshake is own/test-app.mjs. Passing package tests does not establish desktop GUI success. Upstream bundle identity or patch match changes fail closed. Do not bypass failed checks to satisfy the daily schedule.
