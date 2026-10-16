// Only runs in the authorized GitHub-hosted OIDC release job. Payload prereleases
// share the manager's package identity and never change the public latest tag.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileHash} from '../lib/network.mjs';
import {payloadVersion, payloadURL, validateParts} from '../lib/npm-assets.mjs';
import {packResult} from './npm-pack-result.mjs';
import {TRANSPORT} from '../lib/content-blocks.mjs';
import {mapPublicationWindows,submitPayload} from './publication-pool.mjs';

if(process.env.GITHUB_ACTIONS!=='true'||!process.env.ACTIONS_ID_TOKEN_REQUEST_URL)
  throw Error('Payload publication requires GitHub Actions OIDC');
const dir=path.resolve(process.argv[2]), file=path.join(dir,'manifest.json');
const manifest=JSON.parse(fs.readFileSync(file));
delete manifest.binding; // The verified release binding is made after publication.
const output=path.join(dir,'npm-manifest.json');
if(fs.existsSync(output))throw Error('Output already exists');
const execute=promisify(execFile);
const npm=async(args,cwd)=>(await execute('npm',args,{cwd,encoding:'utf8',maxBuffer:4*1048576})).stdout;
async function metadata(version){
  const r=await fetch(`https://registry.npmjs.org/@petercjl%2fcodex-own/${version}`,{headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(30000)});
  if(r.status===404)return null;if(!r.ok)throw Error(`Registry HTTP ${r.status}`);return r.json();
}
function find(root,name){for(const e of fs.readdirSync(root,{withFileTypes:true})){const p=path.join(root,e.name);if(e.isFile()&&e.name===name)return p;if(e.isDirectory()){const found=find(p,name);if(found)return found;}}}
const pending=[],jobs=[],seen=new Map(),publication=[],plans=[];
const runtimeFile=path.join(dir,'runtime-input.json');
if(fs.existsSync(runtimeFile))manifest.runtimes=JSON.parse(fs.readFileSync(runtimeFile));
if(!manifest.platforms?.['darwin-arm64']||!manifest.platforms?.['win32-x64'])throw Error('Both verified desktop platforms are required');
function readBlock(archive,block){
  const bytes=Buffer.alloc(block.size),handle=fs.openSync(archive,'r');let filled=0;
  try{while(filled<bytes.length){const n=fs.readSync(handle,bytes,filled,bytes.length-filled,block.offset+filled);if(!n)throw Error('Unexpected EOF');filled+=n;}}
  finally{fs.closeSync(handle);}
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==block.sha256)throw Error('Content block checksum mismatch');
  return bytes;
}
// Validate every platform and index before submitting any irreversible uploads.
const entries=Object.entries(manifest.platforms).map(([platform,asset])=>({platform,asset,parent:manifest.platforms,key:platform,archiveName:`codex-own-${platform}.tar`,desktop:true}));
for(const [platform,assets]of Object.entries(manifest.runtimes?.platforms||{}))for(const [name,asset]of Object.entries(assets))if(asset.incremental)entries.push({platform:`${platform}-${name}`,asset,parent:assets,key:name,archiveName:`runtime-${platform}-${name}.bin`,desktop:false});
for(const {platform,asset,parent,key,archiveName,desktop} of entries){
  const transport=asset.incremental;if(!transport){validateParts(asset);continue;}
  const archive=find(dir,archiveName);
  if(!transport||!archive||fs.statSync(archive).size!==transport.size)throw Error('Unverified desktop archive');
  if((desktop&&transport.transport!==TRANSPORT)||!Array.isArray(transport.blocks)||!transport.blocks.length||transport.blocks.length>1024)throw Error('Content block index required');
  let offset=0;const digest=crypto.createHash('sha256');
  for(const [index,block] of transport.blocks.entries()){
    if(block.offset!==offset||!Number.isSafeInteger(block.size)||block.size<1||block.size>64*1048576||!/^[a-f0-9]{64}$/.test(block.sha256))throw Error('Invalid content block index');
    digest.update(readBlock(archive,block));offset+=block.size;
    if(!seen.has(block.sha256)){
      const job={platform,archive,block,index};seen.set(block.sha256,job);jobs.push(job);
    }else if(seen.get(block.sha256).block.size!==block.size)throw Error('Conflicting content block size');
  }
  if(offset!==transport.size||digest.digest('hex')!==transport.sha256)throw Error('Incomplete or unverified content block index');
  plans.push({platform,asset,transport,parent,key,desktop});
}
async function settlePending(){
  const deadline=Date.now()+30*60*1000;
  while(pending.length){
    for(let i=pending.length-1;i>=0;i--){
      const item=pending[i],published=await metadata(item.version);
      if(!published)continue;
      if(published.dist?.integrity!==item.integrity||published.dist?.tarball!==item.url)
        throw Error(`Published payload identity mismatch: ${item.version}`);
      pending.splice(i,1);
    }
    if(!pending.length)return;
    if(Date.now()>=deadline)throw Error(`NPM_PROCESSING_PENDING: ${pending.length} payloads remain unavailable; inspect this run and exact versions before retrying.`);
    console.log(`Waiting for npm processing: ${pending.length} payloads pending; next upload window is paused`);
    await new Promise(r=>setTimeout(r,30000));
  }
}
const results=await mapPublicationWindows(jobs,async({platform,archive,block,index})=>{
  const sha256=block.sha256,version=payloadVersion(sha256),packageDir=fs.mkdtempSync(path.join(dir,'payload-'));
  try{
      fs.writeFileSync(path.join(packageDir,'payload.bin'),readBlock(archive,block),{flag:'wx'});
      fs.writeFileSync(path.join(packageDir,'package.json'),JSON.stringify({name:'@petercjl/codex-own',version,description:'Internal codex-own desktop data. Install @petercjl/codex-own@latest instead.',files:['payload.bin'],repository:{type:'git',url:'git+https://github.com/petercjl/codex-own.git',directory:'own'},publishConfig:{access:'public'}}),{flag:'wx'});
      const packed=packResult(await npm(['pack','--json'],packageDir),'@petercjl/codex-own'),tgz=path.join(packageDir,packed.filename);
      const existing=await metadata(version);
      if(!existing){
        console.log(`Publishing npm desktop payload ${platform} ${index+1}`);
        await submitPayload(()=>npm(['publish',tgz,'--provenance','--access','public','--tag','desktop-assets'],packageDir),{report:message=>console.log(message)});
        pending.push({version,integrity:packed.integrity,url:payloadURL(sha256)});
      }
      if(existing && (existing.dist?.integrity!==packed.integrity||existing.dist?.tarball!==payloadURL(sha256)))throw Error('Existing payload identity mismatch');
      const part={sha256,size:block.size,url:payloadURL(sha256),archiveSize:fs.statSync(tgz).size,archiveSha256:await fileHash(tgz)};
      return {platform,published:!existing,part};
  }finally{fs.rmSync(packageDir,{recursive:true,force:true});}
},settlePending);
const byHash=new Map(results.map(r=>[r.part.sha256,r]));
for(const {platform,asset,transport,parent,key,desktop} of plans){
  const parts=transport.blocks.map(b=>byHash.get(b.sha256).part);
  const submitted=results.filter(r=>r.platform===platform&&r.published);
  parent[key]={entry:asset.entry,...(asset.probe?{probe:asset.probe}:{}),...(desktop?{transport:TRANSPORT}:{format:asset.format}),size:transport.size,sha256:transport.sha256,parts};
  validateParts(parent[key]);
  publication.push({platform,publishedParts:submitted.length,reusedParts:parts.length-submitted.length,publishedBytes:submitted.reduce((n,r)=>n+r.part.archiveSize,0),totalParts:parts.length});
}
// npm scans accepted packages before exposing them. Submit first, then wait for
// every exact identity; an upload response alone never authorizes a main release.
await settlePending();
manifest.schema=2;
fs.writeFileSync(output,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
fs.writeFileSync(path.join(dir,'publication-stats.json'),JSON.stringify({version:manifest.version,platforms:publication},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({version:manifest.version,publication}));
console.log('All npm desktop payloads verified; ready to publish manager.');
