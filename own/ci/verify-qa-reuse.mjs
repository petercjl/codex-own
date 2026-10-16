// Publication-only recovery must reuse the exact app code that passed QA.
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import fs from'node:fs';import os from'node:os';import path from'node:path';import{snapshot}from'./artifact-inputs.mjs';
export function verifyQAReuse({run,jobs,artifacts,changed,proofs,inputs,nativeRequired=true,runtimeRequired=false}){
 if((run.head_branch!=='own-main'&&!(run.path==='.github/workflows/own-verify.yml'&&run.head_branch?.startsWith('codex/')))||!/^[a-f0-9]{40}$/.test(run.head_sha)||!['.github/workflows/own-release.yml','.github/workflows/own-sync.yml','.github/workflows/own-verify.yml'].includes(run.path))throw Error('Untrusted QA run identity');
 const allowed=new Set(['.github/workflows/own-release.yml','own/ci/verify-qa-reuse.mjs','own/test/qa-reuse.test.mjs']);
 if(changed.some(f=>!allowed.has(f)))throw Error('App or test inputs changed; run full platform QA');
 let sourceRef=run.head_sha;
 if(proofs){if(proofs.length!==2||proofs[0].sourceRef!==proofs[1].sourceRef)throw Error('Both source-pinned platform proofs required');sourceRef=proofs[0].sourceRef;for(const p of proofs)if(p.schema!==1||String(p.run)!==String(run.id)||p.workflow!==run.path||(nativeRequired&&p.nativeFingerprint!==inputs.native)||(runtimeRequired&&p.runtimeFingerprint!==inputs.runtime))throw Error('Component build inputs differ from recovered QA');}
 else if(run.path!=='.github/workflows/own-release.yml')throw Error('Legacy recovery requires the original release workflow');
 for(const [platform,name]of [['darwin-arm64','qa / qa (macos-15, darwin-arm64)'],['win32-x64','qa / qa (windows-latest, win32-x64)']]){
  if(nativeRequired){const matching=jobs.filter(j=>proofs?j.name.includes(platform)&&j.steps?.some(s=>s.name==='Verify canonical archive and local incremental reuse'&&s.conclusion==='success'):j.name===name);if(matching.length!==1||matching[0].status!=='completed'||matching[0].conclusion!=='success')throw Error('Both platform QA jobs must have passed');
  const assets=artifacts.filter(a=>a.name==='own-'+platform);if(assets.length!==1||assets[0].expired||!assets[0].size_in_bytes)throw Error('Verified platform artifact missing or expired');}
  if(proofs&&proofs.filter(p=>p.platform===platform).length!==1)throw Error('Platform proof missing');
  if(runtimeRequired){const tools=artifacts.filter(a=>a.name==='tools-'+platform);if(tools.length!==1||tools[0].expired||!tools[0].size_in_bytes||!jobs.some(j=>j.name.includes(platform)&&j.conclusion==='success'&&j.steps?.some(s=>s.name==='Verify independent Node npm Python on target OS'&&s.conclusion==='success')))throw Error('Runtime recovery proof or payload missing');}
 }
 return {ok:true,sourceRef,sourceWorkflow:run.path,triggerRef:run.head_sha,platforms:['darwin-arm64','win32-x64'],appCodeUnchanged:true};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const id=process.argv[2];if(!/^\d+$/.test(id))throw Error('Numeric QA run id required');
 const api=endpoint=>JSON.parse(execFileSync('gh',['api',`repos/petercjl/codex-own/actions/runs/${id}${endpoint}`],{encoding:'utf8',maxBuffer:8*1048576}));
 const run=api(''),jobs=api('/jobs?per_page=100').jobs,artifacts=api('/artifacts?per_page=100').artifacts;
 const plan=process.argv[3]?JSON.parse(fs.readFileSync(process.argv[3])):null;if(plan?.kind==='manager-only')throw Error('Ordinary manager reuse must use durable published artifacts, not recovery');
 let proofs;const dir=fs.mkdtempSync(path.join(os.tmpdir(),'own-qa-proof-'));
 try{const prefix=plan?.components.desktop==='reuse'?'runtime-proof-':'proof-';if(artifacts.some(a=>a.name.startsWith(prefix))){execFileSync('gh',['run','download',id,'--repo','petercjl/codex-own','--pattern',prefix+'*','--dir',dir],{stdio:'pipe'});proofs=['darwin-arm64','win32-x64'].map(p=>JSON.parse(fs.readFileSync(path.join(dir,prefix+p,'qa-proof-'+p+'.json'))));}
 const source=proofs?.[0]?.sourceRef||run.head_sha;
 const changed=execFileSync('git',['diff','--name-only',source,'HEAD'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
 const result={...verifyQAReuse({run,jobs,artifacts,changed,proofs,inputs:snapshot(process.cwd()),nativeRequired:plan?.components.desktop!=='reuse',runtimeRequired:plan?.components.runtimes==='build'}),sourceRun:id};console.log(JSON.stringify(result));
 if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,`source_ref=${result.sourceRef}\nsource_run=${id}\nsource_workflow=${result.sourceWorkflow}\ntrigger_ref=${result.triggerRef}\n`);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
