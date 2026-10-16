#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pkg,packageRoot,read,fail,paths,doctor,latest,state,install,launch,rollback,hash,rejectLinks,configure} from '../lib/manager.mjs';
import {manifestFor} from '../lib/manager.mjs';
import {installRuntime,runtimeDoctor,rollbackRuntime,runRuntime,toolEnv} from '../lib/tool-runtime.mjs';
import {components} from '../lib/binding.mjs';
const args=process.argv.slice(2),[command,sub]=args;
const flag=n=>args.includes('--'+n),value=n=>{const i=args.indexOf('--'+n);return i<0?undefined:args[i+1];};
const yes=()=>{if(!flag('yes'))fail('CONFIRMATION_REQUIRED','Mutating commands require --yes');};
async function skill(){const source=path.join(packageRoot,'skills','codex-own');if(sub==='source')return {ok:true,source,version:pkg.version};const agent=value('agent')||'codex';if(!['codex','sealseek'].includes(agent))fail('UNSUPPORTED_AGENT',agent);const base=value('target-root')||(agent==='codex'?path.join(os.homedir(),'.codex','skills'):null);if(!base)fail('TARGET_REQUIRED','Provide the configured Agent skill root with --target-root');const dest=path.join(base,'codex-own'),marker=path.join(dest,'.codex-own-managed.json');rejectLinks(base);rejectLinks(dest);const exists=fs.existsSync(dest);const owned=exists&&fs.existsSync(marker)&&read(marker).package===pkg.name;const srcHash=hash(fs.readFileSync(path.join(source,'SKILL.md')));if(sub==='status')return {ok:true,source,destination:dest,installed:exists,managed:owned,current:owned&&hash(fs.readFileSync(path.join(dest,'SKILL.md')))===srcHash};if(!['install','update'].includes(sub))fail('INVALID_COMMAND','skill source/status/install/update');yes();if(exists&&!owned)fail('UNMANAGED_TARGET','Existing skill is not managed');let backup=null;if(exists){backup=dest+'.backup-'+Date.now();fs.cpSync(dest,backup,{recursive:true,force:false,errorOnExist:true});}fs.mkdirSync(dest,{recursive:true});const ui=path.join(dest,'agents','openai.yaml'),customUI=fs.existsSync(ui)?fs.readFileSync(ui):null;fs.cpSync(source,dest,{recursive:true});if(customUI)fs.writeFileSync(ui,customUI);fs.writeFileSync(marker,JSON.stringify({package:pkg.name,version:pkg.version,hash:srcHash}));if(hash(fs.readFileSync(path.join(dest,'SKILL.md')))!==srcHash)fail('VERIFY_FAILED','Skill copy mismatch');return {ok:true,source,destination:dest,backup,version:pkg.version};}
async function main(){
 if(!command||command==='help'||command==='--help')return {commands:['version','capabilities','doctor','install --yes [--adopt]','configure --api-key-file <file> --yes','update check','update install --yes','runtime install|update|doctor|env|run|rollback','launch','rollback --restore-data --yes','skill source|status|install|update'],note:'Application data and private tools remain outside npm manager packages. Quit the app before desktop updates. Manager, desktop and tool runtime versions are reported separately.'};
 if(command==='version'||command==='--version')return {manager:pkg.version,desktop:state()?.version||null,desktopIdentity:state()?.desktop?.identity||null,runtime:toolEnv.active()?.version||null};
 if(command==='capabilities')return read(path.join(packageRoot,'capabilities.json'));
 if(command==='doctor')return {...doctor(),runtime:runtimeDoctor()};
 if(command==='runtime'){
  if(sub==='doctor')return runtimeDoctor();
  if(sub==='env'){const env=toolEnv.environment();if(!env)fail('RUNTIME_NOT_INSTALLED','Install private tools first');return {ok:true,contract:1,root:toolEnv.runtimeRoot(),environment:Object.fromEntries(Object.entries(env).filter(([k])=>['PATH','ZDOTDIR','BASH_ENV','CODEX_OWN_NODE','CODEX_OWN_PYTHON','CODEX_OWN_RUNTIME_VERSION','AGENT_WORKBENCH_NPM_CLI'].includes(k)||/^(NPM_CONFIG_|PYTHON|PIP_)/.test(k)))};}
  if(sub==='run'){const i=args.indexOf('--');process.exitCode=runRuntime(i<0?args.slice(2):args.slice(i+1));return;}
  if(sub==='install'||sub==='update'){yes();const m=await manifestFor(value('version')||await latest());return installRuntime(m.runtimes,{selection:'user-update'});}
  if(sub==='rollback'){yes();return rollbackRuntime();}
  return {commands:['runtime install --yes','runtime update --yes','runtime doctor','runtime env','runtime run -- <node|npm|npx|python|python3|pip> [args]','runtime rollback --yes']};
 }
 if(command==='launch')return launch();
 if(command==='skill')return skill();
 if(command==='configure'){yes();return configure(value('api-key-file'));}
 if(command==='install'){yes();return install({adopt:flag('adopt'),version:value('version'),archive:value('archive'),manifest:value('manifest')?read(value('manifest')):undefined});}
 if(command==='update'){const v=await latest();if(sub==='check'){const m=await manifestFor(v),c=components(state(),m,paths().platform,toolEnv.active()?.version);return {ok:true,manager:pkg.version,desktop:state()?.version||null,available:v,...c,managerUpdate:pkg.version!==v,updateAvailable:c.desktopUpdate||c.runtimeUpdate};}if(sub==='install'){yes();return install({version:v});}}
 if(command==='rollback'){yes();return rollback({restoreData:flag('restore-data')});}
 fail('INVALID_COMMAND','See codex-own help');
}
try{const result=await main();if(result!==undefined){console.log(JSON.stringify(result,null,2));if(result.ok===false)process.exitCode=1;}}catch(e){console.error(JSON.stringify({ok:false,code:e.code||'OPERATION_FAILED',message:e.message}));process.exitCode=1;}
