// One-time import is a full-validation baseline, never permission for fast reuse.
import fs from'node:fs';import path from'node:path';import{execFileSync}from'node:child_process';import{snapshot}from'./artifact-inputs.mjs';import{verifyPublished}from'./release-plan.mjs';
const [version,run,output]=process.argv.slice(2);if(!/^\d+\.\d+\.\d+$/.test(version)||!/^\d+$/.test(run))throw Error('Exact published version and run required');
const response=await fetch('https://registry.npmjs.org/@petercjl%2fcodex-own/'+version+'?bootstrap='+Date.now());if(!response.ok)throw Error('Published legacy package missing');const p=await response.json();
const r=JSON.parse(execFileSync('gh',['api',`repos/petercjl/codex-own/actions/runs/${run}`],{encoding:'utf8'}));
const source={repository:'petercjl/codex-own',run,ref:r.head_sha,workflow:r.path};
const result={schema:1,legacy:true,manifest:p.ownDesktopManifest,inputs:snapshot(process.cwd(),{ref:source.ref}),registry:{version,integrity:p.dist.integrity,tarball:p.dist.tarball},source};await verifyPublished(result);
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({ok:true,version,source,fastReuse:false,required:'full bridge desktop validation and archive checksums'}));
