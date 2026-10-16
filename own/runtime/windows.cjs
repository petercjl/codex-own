'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {app}=require('electron');
if(process.platform!=='win32')throw Error('Windows build only');
const root=path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'codex-own-independent');
const paths={root,core:path.join(root,'core'),desktop:path.join(root,'desktop'),tmp:path.join(root,'tmp'),logs:path.join(root,'logs')};
const manifest=JSON.parse(fs.readFileSync(path.join(process.resourcesPath,'codex-own-runtime.json'),'utf8'));
const cli=path.resolve(process.resourcesPath,manifest.cli);
if(!cli.startsWith(process.resourcesPath+path.sep)||!fs.existsSync(cli))throw Error('Bundled CLI missing');
for(const p of Object.values(paths))fs.mkdirSync(p,{recursive:true});
function apply(){
 for(const k of Object.keys(process.env))if(/^(CODEX_|ELECTRON_|NODE_REPL_|OPENAI_|CHATGPT_)/.test(k))delete process.env[k];
 Object.assign(process.env,{CODEX_HOME:paths.core,CODEX_CLI_PATH:cli,CODEX_ELECTRON_USER_DATA_PATH:paths.desktop,CODEX_APP_SERVER_FORCE_CLI:'1',CODEX_APP_SERVER_USE_LOCAL_DAEMON:'0',CODEX_ELECTRON_RESOURCES_PATH:process.resourcesPath,CODEX_ELECTRON_BUNDLED_PLUGINS_RESOURCES_PATH:process.resourcesPath,CODEX_TPP_LOCAL_EXECUTOR_ENABLED:'0',TEMP:paths.tmp,TMP:paths.tmp});
 process.env.CODEX_OWN_LEGACY_RUNTIME_ROOT=path.join(root,'runtimes','upstream-disabled');
 require(path.join(process.resourcesPath,'own-updater','lib','tool-env.cjs')).apply(path.join(root,'runtimes'));
 return paths;
}
apply();app.setName('codex-own');app.setPath('userData',paths.desktop);app.setPath('logs',paths.logs);
app.setAppUserModelId('local.codex-own');
app.setName=()=>{};app.setAppUserModelId=()=>{};
app.setAsDefaultProtocolClient=()=>false;app.removeAsDefaultProtocolClient=()=>false;
require(path.join(process.resourcesPath,'own-updater','desktop','controller.cjs')).start(require('electron'),root);
module.exports={apply,paths,ensureTools:()=>require(path.join(process.resourcesPath,'own-updater','desktop','tool-bootstrap.cjs')).ensureTools(require('electron'),root,apply)};
