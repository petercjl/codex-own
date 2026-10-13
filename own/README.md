# codex-own

Independent desktop installer and updater. Node.js 22+ is required for the manager. The desktop app is downloaded as a platform artifact, not compiled on the user's machine. Existing configuration, API credentials and conversations remain in the independent application data directory.

Send your Agent: “Install @petercjl/codex-own and set up its desktop application.”

Update: “Use @petercjl/codex-own to update my desktop application, preserving configuration and conversations.”

Check: “Use codex-own to report the installed desktop version, available version and installation health.”

Existing installs require explicit adoption and a backup. Quit the desktop application before updating. Rollback restores a matching data snapshot and preserves newer data in a separate backup. Windows GUI operation remains unverified until a real Windows launch check is recorded.

Developer command reference is available through `codex-own help`. The npm manager version and desktop version are separate; installing a new manager alone does not replace the desktop application. Model credentials are never included in this package.

Windows x64: the manager installs into the current user’s LocalAppData/Programs/codex-own/current and creates a codex-own Start menu shortcut. Supply your separate API key file to your Agent: “Configure codex-own using the attached API key file.” Configuration stays in LocalAppData/codex-own-independent. Windows package installation and CLI service checks run in CI; desktop GUI acceptance is performed by the user.
