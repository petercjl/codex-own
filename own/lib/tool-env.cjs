'use strict';
// Public environment contract v1. Only the caller's environment is changed.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
function runtimeRoot(platform=process.platform,home=os.homedir(),env=process.env){
 return path.join(platform==='darwin'?path.join(home,'Library','Application Support'):(env.LOCALAPPDATA||path.join(home,'AppData','Local')),'codex-own-independent','runtimes');
}
function inside(base,file){return path.resolve(file).startsWith(path.resolve(base)+path.sep);}
function ownedPath(root,file){
 if(path.resolve(file)!==path.resolve(root)&&!inside(root,file))throw Error('Instance path escapes its root');
 const parts=path.relative(root,file).split(path.sep).filter(Boolean);let current=root;
 for(const part of [null,...parts]){if(part!==null)current=path.join(current,part);try{if(fs.lstatSync(current).isSymbolicLink())throw Error('Instance path is a symbolic link: '+current);}catch(e){if(e.code!=='ENOENT')throw e;}}
}
function pathEntries(r,platform=process.platform){const win=platform==='win32';return [r.shims,r.bin,win?path.join(r.directory,'python'):path.join(r.directory,'python','bin'),...(win?[path.join(r.directory,'python','Scripts')]:[]),path.join(r.root,'npm-global',...(win?[]:['bin']))];}
function active(base=runtimeRoot(),platform=process.platform,version){
 ownedPath(path.dirname(base),path.join(base,'active.json'));
 const file=path.join(base,'active.json');if(!version&&!fs.existsSync(file))return null;
 const r=version?{schema:1,version,platform:`${platform}-${process.arch}`} : JSON.parse(fs.readFileSync(file,'utf8'));
 if(r.schema!==1||!/^node[0-9.]+-python[0-9.]+-r\d+$/.test(r.version)||r.platform!==`${platform}-${process.arch}`)throw Error('Invalid codex-own runtime receipt');
 const dir=path.join(base,'versions',r.version),bin=platform==='win32'?path.join(dir,'node'):path.join(dir,'node','bin');
 ownedPath(path.dirname(base),dir);
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
 // Trust platform tools, not an inherited Agent's bins or environment. A task
 // can still activate a project toolchain explicitly after this boundary.
 const allowed=win?[path.join(inherited.SystemRoot||'C:\\Windows','System32'),inherited.SystemRoot||'C:\\Windows',path.join(inherited.ProgramFiles||'C:\\Program Files','Git','cmd')]:['/usr/bin','/bin','/usr/sbin','/sbin','/usr/local/bin','/opt/homebrew/bin','/opt/homebrew/sbin'];
 const tail=[...new Set([...(env[key]||'').split(separator).filter(p=>allowed.includes(p)),...allowed])];
 for(const k of Object.keys(env))if(/^(PATH|NODE_PATH|NODE_OPTIONS|PYTHONHOME|PYTHONPATH|PYTHONUSERBASE|VIRTUAL_ENV|CONDA_.+|NPM_CONFIG_.+|PIP_.+|UV_.+|BUN_.+|CARGO_HOME|RUSTUP_HOME|GOPATH|GOMODCACHE|XDG_.+|CLAUDE_.+|ANTHROPIC_.+|SEALSEEK_.+|OPENCLAW_.+|GEMINI_.+|CURSOR_.+|CODEX_SKILLS_DIR)$/i.test(k))delete env[k];
 const root=path.dirname(base),home=path.join(root,'home');
 for(const name of ['home','core','core/config.toml','core/auth.json','core/skills','runtimes/npm-global','runtimes/npmrc','runtimes/global-npmrc'])ownedPath(root,path.join(root,name));
 const bins=pathEntries(r,platform);
 Object.assign(env,{PATH:[...bins,...tail].join(separator),CODEX_OWN_RUNTIME_ROOT:base,CODEX_OWN_RUNTIME_VERSION:r.version,CODEX_OWN_NODE:r.node,CODEX_OWN_PYTHON:r.python,AGENT_WORKBENCH_NPM_CLI:r.npm,
  HOME:home,USERPROFILE:home,CFFIXED_USER_HOME:home,CODEX_HOME:path.join(root,'core'),CODEX_SKILLS_DIR:path.join(root,'core','skills'),
  XDG_CONFIG_HOME:path.join(home,'.config'),XDG_CACHE_HOME:path.join(home,'.cache'),XDG_DATA_HOME:path.join(home,'.local','share'),XDG_STATE_HOME:path.join(home,'.local','state'),
  UV_CACHE_DIR:path.join(base,'uv-cache'),BUN_INSTALL:path.join(base,'bun'),CARGO_HOME:path.join(base,'cargo'),RUSTUP_HOME:path.join(base,'rustup'),GOPATH:path.join(base,'go'),
  NPM_CONFIG_PREFIX:path.join(base,'npm-global'),NPM_CONFIG_CACHE:path.join(base,'npm-cache'),NPM_CONFIG_USERCONFIG:path.join(base,'npmrc'),NPM_CONFIG_GLOBALCONFIG:path.join(base,'global-npmrc'),
  PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',PYTHONPYCACHEPREFIX:path.join(base,'python-bytecode',r.version),PYTHONNOUSERSITE:'1',PYTHONUSERBASE:path.join(base,'python-user'),PIP_CACHE_DIR:path.join(base,'pip-cache'),PIP_CONFIG_FILE:win?'NUL':'/dev/null',PIP_REQUIRE_VIRTUALENV:'true'});
 if(win)Object.assign(env,{APPDATA:path.join(home,'AppData','Roaming'),LOCALAPPDATA:path.join(home,'AppData','Local')});
 else Object.assign(env,{ZDOTDIR:path.join(r.directory,'shell'),BASH_ENV:path.join(r.directory,'shell','bash-env.sh')});
 return env;
}
function shellFiles(base,version){
 const r=active(base,process.platform,version),env=environment(base,{PATH:''},process.platform,version),quote=s=>"'"+s.replaceAll("'","'\"'\"'")+"'";
 const settings=Object.entries(env).filter(([k])=>k!=='PATH').map(([k,v])=>`export ${k}=${quote(v)}`).join('\n');
 const body='# codex-own private task shell; system and user profiles are unchanged.\n'+settings+'\nexport PATH='+quote(env.PATH)+'\nunset NODE_OPTIONS NODE_PATH PYTHONHOME PYTHONPATH VIRTUAL_ENV CLAUDE_CONFIG_DIR SEALSEEK_HOME OPENCLAW_HOME GEMINI_CLI_HOME OPENAI_API_KEY OPENAI_BASE_URL CHATGPT_TOKEN\nunalias node npm npx python python3 pip pip3 2>/dev/null || true\nfor own_tool in node npm npx python python3 pip pip3; do unset -f "$own_tool" 2>/dev/null || true; done\nunset own_tool\n';
 const include='. '+quote(path.join(r.directory,'shell','bash-env.sh'))+'\n';
 return {'bash-env.sh':body,'.zshenv':include,'.zprofile':include,'.zshrc':include,'.zlogin':include};
}
function ensureShellFiles(base,version){
 const r=active(base,process.platform,version);if(!r||process.platform==='win32')return;
 const dir=path.join(r.directory,'shell');
 if(fs.existsSync(dir)&&fs.lstatSync(dir).isSymbolicLink())throw Error('Runtime shell directory is a symbolic link');
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 for(const [name,body]of Object.entries(shellFiles(base,version))){
  const file=path.join(dir,name);let old=null;
  try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Unsafe runtime shell file');old=fs.readFileSync(file,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
  if(old===body)continue;
  if(old!==null)fs.copyFileSync(file,file+'.backup-'+crypto.randomUUID(),fs.constants.COPYFILE_EXCL);
  const next=file+'.new-'+crypto.randomUUID();fs.writeFileSync(next,body,{flag:'wx',mode:0o600});fs.renameSync(next,file);
 }
}
function apply(base=runtimeRoot(),env=process.env,platform=process.platform,{host=false}={}){
 const next=environment(base,env,platform);if(!next)return false;
 ensureShellFiles(base);
 for(const dir of [next.HOME,next.XDG_CONFIG_HOME,next.XDG_CACHE_HOME,next.XDG_DATA_HOME,next.XDG_STATE_HOME,next.CODEX_SKILLS_DIR]){ownedPath(path.dirname(base),dir);fs.mkdirSync(dir,{recursive:true,mode:0o700});}
 // Desktop maintenance still resolves its existing installation through the
 // OS user home. Only backend/task processes receive the private task home.
 if(host)for(const k of ['HOME','USERPROFILE','CFFIXED_USER_HOME','APPDATA','LOCALAPPDATA']){if(env[k]===undefined)delete next[k];else next[k]=env[k];}
 for(const k of Object.keys(env))if(!(k in next))delete env[k];Object.assign(env,next);return true;
}
module.exports={runtimeRoot,active,environment,apply,shellFiles,ensureShellFiles};
