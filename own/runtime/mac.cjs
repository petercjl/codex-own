'use strict';
// Runs before upstream startup and again after its login-shell import.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.join(os.homedir(), 'Library', 'Application Support', 'codex-own-independent');
const resources = process.resourcesPath;
const paths = {root, core: path.join(root, 'core'), desktop: path.join(root, 'desktop'), tmp: path.join(root, 'tmp')};
const cli = path.join(resources, 'codex-own-cli');
function apply() {
  for (const key of Object.keys(process.env)) {
    if (/^(CODEX_|ELECTRON_|NODE_REPL_|OPENAI_|CHATGPT_)/.test(key)) delete process.env[key];
  }
  Object.assign(process.env, {
    CODEX_HOME: paths.core,
    CODEX_ELECTRON_USER_DATA_PATH: paths.desktop,
    CODEX_CLI_PATH: cli,
    CODEX_APP_SERVER_FORCE_CLI: '1',
    CODEX_APP_SERVER_USE_LOCAL_DAEMON: '0',
    CODEX_ELECTRON_RESOURCES_PATH: resources,
    CODEX_ELECTRON_BUNDLED_PLUGINS_RESOURCES_PATH: resources,
    CODEX_TPP_LOCAL_EXECUTOR_ENABLED: '0',
    TMPDIR: paths.tmp,
    CODEX_OWN_LEGACY_RUNTIME_ROOT: path.join(root,'runtimes','upstream-disabled'),
  });
  require(path.join(resources,'own-updater','lib','tool-env.cjs')).apply(path.join(root,'runtimes'));
  require(path.join(resources,'own-updater','lib','api-input-compat.cjs')).install({cli,core:paths.core});
  return paths;
}
for (const value of Object.values(paths)) fs.mkdirSync(value, {recursive: true, mode: 0o700});
if (!fs.existsSync(cli)) throw new Error('codex-own bundled CLI is missing');
const config = path.join(paths.core, 'config.toml');
if (!fs.existsSync(config)) fs.writeFileSync(config,
  '# codex-own private configuration\ncli_auth_credentials_store = "file"\nforced_login_method = "api"\n', {flag:'wx',mode:0o600});
apply();
const {app, nativeImage} = require('electron');
app.setName('codex-own');
app.setPath('userData', paths.desktop);
app.setPath('logs', path.join(root, 'logs'));
// The upstream native default-name hook runs later; pin the public identity.
app.setName = () => {};
app.setAsDefaultProtocolClient = () => false;
app.removeAsDefaultProtocolClient = () => false;
require(path.join(resources,'own-updater','desktop','controller.cjs')).start(require('electron'),root);
require(path.join(resources,'own-updater','desktop','product-mode.cjs')).install(require('electron'),paths.core);
require(path.join(resources,'own-updater','desktop','thread-titles.cjs')).install(require('electron'),paths.core);
app.whenReady().then(() => {
  const icon = nativeImage.createFromPath(path.join(resources, 'codex-own.png'));
  if (app.dock && !icon.isEmpty()) {
    const setIcon = app.dock.setIcon.bind(app.dock);
    setIcon(icon);
    app.dock.setIcon = () => setIcon(icon);
  }
});
module.exports = {apply, paths,ensureTools:()=>require(path.join(resources,'own-updater','desktop','tool-bootstrap.cjs')).ensureTools(require('electron'),root,apply)};
