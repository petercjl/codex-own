import fs from'node:fs';import path from'node:path';import{pathToFileURL}from'node:url';import{identity,validateBinding}from'../lib/binding.mjs';
export function bindArtifacts(manifest,plan,previous,source){
 const m=structuredClone(manifest),platforms=['darwin-arm64','win32-x64'];
 if(plan.components.desktop==='reuse'){m.version=previous.manifest.version;m.platforms=structuredClone(previous.manifest.platforms);m.provenance=structuredClone(previous.manifest.provenance);}
 if(plan.components.runtimes==='reuse')m.runtimes=structuredClone(previous.manifest.runtimes);
 if(previous?.manifest.version===m.version&&identity(previous.manifest.platforms)!==identity(m.platforms))throw Error('Immutable desktop version cannot be replaced');
 if(previous?.manifest.runtimes?.version===m.runtimes.version&&identity(previous.manifest.runtimes)!==identity(m.runtimes))throw Error('Immutable runtime version changed; advance its revision');
 const desktop=plan.components.desktop==='reuse'?structuredClone(previous.manifest.binding.desktop):{artifactVersion:m.version,identity:identity(m.platforms),inputFingerprint:identity({declared:plan.inputs.native,observed:m.provenance}),declaredFingerprint:plan.inputs.native,upstreamFingerprint:plan.inputs.upstream,source,updaterContract:2,verifiedPlatforms:platforms};
 let runtimes=plan.components.runtimes==='reuse'?structuredClone(previous.manifest.binding.runtimes):{artifactVersion:m.runtimes.version,identity:identity(m.runtimes),inputFingerprint:identity({declared:plan.inputs.runtime,assets:m.runtimes}),declaredFingerprint:plan.inputs.runtime,source,contract:1,verifiedPlatforms:platforms,components:Object.fromEntries(Object.entries(m.runtimes.platforms).map(([p,a])=>[p,{node:{identity:a.node.sha256,npmIdentity:a.node.sha256,npmBundledWith:'node'},python:{identity:a.python.sha256}}]))};
 if(plan.components.runtimes==='build'&&previous?.manifest.binding?.runtimes.identity===runtimes.identity){const original=structuredClone(previous.manifest.binding.runtimes);runtimes={...original,validation:{inputFingerprint:runtimes.inputFingerprint,declaredFingerprint:plan.inputs.runtime,source}};}
 m.binding={schema:1,managerVersion:plan.managerVersion,managerContract:2,releasePolicyFingerprint:plan.inputs.release,desktop,runtimes};validateBinding(m,{managerVersion:plan.managerVersion,requireProof:true});return m;
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const [manifestFile,planFile,catalogFile,output]=process.argv.slice(2),plan=JSON.parse(fs.readFileSync(planFile)),previous=fs.existsSync(catalogFile)?JSON.parse(fs.readFileSync(catalogFile)):null;
 const source={repository:'petercjl/codex-own',ref:process.env.ARTIFACT_SOURCE_REF||process.env.EXPECTED_REF,run:process.env.ARTIFACT_SOURCE_RUN||process.env.GITHUB_RUN_ID,workflow:process.env.ARTIFACT_SOURCE_WORKFLOW||'.github/workflows/own-release.yml',...(process.env.ARTIFACT_TRIGGER_REF?{triggerRef:process.env.ARTIFACT_TRIGGER_REF}:{})};
 if(source.run!==process.env.GITHUB_RUN_ID)source.publication={repository:'petercjl/codex-own',ref:process.env.EXPECTED_REF,run:process.env.GITHUB_RUN_ID,workflow:'.github/workflows/own-release.yml'};
 const m=bindArtifacts(JSON.parse(fs.readFileSync(manifestFile)),plan,previous,source);
 fs.writeFileSync(output,JSON.stringify(m,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({managerVersion:m.binding.managerVersion,desktopVersion:m.version,runtimeVersion:m.runtimes.version,desktopIdentity:m.binding.desktop.identity,runtimeIdentity:m.binding.runtimes.identity}));
}
