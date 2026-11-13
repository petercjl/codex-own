import {mapLimited} from './publication-pool.mjs';
import {identity} from '../lib/binding.mjs';
import {validateParts,payloadVersion,payloadURL} from '../lib/npm-assets.mjs';

// The release planner has verified this exact immutable catalog against npm and
// its source-pinned successful QA. Final registry assembly still verifies bytes.
export function trustedPayloads(previous,plan){
 const parts=new Map();
 if(!plan?.proof?.verified)return parts;
 if(!previous?.manifest?.binding||identity(plan.proof.registry)!==identity(previous.registry)||
   identity(plan.proof.desktop)!==identity(previous.manifest.binding.desktop)||
   identity(plan.proof.runtimes)!==identity(previous.manifest.binding.runtimes))throw Error('Payload reuse provenance mismatch');
 const assets=[...Object.values(previous.manifest.platforms),...Object.values(previous.manifest.runtimes?.platforms||{}).flatMap(Object.values)];
 for(const asset of assets){
  validateParts(asset);
  for(const part of asset.parts){
   const prior=parts.get(part.sha256);
   if(prior&&identity(prior)!==identity(part))throw Error('Conflicting published payload');
   parts.set(part.sha256,part);
  }
 }
 return parts;
}

export async function preparePayload({block,known,metadata,prepare}){
 const part=known.get(block.sha256);
 if(part){
  if(part.size!==block.size)throw Error('Published payload size mismatch');
  const published=await metadata(payloadVersion(block.sha256));
  if(published){
   if(published.name!=='@petercjl/codex-own'||published.version!==payloadVersion(block.sha256)||published.dist?.tarball!==payloadURL(block.sha256))throw Error('Published payload identity mismatch');
   return {published:false,part:{...part}};
  }
 }
 return prepare();
}

export async function planPayloadJobs(jobs,known,metadata){
 const checked=await mapLimited(jobs,4,async job=>({job,result:await preparePayload({block:job.block,known,metadata,prepare:async()=>null})}));
 return {reused:checked.filter(x=>x.result).map(({job,result})=>({platform:job.platform,...result})),needed:checked.filter(x=>!x.result).map(x=>x.job)};
}
