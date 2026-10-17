import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pkg,packageRoot,read,fail,paths,doctor,latest,state,install,launch,rollback,hash,rejectLinks,configure} from '../lib/manager.mjs';
import {manifestFor} from '../lib/manager.mjs';
import {installRuntime,runtimeDoctor,rollbackRuntime,runRuntime,toolEnv} from '../lib/tool-runtime.mjs';
import {components} from '../lib/binding.mjs';
import {planCleanup,runCleanup} from '../lib/cleanup.mjs';
import {repairPlan,repairRun} from './maintenance.mjs';
import {setProgressMode} from './network.mjs';
const args=process.argv.slice(2),[command,sub]=args;
const flag=n=>args.includes('--'+n),value=n=>{const i=args.indexOf('--'+n);return i<0?undefined:args[i+1];};
const yes=()=>{if(!flag('yes'))fail('CONFIRMATION_REQUIRED','Mutating commands require --yes');};
function toolSelectionGate(){const p=paths();if(!state(p))return;const file=path.join(p.target,process.platform==='darwin'?'Contents/Resources':'resources','own-updater','desktop-version.json'),meta=fs.existsSync(file)?read(file):null;if(meta?.updaterContract!==2||meta.runtimeContract!==1)fail('INCOMPATIBLE_BINDING','Upgrade the desktop to component contract 2 before independently changing its tools');}
async function skill(){const source=path.join(packageRoot,'skills','codex-own');if(sub==='source')return {ok:true,source,version:pkg.version};const agent=value('agent')||'codex';if(!['codex','sealseek'].includes(agent))fail('UNSUPPORTED_AGENT',agent);const base=value('target-root')||(agent==='codex'?path.join(os.homedir(),'.codex','skills'):null);if(!base)fail('TARGET_REQUIRED','Provide the configured Agent skill root with --target-root');const dest=path.join(base,'codex-own'),marker=path.join(dest,'.codex-own-managed.json');rejectLinks(base);rejectLinks(dest);const exists=fs.existsSync(dest);const owned=exists&&fs.existsSync(marker)&&read(marker).package===pkg.name;const srcHash=hash(fs.readFileSync(path.join(source,'SKILL.md')));if(sub==='status')return {ok:true,source,destination:dest,installed:exists,managed:owned,current:owned&&hash(fs.readFileSync(path.join(dest,'SKILL.md')))===srcHash};if(!['install','update'].includes(sub))fail('INVALID_COMMAND','skill source/status/install/update');yes();if(exists&&!owned)fail('UNMANAGED_TARGET','Existing skill is not managed');let backup=null;if(exists){backup=dest+'.backup-'+Date.now();fs.cpSync(dest,backup,{recursive:true,force:false,errorOnExist:true});}fs.mkdirSync(dest,{recursive:true});const ui=path.join(dest,'agents','openai.yaml'),customUI=fs.existsSync(ui)?fs.readFileSync(ui):null;fs.cpSync(source,dest,{recursive:true});if(customUI)fs.writeFileSync(ui,customUI);fs.writeFileSync(marker,JSON.stringify({package:pkg.name,version:pkg.version,hash:srcHash}));if(hash(fs.readFileSync(path.join(dest,'SKILL.md')))!==srcHash)fail('VERIFY_FAILED','Skill copy mismatch');return {ok:true,source,destination:dest,backup,version:pkg.version};}
async function main(){
 if(flag('progress')&&!value('progress'))fail('INVALID_ARGUMENT','Provide --progress stderr|stdout|quiet');
 if(flag('json')&&value('progress')==='stdout')fail('INVALID_ARGUMENT','JSON mode requires progress on stderr or quiet');
 setProgressMode(flag('quiet')?'quiet':value('progress')||'stderr');
 if(command==='repair'){if(sub==='plan')return repairPlan();if(sub==='run'){yes();return repairRun();}fail('INVALID_COMMAND','repair plan or repair run --yes');}
 if(!command||command==='help'||command==='--help')return {commands:['version','capabilities','doctor','repair plan','repair run --yes','install --yes [--adopt]','configure --api-key-file <file> --yes','update check','update install --yes','cleanup plan [--cache-limit-mib <0..16384>]','cleanup run --yes [--cache-limit-mib <0..16384>]','runtime install|update|doctor|env|run|rollback','launch','rollback --restore-data --yes','skill source|status|install|update'],note:'Node >=22; doctor.bootstrap reports the actual executable. Default stdout is JSON; --progress stdout is for human terminals; --quiet disables progress. Repair preserves application/user data and refuses active or incomplete transactions.'};
 if(command==='version'||command==='--version')return {manager:pkg.version,desktop:state()?.version||null,desktopIdentity:state()?.desktop?.identity||null,runtime:toolEnv.active()?.version||null};
 if(command==='capabilities')return read(path.join(packageRoot,'capabilities.json'));
 if(command==='doctor')return {...doctor(),runtime:runtimeDoctor()};
 if(command==='cleanup'){
  const limit=value('cache-limit-mib'),options={};if(flag('cache-limit-mib')&&limit===undefined)fail('INVALID_ARGUMENT','Provide --cache-limit-mib <0..16384>');if(limit!==undefined){if(!/^\d+$/.test(limit)||Number(limit)>16384)fail('INVALID_ARGUMENT','Cache limit must be an integer from 0 to 16384 MiB');options.cacheLimitBytes=Number(limit)*1048576;}
  if(sub==='plan')return planCleanup(options);
  if(sub==='run'){yes();return runCleanup(options);}
  fail('INVALID_COMMAND','cleanup plan or cleanup run --yes');
 }
 if(command==='runtime'){
  if(sub==='doctor')return runtimeDoctor();
  if(sub==='env'){const env=toolEnv.environment();if(!env)fail('RUNTIME_NOT_INSTALLED','Install private tools first');return {ok:true,contract:1,root:toolEnv.runtimeRoot(),environment:Object.fromEntries(Object.entries(env).filter(([k])=>['PATH','ZDOTDIR','BASH_ENV','CODEX_OWN_NODE','CODEX_OWN_PYTHON','CODEX_OWN_RUNTIME_VERSION','AGENT_WORKBENCH_NPM_CLI'].includes(k)||/^(NPM_CONFIG_|PYTHON|PIP_)/.test(k)))};}
  if(sub==='run'){const i=args.indexOf('--');process.exitCode=runRuntime(i<0?args.slice(2):args.slice(i+1));return;}
  if(sub==='install'||sub==='update'){yes();const m=await manifestFor(value('version')||await latest());if(toolEnv.active()?.version!==m.runtimes.version)toolSelectionGate();return installRuntime(m.runtimes,{selection:'user-update'});}
  if(sub==='rollback'){yes();if(toolEnv.active()?.previous)toolSelectionGate();return rollbackRuntime();}
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
try{const result=await main();if(result!==undefined){console.log(JSON.stringify(result,null,2));if(result.ok===false)process.exitCode=1;}}catch(e){console.error(JSON.stringify({ok:false,code:e.code||'OPERATION_FAILED',message:e.message,...Object.fromEntries(['missing','missingCount','stage','partialTarget','tarExit'].filter(k=>e[k]!==undefined).map(k=>[k,e[k]]))}));process.exitCode=1;}
