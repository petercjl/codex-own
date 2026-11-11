import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const publicationFiles=new Set(['.github/workflows/own-installers.yml','own/installers/publish.mjs','own/installers/recovery.mjs','own/test/first-installers.test.mjs']);
export function validateInstallerRecovery({id,run,jobs,artifacts,changed}){
 if(!/^\d+$/.test(String(id))||String(run.id)!==String(id)||run.path!=='.github/workflows/own-installers.yml'||run.head_branch!=='own-main'||!['workflow_run','workflow_dispatch'].includes(run.event)||run.status!=='completed'||!/^[a-f0-9]{40}$/.test(run.head_sha||''))throw Error('Untrusted installer QA source');
 if(changed.some(f=>!publicationFiles.has(f)))throw Error('Installer build or application inputs changed; repeat native QA');
 const builds=jobs.filter(j=>j.name==='build (windows-latest, win32-x64)');
 if(builds.length!==1||builds[0].conclusion!=='success'||builds[0].status!=='completed'||!builds[0].steps?.some(s=>s.name==='Verify offline first install repeat install and npm update adoption'&&s.conclusion==='success'))throw Error('Successful native installer QA required');
 const matches=artifacts.filter(a=>a.name==='first-installer-win32-x64');
 if(matches.length!==1||matches[0].expired||!(matches[0].size_in_bytes>0))throw Error('Verified installer artifact missing or expired');
 return {sourceRun:String(id),sourceRef:run.head_sha,reuse:true};
}
export function resolveInstallerRecovery(id){
 if(!/^\d+$/.test(String(id)))throw Error('Numeric source run required');
 const api=suffix=>JSON.parse(execFileSync('gh',['api',`repos/petercjl/codex-own/actions/runs/${id}${suffix}`],{encoding:'utf8',maxBuffer:8*1024*1024}));
 const run=api('');
 if(!/^[a-f0-9]{40}$/.test(run.head_sha||''))throw Error('Invalid QA source ref');
 const changed=execFileSync('git',['diff','--name-only',run.head_sha,'HEAD'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
 return validateInstallerRecovery({id,run,jobs:api('/jobs?per_page=100').jobs,artifacts:api('/artifacts?per_page=100').artifacts,changed});
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const result=process.env.VERIFIED_RUN?resolveInstallerRecovery(process.env.VERIFIED_RUN):{sourceRun:process.env.GITHUB_RUN_ID,sourceRef:process.env.GITHUB_SHA,reuse:false};
 if(!/^\d+$/.test(result.sourceRun||'')||!/^[a-f0-9]{40}$/.test(result.sourceRef||''))throw Error('Workflow source required');
 if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,`source_run=${result.sourceRun}\nsource_ref=${result.sourceRef}\nreuse=${result.reuse}\n`);
 console.log(JSON.stringify(result));
}
