import fs from'node:fs';import path from'node:path';import{pathToFileURL}from'node:url';
import{snapshot,changes}from'./artifact-inputs.mjs';import{identity,validateBinding}from'../lib/binding.mjs';
export function releasePlan({inputs,previous,managerVersion,mode='auto',provenanceVerified=false}){
 if(!['auto','manager-only','native','runtime'].includes(mode))throw Error('Invalid release mode');
 const changed=changes(previous?.inputs,inputs),reasons=[];let proof=false;
 try{validateBinding(previous?.manifest,{requireProof:true});proof=!!provenanceVerified;}catch(e){reasons.push(e.message);}
 const nativeChanged=!previous?.inputs||inputs.native!==previous.inputs.native||inputs.unknown.length>0;
 const runtimeChanged=!previous?.inputs||inputs.runtime!==previous.inputs.runtime||inputs.unknown.length>0;
 // Release recipes, classifiers and verification code are themselves gated inputs.
 const releaseChanged=!previous?.inputs||inputs.release!==previous.inputs.release;
 const native=nativeChanged||!proof||releaseChanged||mode==='native';
 const runtime=runtimeChanged||!proof||mode==='runtime';
 if(mode==='manager-only'&&(native||runtime))throw Object.assign(Error('Fast release refused: changed inputs, incompatible components or missing published proof'),{code:'REUSE_NOT_PROVEN'});
 const kind=native?'native':runtime?'runtime':'manager-only';
 const overlayFiles=['own/builders/updater.mjs','own/builders/upgrade-updater.mjs','own/builders/tool-gate.mjs','own/builders/runtime-isolation.mjs','own/builders/windows-icon.mjs','own/builders/update-menu.mjs'];
 const overlay=provenanceVerified&&inputs.upstream===previous?.inputs?.upstream&&!inputs.unknown.length&&changed.filter(c=>c.kind==='native').every(c=>c.file.startsWith('own/lib/')||c.file.startsWith('own/desktop/')||c.file.startsWith('own/runtime/')||overlayFiles.includes(c.file));
 return {schema:1,managerVersion,kind,nativeStrategy:overlay?'overlay':'upstream',baseVersion:overlay?previous.manifest.version:null,components:{desktop:native?'build':'reuse',runtimes:runtime?'build':'reuse'},inputs,changed,unknown:inputs.unknown,proof:{verified:proof,registry:previous?.registry||null,desktop:previous?.manifest?.binding?.desktop||null,runtimes:previous?.manifest?.binding?.runtimes||null},reasons:[...reasons,...(nativeChanged?['native inputs changed']:[]),...(runtimeChanged?['runtime inputs changed']:[]),...(releaseChanged?['release recipes changed']:[])],gates:['macos-manager','windows-manager','packed-install-update-rollback',...(native?['macos-native','windows-native']:['pinned-native-invocation']),...(runtime?['macos-runtime','windows-runtime']:[])],planIdentity:identity({managerVersion,inputs,components:{native,runtime},previous:previous?.registry})};
}
export function verifyBuildRun(source,run,jobs,component,{recovered=false}={}){
 if((run.conclusion!=='success'&&!recovered)||run.head_sha!==(source.triggerRef||source.ref)||run.path!==source.workflow||!['.github/workflows/own-release.yml','.github/workflows/own-sync.yml','.github/workflows/own-verify.yml'].includes(source.workflow))throw Error('Build provenance is not a successful source-pinned run');
 for(const platform of ['darwin-arm64','win32-x64']){
  const matches=jobs.filter(j=>j.conclusion==='success'&&j.name.includes(platform)&&j.steps?.some(s=>s.conclusion==='success'&&s.name===(component==='desktop'?'Verify canonical archive and local incremental reuse':'Verify independent Node npm Python on target OS')));
  if(!matches.length)throw Error('Missing successful '+component+' QA for '+platform);
 }
 return true;
}
export async function verifyPublished(previous,{fetcher=fetch,loadRun}={}){
 const r=previous?.registry;if(!r||!/^\d+\.\d+\.\d+$/.test(r.version)||!r.integrity)throw Error('Missing persistent registry evidence');
 const response=await fetcher('https://registry.npmjs.org/@petercjl%2fcodex-own/'+r.version+'?proof='+Date.now());if(!response.ok)throw Error('Published proof unavailable');const p=await response.json();
 if(p.dist?.integrity!==r.integrity||identity(p.ownDesktopManifest)!==identity(previous.manifest))throw Error('Published manifest or package integrity changed');
 if(!previous.legacy){const b=previous.manifest.binding;if(previous.inputs?.native!==b.desktop.declaredFingerprint||previous.inputs?.runtime!==(b.runtimes.validation?.declaredFingerprint||b.runtimes.declaredFingerprint)||previous.inputs?.release!==b.releasePolicyFingerprint)throw Error('Local input inventory differs from published component proof');}
 const components=previous.legacy?[{source:previous.source,kind:'desktop'},{source:previous.source,kind:'runtimes'}]:[{...previous.manifest.binding?.desktop,kind:'desktop'},{...previous.manifest.binding?.runtimes,kind:'runtimes'},...(previous.manifest.binding?.runtimes.validation?[{source:previous.manifest.binding.runtimes.validation.source,kind:'runtimes'}]:[])];
 for(const component of components){
  if(!component)throw Error('Missing native provenance');
  const {execFileSync}=await import('node:child_process');const read=loadRun||((id)=>{const url=`repos/petercjl/codex-own/actions/runs/${id}`;return{run:JSON.parse(execFileSync('gh',['api',url],{encoding:'utf8'})),jobs:JSON.parse(execFileSync('gh',['api',url+'/jobs?per_page=100'],{encoding:'utf8',maxBuffer:8*1048576})).jobs};});
  const {run,jobs}=await read(component.source.run);
  if(component.source.publication){const publication=await read(component.source.publication.run);if(publication.run.conclusion!=='success'||publication.run.head_sha!==component.source.publication.ref||publication.run.path!=='.github/workflows/own-release.yml')throw Error('Publication recovery not successfully released');}
  verifyBuildRun(component.source,run,jobs,component.kind,{recovered:!!component.source.publication});
 }
 return true;
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const [root,version,output,mode='auto']=process.argv.slice(2),file=path.join(root,'own/artifacts/current.json');const previous=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):null;let verified=false;let error;
 if(previous)try{verified=await verifyPublished(previous);}catch(e){error=e.message;}
 const plan=releasePlan({inputs:snapshot(root),previous,managerVersion:version,mode,provenanceVerified:verified});if(error)plan.reasons.push(error);
 fs.writeFileSync(output,JSON.stringify(plan,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({kind:plan.kind,components:plan.components,reasons:plan.reasons,planIdentity:plan.planIdentity}));
 if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,`native=${plan.components.desktop==='build'}\nruntime=${plan.components.runtimes==='build'}\nkind=${plan.kind}\nbase_version=${plan.baseVersion||''}\n`);
}
