# Component release lifecycle — contract 2

Users install and update `@petercjl/codex-own`. The npm manager, desktop and Node/npm/Python distributions have separate immutable identities. Each manager release pins exact components; an unchanged desktop and tools retain their version, checksums and original build source.

`release.json.version` identifies the desktop artifact. `binding.managerVersion` identifies the npm package. `binding.desktop` records the platform-set identity, declared and observed build-input fingerprints, original source commit/run and updater contract. `binding.runtimes` records the tool group and per-platform Node/npm and Python identities. npm is bundled with its pinned Node archive. Revalidating identical tool bytes under a new recipe adds validation evidence while preserving their original source.

The supported boundary is manager contract 2, embedded updater contract 2 and tool environment contract 1. The existing 0.5.1 release is imported as a legacy baseline: its exact registry manifest and successful platform jobs are verified, but it cannot authorize ordinary fast reuse. A fully verified bridge desktop is needed first. Pre-bridge clients can upgrade through the current npm CLI; their old embedded updater cannot interpret a later independently bound manager.

## Release plan

`own/ci/release-plan.mjs` emits manager version, changed input classes, native/runtime fingerprints, published provenance, selected QA and build/reuse actions. `lifecycle-policy.json` classifies every tracked input. Unknown files, changed embedded code, dependencies/lockfiles, icons, targets/toolchains or release recipes refuse a forced manager-only path. Generated bindings and npm release-number changes do not change binary input fingerprints.

The native fingerprint combines declared inputs with observed downloaded program-tree hashes, resolved CLI checksum and actual updater Node/toolchain metadata. Input inventories live in `own/artifacts/current.json`; authoritative component fingerprints are published in immutable npm metadata. Ordinary reuse uses exact published manifests and durable npm payloads, never expiring Actions artifacts or caches.

Manager-only QA runs on macOS ARM64 and Windows x64. It checks package contents, packed installation, Skill update/backup and lifecycle regressions, then downloads only archive blocks containing the pinned native CLI and invokes it. Desktop unpacking, overlaying, signing, canonicalization, tool remaking and unchanged payload publication are skipped.

Changed native components are built/overlaid and validated once per platform, published as immutable npm blocks plus durable native release records, then bound to the manager. Tool distributions have separate preparation and platform QA. The publisher consumes verified candidates; it does not rebuild them.

`verify_only` runs the selected gates without publishing or changing installed applications. `verified_run` is publication recovery: completed platform jobs, matching source/input proofs and unexpired candidates are required. It is separate from ordinary manager-only reuse. The daily merge workflow hands its already validated candidates to this recovery path; actual build and workflow-trigger commits are recorded separately.

## Receiver and recovery

`version`, `doctor` and `update check` distinguish manager, desktop and runtime. Update availability uses bound component identities. A matching installed desktop transfers zero desktop bytes and performs zero desktop activation while it stays open. A runtime-only prepared receipt has no desktop archive. Legacy version-only state gains an artifact identity without rewriting a matching program.

Bindings remain in the independent manager directory. Core/auth/session isolation, data snapshots and application backups remain in place. Explicit runtime rollback keeps a verified immutable predecessor and the user's selection for the current desktop; a later explicit update may select the published pin again. Desktop rollback restores its recorded binding and tools. Conflicting immutable identities and corrupt assets fail before activation.

## Measured baseline

Run [38843240913](https://github.com/petercjl/codex-own/actions/runs/38843240913) took **24m35s**. Windows platform QA took 10m45s; macOS took 8m03s. Windows prepared-artifact verification took 4m30s, canonical/incremental checks 2m44s and candidate upload 1m49s. The publishing job took 13m36s: candidate download 58s, manifest/payload preparation and verification 8m42s, manager publication 23s and registry visibility 3m15s.

These are transfer, reconstruction, verification and registry-processing costs as well as build work. The audit job records actual phase durations; no fixed future duration is promised. npm-only delivery and content-defined incremental transport remain unchanged. CDN or object-storage migration is a separate decision.
