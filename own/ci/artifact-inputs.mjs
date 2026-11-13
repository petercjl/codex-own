import fs from 'node:fs';
import path from 'node:path';
import {execFileSync}from'node:child_process';
import {identity}from'../lib/binding.mjs';
const policy=JSON.parse(fs.readFileSync(new URL('./lifecycle-policy.json',import.meta.url)));
const matches=(file,rules)=>rules.some(rule=>rule.endsWith('/')?file.startsWith(rule):file===rule);
export function classify(file,policyOverride=policy){
 const policy=policyOverride;
 if(matches(file,policy.generated))return 'generated';
 if(matches(file,policy.semantic))return 'semantic';
 for(const kind of ['manager','native','runtime','release'])if(matches(file,policy[kind]))return kind;
 return 'unknown';
}
function semantic(file,bytes){const p=JSON.parse(bytes);
 if(file.endsWith('package-lock.json')){delete p.version;if(p.packages?.[''])delete p.packages[''].version;return p;}
 return Object.fromEntries(Object.entries(p).filter(([key])=>!['version','ownDesktopManifest','codexOwnBinding'].includes(key)));
}
export function componentFingerprint(entries,kind,selectedPolicy=policy){
 const toolchain=Object.fromEntries(Object.entries(selectedPolicy.toolchain).filter(([key])=>key!=='macos'||selectedPolicy.targets.includes('darwin-arm64')));
 const rules=selectedPolicy[kind];
 const files=Object.fromEntries(Object.entries(entries).filter(([,e])=>e.kind===kind||e.kind==='semantic'||e.kind==='unknown').map(([file,e])=>[file,kind==='runtime'&&e.kind==='semantic'?{kind:e.kind,sha256:e.runtimeSha256}:e]));
 return identity({schema:2,targets:selectedPolicy.targets,toolchain,rules,files});
}
export function snapshot(root,{ref,files,policyOverride=policy}={}){
 const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:16*1048576});
 let modes={};if(!files){const rows=git(ref?['ls-tree','-r','-z',ref]:['ls-files','--stage','-z']).split('\0').filter(Boolean);for(const row of rows){const i=row.indexOf('\t');if(i<0)throw Error('Invalid tracked source entry');modes[row.slice(i+1)]=row.slice(0,6);}files=Object.keys(modes);}
 const entries={};for(const file of files.sort()){
  const kind=classify(file,policyOverride);if(kind==='generated')continue;
  const location=path.join(root,file),link=!ref&&fs.lstatSync(location).isSymbolicLink();
  const bytes=ref?execFileSync('git',['show',ref+':'+file],{cwd:root,maxBuffer:64*1048576}):link?Buffer.from(fs.readlinkSync(location)):fs.readFileSync(location);
  // Semantic npm metadata excludes release numbers and generated bindings only.
  entries[file]={kind,sha256:identity({mode:modes[file]||(link?'120000':'100644'),content:kind==='semantic'?semantic(file,bytes):bytes.toString('base64')})};
  if(kind==='semantic'){const p=semantic(file,bytes);entries[file].runtimeSha256=identity(file.endsWith('package-lock.json')?p:{dependencies:p.dependencies,devDependencies:p.devDependencies,optionalDependencies:p.optionalDependencies,engines:p.engines});}
 }
 const group=k=>componentFingerprint(entries,k,policyOverride);
 const upstream=identity(Object.fromEntries(Object.entries(entries).filter(([f,e])=>(e.kind==='native'&&!f.startsWith('own/'))||e.kind==='semantic')));
 return {schema:2,entries,native:group('native'),runtime:group('runtime'),release:group('release'),upstream,unknown:Object.keys(entries).filter(f=>entries[f].kind==='unknown')};
}
export function changes(before,after){return [...new Set([...Object.keys(before?.entries||{}),...Object.keys(after.entries)])].sort().filter(f=>before?.entries?.[f]?.sha256!==after.entries[f]?.sha256).map(file=>({file,kind:after.entries[file]?.kind||before.entries[file]?.kind||'unknown'}));}
