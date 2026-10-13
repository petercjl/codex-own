// Only runs in the authorized GitHub-hosted OIDC release job. Payload prereleases
// share the manager's package identity and never change the public latest tag.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileHash} from '../lib/network.mjs';
import {payloadVersion, payloadURL, validateParts} from '../lib/npm-assets.mjs';
import {packResult} from './npm-pack-result.mjs';

if(process.env.GITHUB_ACTIONS!=='true'||!process.env.ACTIONS_ID_TOKEN_REQUEST_URL)
  throw Error('Payload publication requires GitHub Actions OIDC');
const dir=path.resolve(process.argv[2]), file=path.join(dir,'manifest.json');
const manifest=JSON.parse(fs.readFileSync(file));
const output=path.join(dir,'npm-manifest.json');
if(fs.existsSync(output))throw Error('Output already exists');
const npm=(args,cwd)=>execFileSync('npm',args,{cwd,encoding:'utf8',maxBuffer:4*1048576});
async function metadata(version){
  const r=await fetch(`https://registry.npmjs.org/@petercjl%2fcodex-own/${version}`,{signal:AbortSignal.timeout(30000)});
  if(r.status===404)return null;if(!r.ok)throw Error(`Registry HTTP ${r.status}`);return r.json();
}
function find(root,name){for(const e of fs.readdirSync(root,{withFileTypes:true})){const p=path.join(root,e.name);if(e.isFile()&&e.name===name)return p;if(e.isDirectory()){const found=find(p,name);if(found)return found;}}}
const pending=[];
for(const [platform,asset] of Object.entries(manifest.platforms)){
  const archive=find(dir,`codex-own-${platform}.tar.gz`);
  if(!archive||fs.statSync(archive).size!==asset.size||await fileHash(archive)!==asset.sha256)throw Error('Unverified desktop archive');
  const handle=fs.openSync(archive,'r'),parts=[];
  try{
    for(let offset=0;offset<asset.size;offset+=128*1048576){
      const bytes=Buffer.alloc(Math.min(128*1048576,asset.size-offset));let filled=0;
      while(filled<bytes.length){const n=fs.readSync(handle,bytes,filled,bytes.length-filled,offset+filled);if(!n)throw Error('Unexpected EOF');filled+=n;}
      const sha256=crypto.createHash('sha256').update(bytes).digest('hex'),version=payloadVersion(sha256);
      const packageDir=fs.mkdtempSync(path.join(dir,'payload-'));
      fs.writeFileSync(path.join(packageDir,'payload.bin'),bytes,{flag:'wx'});
      fs.writeFileSync(path.join(packageDir,'package.json'),JSON.stringify({name:'@petercjl/codex-own',version,description:'Internal codex-own desktop data. Install @petercjl/codex-own@latest instead.',files:['payload.bin'],repository:{type:'git',url:'git+https://github.com/petercjl/codex-own.git',directory:'own'},publishConfig:{access:'public'}}),{flag:'wx'});
      const packed=packResult(npm(['pack','--json'],packageDir),'@petercjl/codex-own'),tgz=path.join(packageDir,packed.filename);
      let existing=await metadata(version);
      if(!existing){
        console.log(`Publishing npm desktop payload ${platform} ${parts.length+1}`);
        let failure;
        try{npm(['publish',tgz,'--provenance','--access','public','--tag','desktop-assets'],packageDir);}catch(e){failure=e;}
        pending.push({version,integrity:packed.integrity,url:payloadURL(sha256),failure});
      }
      if(existing && (existing.dist?.integrity!==packed.integrity||existing.dist?.tarball!==payloadURL(sha256)))throw Error('Existing payload identity mismatch');
      parts.push({sha256,size:bytes.length,url:payloadURL(sha256),archiveSize:fs.statSync(tgz).size,archiveSha256:await fileHash(tgz)});
      fs.rmSync(packageDir,{recursive:true,force:true});
    }
  }finally{fs.closeSync(handle);}
  manifest.platforms[platform]={entry:asset.entry,size:asset.size,sha256:asset.sha256,parts};
  validateParts(manifest.platforms[platform]);
}
// npm scans accepted packages before exposing them. Submit first, then wait for
// every exact identity; an upload response alone never authorizes a main release.
const deadline=Date.now()+30*60*1000;
while(pending.length){
  for(let i=pending.length-1;i>=0;i--){
    const item=pending[i],published=await metadata(item.version);
    if(!published)continue;
    if(published.dist?.integrity!==item.integrity||published.dist?.tarball!==item.url)
      throw Error(`Published payload identity mismatch: ${item.version}`);
    pending.splice(i,1);
  }
  if(!pending.length)break;
  if(Date.now()>=deadline)throw pending.find(p=>p.failure)?.failure||Error(`NPM_PROCESSING_PENDING: ${pending.length} payloads remain unavailable; inspect this run and exact versions before retrying.`);
  console.log(`Waiting for npm scanning: ${pending.length} payloads pending`);
  await new Promise(r=>setTimeout(r,30000));
}
manifest.schema=2;
fs.writeFileSync(output,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log('All npm desktop payloads verified; ready to publish manager.');
