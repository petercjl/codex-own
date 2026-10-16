import fs from'node:fs';import path from'node:path';import{execFileSync}from'node:child_process';import{fileHash}from'../lib/network.mjs';
const [root,version]=process.argv.slice(2);if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Exact native artifact version required');
const tag='own-v'+version,repo='petercjl/codex-own';let release;
try{release=JSON.parse(execFileSync('gh',['release','view',tag,'--repo',repo,'--json','assets,isDraft'],{encoding:'utf8'}));}catch{execFileSync('gh',['release','create',tag,'--repo',repo,'--draft','--target',process.env.ARTIFACT_SOURCE_REF||process.env.EXPECTED_REF,'--title','codex-own desktop '+version,'--notes','Verified immutable native candidate.'],{stdio:'inherit'});release={assets:[],isDraft:true};}
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const record=path.join(root,'artifact-record.json');fs.copyFileSync('out/bound-manifest.json',record,fs.constants.COPYFILE_EXCL);
const files=[path.join(root,'manifest.json'),record,...walk(root).filter(f=>/^codex-own-(darwin-arm64|win32-x64)\.tar\.gz$/.test(path.basename(f)))];
if(files.length!==4)throw Error('Two complete desktop candidates required');
for(const file of files){const existing=release.assets.find(a=>a.name===path.basename(file));if(existing){const digest=existing.digest;if(digest!=='sha256:'+await fileHash(file)||existing.size!==fs.statSync(file).size)throw Error('Immutable asset exists with another checksum; inspect publication recovery');}else{if(!release.isDraft)throw Error('Cannot mutate a published native release');execFileSync('gh',['release','upload',tag,'--repo',repo,file],{stdio:'inherit'});}}
console.log(JSON.stringify({ok:true,tag,immutable:true,artifacts:files.length}));
