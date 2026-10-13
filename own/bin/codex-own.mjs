#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pkg,packageRoot,read,fail,paths,doctor,latest,state,install,launch,rollback,hash,rejectLinks,configure} from '../lib/manager.mjs';
const args=process.argv.slice(2),[command,sub]=args;
const flag=n=>args.includes('--'+n),value=n=>{const i=args.indexOf('--'+n);return i<0?undefined:args[i+1];};
const yes=()=>{if(!flag('yes'))fail('CONFIRMATION_REQUIRED','Mutating commands require --yes');};
async function skill(){const source=path.join(packageRoot,'skills','codex-own');if(sub==='source')return {ok:true,source,version:pkg.version};const agent=value('agent')||'codex';if(!['codex','sealseek'].includes(agent))fail('UNSUPPORTED_AGENT',agent);const base=value('target-root')||(agent==='codex'?path.join(os.homedir(),'.codex','skills'):null);if(!base)fail('TARGET_REQUIRED','Provide the configured Agent skill root with --target-root');const dest=path.join(base,'codex-own'),marker=path.join(dest,'.codex-own-managed.json');rejectLinks(base);rejectLinks(dest);const exists=fs.existsSync(dest);const owned=exists&&fs.existsSync(marker)&&read(marker).package===pkg.name;const srcHash=hash(fs.readFileSync(path.join(source,'SKILL.md')));if(sub==='status')return {ok:true,source,destination:dest,installed:exists,managed:owned,current:owned&&hash(fs.readFileSync(path.join(dest,'SKILL.md')))===srcHash};if(!['install','update'].includes(sub))fail('INVALID_COMMAND','skill source/status/install/update');yes();if(exists&&!owned)fail('UNMANAGED_TARGET','Existing skill is not managed');let backup=null;if(exists){backup=dest+'.backup-'+Date.now();fs.cpSync(dest,backup,{recursive:true,force:false,errorOnExist:true});}fs.mkdirSync(dest,{recursive:true});const ui=path.join(dest,'agents','openai.yaml'),customUI=fs.existsSync(ui)?fs.readFileSync(ui):null;fs.cpSync(source,dest,{recursive:true});if(customUI)fs.writeFileSync(ui,customUI);fs.writeFileSync(marker,JSON.stringify({package:pkg.name,version:pkg.version,hash:srcHash}));if(hash(fs.readFileSync(path.join(dest,'SKILL.md')))!==srcHash)fail('VERIFY_FAILED','Skill copy mismatch');return {ok:true,source,destination:dest,backup,version:pkg.version};}
async function main(){
 if(!command||command==='help'||command==='--help')return {commands:['version','capabilities','doctor','install --yes [--adopt]','configure --api-key-file <file> --yes','update check','update install --yes','launch','rollback --restore-data --yes','skill source|status|install|update'],note:'Application data remains outside npm. Quit the app before updates. Manager and desktop versions are reported separately.'};
 if(command==='version'||command==='--version')return {manager:pkg.version,desktop:state()?.version||null};
 if(command==='capabilities')return read(path.join(packageRoot,'capabilities.json'));
 if(command==='doctor')return doctor();
 if(command==='launch')return launch();
 if(command==='skill')return skill();
 if(command==='configure'){yes();return configure(value('api-key-file'));}
 if(command==='install'){yes();return install({adopt:flag('adopt'),version:value('version'),archive:value('archive'),manifest:value('manifest')?read(value('manifest')):undefined});}
 if(command==='update'){const v=await latest();if(sub==='check')return {ok:true,manager:pkg.version,desktop:state()?.version||null,available:v,updateAvailable:state()?.version!==v};if(sub==='install'){yes();return install({version:v});}}
 if(command==='rollback'){yes();return rollback({restoreData:flag('restore-data')});}
 fail('INVALID_COMMAND','See codex-own help');
}
try{const result=await main();console.log(JSON.stringify(result,null,2));if(result.ok===false)process.exitCode=1;}catch(e){console.error(JSON.stringify({ok:false,code:e.code||'OPERATION_FAILED',message:e.message}));process.exitCode=1;}
