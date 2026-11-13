# Installation for the current Agent

For a published version, send your current Agent: “安装 @petercjl/codex-own-cli。” This candidate is local only; supply its reviewed tarball to the current Agent instead.

The installing Agent resolves its own supported Skill discovery directory and installs the requested package through npm into its stable tool environment. Inspect `capabilities --json` and `skill source --json`, then run `skill install --target-root <resolved Skill parent> --json`. The target is explicit; no other Agent directories are changed. The installer creates a physical copy of the entire Skill and required runtime. Unmanaged targets, links and local edits are preserved with explicit errors. Managed replacements retain a complete backup.

Verify the real CLI version, `skill status` current/managed hashes, the installed Skill's `.runtime/bin/codex-own-cli.mjs version`, and discovery through the current host. Load the installed Skill; refresh host discovery if needed. Host discovery is not claimed by the installer. This flow also applies to scripts-disabled npm installs. CLI-only installation or unresolved host discovery is incomplete. If the Skill phase fails, preserve the package and inspect the error before repeating the same selected-target install.
