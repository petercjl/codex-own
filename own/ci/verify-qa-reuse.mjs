// Publication-only recovery must reuse the exact app code that passed QA.
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
export function verifyQAReuse({run,jobs,artifacts,changed}){
 if(run.head_branch!=='own-main'||!/^[a-f0-9]{40}$/.test(run.head_sha)||run.path!=='.github/workflows/own-release.yml')throw Error('Untrusted QA run identity');
 const allowed=new Set(['.github/workflows/own-release.yml','own/ci/verify-qa-reuse.mjs','own/test/qa-reuse.test.mjs']);
 if(changed.some(f=>!allowed.has(f)))throw Error('App or test inputs changed; run full platform QA');
 for(const [platform,name]of [['darwin-arm64','qa / qa (macos-15, darwin-arm64)'],['win32-x64','qa / qa (windows-latest, win32-x64)']]){
  const matching=jobs.filter(j=>j.name===name);if(matching.length!==1||matching[0].status!=='completed'||matching[0].conclusion!=='success')throw Error('Both platform QA jobs must have passed');
  const assets=artifacts.filter(a=>a.name==='own-'+platform);if(assets.length!==1||assets[0].expired||!assets[0].size_in_bytes)throw Error('Verified platform artifact missing or expired');
 }
 return {ok:true,sourceRef:run.head_sha,platforms:['darwin-arm64','win32-x64'],appCodeUnchanged:true};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const id=process.argv[2];if(!/^\d+$/.test(id))throw Error('Numeric QA run id required');
 const api=endpoint=>JSON.parse(execFileSync('gh',['api',`repos/petercjl/codex-own/actions/runs/${id}${endpoint}`],{encoding:'utf8',maxBuffer:8*1048576}));
 const run=api(''),jobs=api('/jobs?per_page=100').jobs,artifacts=api('/artifacts?per_page=100').artifacts;
 const changed=execFileSync('git',['diff','--name-only',run.head_sha,'HEAD'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
 console.log(JSON.stringify({...verifyQAReuse({run,jobs,artifacts,changed}),sourceRun:id}));
}
