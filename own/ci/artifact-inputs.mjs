import fs from 'node:fs';
import path from 'node:path';
import {execFileSync}from'node:child_process';
import {identity}from'../lib/binding.mjs';
const policy=JSON.parse(fs.readFileSync(new URL('./lifecycle-policy.json',import.meta.url)));
const matches=(file,rules)=>rules.some(rule=>rule.endsWith('/')?file.startsWith(rule):file===rule);
export function classify(file){
 if(matches(file,policy.generated))return 'generated';
 if(matches(file,policy.semantic))return 'semantic';
 for(const kind of ['manager','native','runtime','release'])if(matches(file,policy[kind]))return kind;
 return 'unknown';
}
function semantic(file,bytes){const p=JSON.parse(bytes);
 if(file.endsWith('package-lock.json')){delete p.version;if(p.packages?.[''])delete p.packages[''].version;return p;}
 return Object.fromEntries(Object.entries(p).filter(([key])=>!['version','ownDesktopManifest','codexOwnBinding'].includes(key)));
}
export function snapshot(root,{ref,files}={}){
 const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:16*1048576});
 files||=(ref?git(['ls-tree','-r','--name-only',ref]):git(['ls-files'])).trim().split('\n').filter(Boolean);
 const entries={};for(const file of files.sort()){
  const kind=classify(file);if(kind==='generated')continue;
  const bytes=ref?execFileSync('git',['show',ref+':'+file],{cwd:root,maxBuffer:64*1048576}):fs.readFileSync(path.join(root,file));
  // Semantic npm metadata excludes release numbers and generated bindings only.
  entries[file]={kind,sha256:identity(kind==='semantic'?semantic(file,bytes):bytes.toString('base64'))};
 }
 const group=k=>identity({policy,files:Object.fromEntries(Object.entries(entries).filter(([,e])=>e.kind===k||e.kind==='semantic'||e.kind==='unknown'))});
 const upstream=identity(Object.fromEntries(Object.entries(entries).filter(([f,e])=>(e.kind==='native'&&!f.startsWith('own/'))||e.kind==='semantic')));
 return {schema:1,entries,native:group('native'),runtime:group('runtime'),release:group('release'),upstream,unknown:Object.keys(entries).filter(f=>entries[f].kind==='unknown')};
}
export function changes(before,after){return [...new Set([...Object.keys(before?.entries||{}),...Object.keys(after.entries)])].sort().filter(f=>before?.entries?.[f]?.sha256!==after.entries[f]?.sha256).map(file=>({file,kind:after.entries[file]?.kind||before.entries[file]?.kind||'unknown'}));}
