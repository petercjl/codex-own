// Administrator-owned, explicit CorpId + UnionId bindings. No name-based matching.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
export async function employeeImage(file:string|undefined,corpId:string,unionId:string){
 if(!file)return {enabled:false,reason:'KEY_BINDING_UNVERIFIED',models:[]};
 const stat=await fs.lstat(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024||(process.platform!=='win32'&&(stat.mode&0o077)!==0))throw Error('Unsafe image binding file');
 const input=JSON.parse(await fs.readFile(file,'utf8'));
 if(input.schemaVersion!==1||!Array.isArray(input.bindings))throw Error('Invalid image binding registry');
 const matches=input.bindings.filter((x:any)=>x.corpId===corpId&&x.unionId===unionId);
 if(matches.length>1)throw Error('Duplicate image identity binding');
 const binding=matches[0];
 if(!binding||binding.verified!==true)return {enabled:false,reason:'KEY_BINDING_UNVERIFIED',models:[]};
 if(binding.enabled!==true)return {enabled:false,reason:'IMAGE_NOT_GRANTED',models:[]};
 const c=binding.credential,approved=['doubao-seedream-5-5','gemini-nano-banana-2.1','gpt-image-2.6-sunburst'];
 if(c?.schemaVersion!==1||!['cn','com'].includes(c.site)||!/^sk-[A-Za-z0-9_-]{12,}$/.test(c.apiKey)||!Array.isArray(binding.models)||!binding.models.length||!binding.models.every((m:string)=>approved.includes(m)))throw Error('Invalid image credential binding');
 return {enabled:true,adapter:'toapiscli',package:'@petercjl/toapiscli',credential:{schemaVersion:1,site:c.site,apiKey:c.apiKey},models:[...new Set(binding.models)]};
}
export const organizationId=(corpId:string)=>createHash('sha256').update(corpId).digest('hex');
