# Updating the current Agent's installation

Send your current Agent: “更新 @petercjl/codex-own-cli。”

Before replacement, resolve the current Agent's Skill parent and inspect `skill status --target-root <parent> --json`. Preserve edits or unmanaged paths for user resolution. Use `update check`, then authorized `update install --target-root <parent> --yes`. The selected Skill owns a complete physical runtime; updates copy the verified candidate into that target, retain the previous complete target as backup, and activate on the next invocation. Same-version requests reconcile missing/stale managed state. No other Agent is synchronized. Verify version and managed hashes through the returned target-owned entry and refresh host discovery.

Doctor performs a bounded advisory registry check. Offline checks and failed updates retain the existing installation. A local candidate with no registry release reports not-published. An uncertain model/tool send is recovered using its operation ID and chat status, independently from package updates. This is a first local release; there are no historical published updaters to migrate.
