'use strict';
// Public environment contract v1. Only the caller's environment is changed.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
function runtimeRoot(platform=process.platform,home=os.homedir(),env=process.env){
 return path.join(platform==='darwin'?path.join(home,'Library','Application Support'):(env.LOCALAPPDATA||path.join(home,'AppData','Local')),'codex-own-independent','runtimes');
}
function inside(base,file){return path.resolve(file).startsWith(path.resolve(base)+path.sep);}
function pathEntries(r,platform=process.platform){const win=platform==='win32';return [r.shims,r.bin,win?path.join(r.directory,'python'):path.join(r.directory,'python','bin'),...(win?[path.join(r.directory,'python','Scripts')]:[]),path.join(r.root,'npm-global',...(win?[]:['bin']))];}
function active(base=runtimeRoot(),platform=process.platform,version){
 const file=path.join(base,'active.json');if(!version&&!fs.existsSync(file))return null;
 const r=version?{schema:1,version,platform:`${platform}-${process.arch}`} : JSON.parse(fs.readFileSync(file,'utf8'));
 if(r.schema!==1||!/^node[0-9.]+-python[0-9.]+-r\d+$/.test(r.version)||r.platform!==`${platform}-${process.arch}`)throw Error('Invalid codex-own runtime receipt');
 const dir=path.join(base,'versions',r.version),bin=platform==='win32'?path.join(dir,'node'):path.join(dir,'node','bin');
 const python=platform==='win32'?path.join(dir,'python','python.exe'):path.join(dir,'python','bin','python3');
 const node=path.join(bin,platform==='win32'?'node.exe':'node');
 const npm=path.join(dir,'node',platform==='win32'?'node_modules':'lib/node_modules','npm','bin','npm-cli.js');
 if(!inside(base,dir)||!inside(fs.realpathSync(base),fs.realpathSync(dir)))throw Error('Runtime path escapes private directory');
 for(const f of [node,python,npm]){if(!inside(dir,f)||!inside(fs.realpathSync(dir),fs.realpathSync(f)))throw Error('Runtime executable escapes immutable version directory');}
 return {...r,root:base,directory:dir,node,python,npm,bin,shims:path.join(dir,'shims')};
}
function environment(base=runtimeRoot(),inherited=process.env,platform=process.platform,version){
 const r=active(base,platform,version);if(!r)return null;
 const win=platform==='win32',separator=win?';':':',env={...inherited};
 const key=Object.keys(env).find(k=>k.toUpperCase()==='PATH')||'PATH';
 const tail=(env[key]||'').split(separator).filter(p=>p&&!p.includes('codex-runtimes')&&!p.startsWith(path.join(base,'versions')));
 for(const k of Object.keys(env))if(/^(PATH|NODE_PATH|NODE_OPTIONS|PYTHONHOME|PYTHONPATH|PYTHONUSERBASE|NPM_CONFIG_.+|PIP_CONFIG_FILE)$/i.test(k))delete env[k];
 const bins=pathEntries(r,platform);
 Object.assign(env,{PATH:[...bins,...tail].join(separator),CODEX_OWN_RUNTIME_ROOT:base,CODEX_OWN_RUNTIME_VERSION:r.version,CODEX_OWN_NODE:r.node,CODEX_OWN_PYTHON:r.python,AGENT_WORKBENCH_NPM_CLI:r.npm,
  NPM_CONFIG_PREFIX:path.join(base,'npm-global'),NPM_CONFIG_CACHE:path.join(base,'npm-cache'),NPM_CONFIG_USERCONFIG:path.join(base,'npmrc'),NPM_CONFIG_GLOBALCONFIG:path.join(base,'global-npmrc'),
  PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',PYTHONPYCACHEPREFIX:path.join(base,'python-bytecode',r.version),PYTHONNOUSERSITE:'1',PYTHONUSERBASE:path.join(base,'python-user'),PIP_CACHE_DIR:path.join(base,'pip-cache'),PIP_CONFIG_FILE:win?'NUL':'/dev/null',PIP_REQUIRE_VIRTUALENV:'true'});
 if(!win)Object.assign(env,{ZDOTDIR:path.join(r.directory,'shell'),BASH_ENV:path.join(r.directory,'shell','bash-env.sh')});
 return env;
}
function shellFiles(base,version){
 const r=active(base,process.platform,version),env=environment(base,{PATH:''},process.platform,version),quote=s=>"'"+s.replaceAll("'","'\"'\"'")+"'";
 const settings=Object.entries(env).filter(([k])=>k!=='PATH').map(([k,v])=>`export ${k}=${quote(v)}`).join('\n');
 const body='# codex-own private task shell; system and user profiles are unchanged.\n'+settings+'\nexport CODEX_HOME='+quote(path.join(base,'..','core'))+'\nexport PATH='+quote(pathEntries(r).join(':'))+':"$PATH"\nunset NODE_OPTIONS NODE_PATH PYTHONHOME PYTHONPATH OPENAI_API_KEY OPENAI_BASE_URL CHATGPT_TOKEN\nunalias node npm npx python python3 pip pip3 2>/dev/null || true\nfor own_tool in node npm npx python python3 pip pip3; do unset -f "$own_tool" 2>/dev/null || true; done\nunset own_tool\n';
 const include='. '+quote(path.join(r.directory,'shell','bash-env.sh'))+'\n';
 return {'bash-env.sh':body,'.zshenv':include,'.zprofile':include,'.zshrc':include,'.zlogin':include};
}
function apply(base=runtimeRoot(),env=process.env,platform=process.platform){
 const next=environment(base,env,platform);if(!next)return false;
 for(const k of Object.keys(env))if(!(k in next))delete env[k];Object.assign(env,next);return true;
}
module.exports={runtimeRoot,active,environment,apply,shellFiles};
