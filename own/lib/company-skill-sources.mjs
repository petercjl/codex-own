import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {rejectLinks} from './manager.mjs';
import contract from './company-tools-env.cjs';
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const fault=code=>Object.assign(Error('Company Skill sources: '+code),{code});
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function nameAt(directory){
 const file=path.join(directory,'SKILL.md');if(!fs.existsSync(file)||!fs.statSync(file).isFile())return null;
 const front=fs.readFileSync(file,'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/),match=front?.[1].match(/^name:\s*(?:"([a-z0-9][a-z0-9-]{1,99})"|'([a-z0-9][a-z0-9-]{1,99})'|([a-z0-9][a-z0-9-]{1,99}))\s*(?:#.*)?$/m);
 return match?.[1]||match?.[2]||match?.[3]||null;
}
export function sourceInventory(directory){
 const files=[];function visit(file){const stat=fs.lstatSync(file),relative=path.relative(directory,file)||'.',item={path:relative,mode:stat.mode&0o777};
  if(stat.isSymbolicLink())files.push({...item,type:'link',target:fs.readlinkSync(file)});
  else if(stat.isDirectory()){files.push({...item,type:'directory'});for(const name of fs.readdirSync(file).sort())visit(path.join(file,name));}
  else if(stat.isFile())files.push({...item,type:'file',size:stat.size,sha256:digest(fs.readFileSync(file))});
  else throw fault('SKILL_SOURCE_UNSUPPORTED_FILE');
 }visit(directory);return {sha256:digest(JSON.stringify(files)),files};
}
export function planCompanySkillSources(root,graph){
 const current=contract.selection(root);if(!current)return {items:[]};
 const base=path.join(root,'company-tools'),skills=path.join(root,'core/skills'),canonical=path.join(skills,'company-tools');rejectLinks(skills);rejectLinks(canonical);
 const marker=path.join(canonical,'.codex-own-collection.json');rejectLinks(marker);
 if(!fs.existsSync(marker)||json(marker).generation!==current.generation)throw fault('COLLECTION_SKILL_SOURCE_MISSING');
 graph??=json(path.join(current.directory,'collection.json'));
 if(graph.package!==contract.PACKAGE||graph.version!==current.version||!Array.isArray(graph.skills))throw fault('COLLECTION_SKILL_SOURCE_IDENTITY');
 const validName=name=>typeof name==='string'&&/^[a-z0-9][a-z0-9-]{1,99}$/.test(name);
 const names=new Map();for(const skill of graph.skills){if(!validName(skill.name)||nameAt(path.join(canonical,skill.name))!==skill.name)throw fault('COLLECTION_SKILL_SOURCE_IDENTITY');names.set(skill.name,'company-owned-name');}
 // Retired company capabilities must not reappear through an older manual copy.
 if(current.previous){if(!/^generation-[a-f0-9-]{36}$/.test(current.previous))throw fault('COLLECTION_PATH');const file=path.join(base,current.previous,'collection.json');rejectLinks(file);if(fs.existsSync(file)){const previous=json(file);if(previous.package!==contract.PACKAGE||!Array.isArray(previous.skills))throw fault('COLLECTION_SKILL_SOURCE_IDENTITY');for(const skill of previous.skills){if(!validName(skill.name))throw fault('COLLECTION_SKILL_SOURCE_IDENTITY');if(!names.has(skill.name))names.set(skill.name,'retired-company-name');}}}
 const items=[];
 function visit(directory,depth){if(depth>8)return;for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
  if(entry.name.startsWith('.')||directory===skills&&entry.name==='company-tools')continue;
  if(!entry.isDirectory()&&!entry.isSymbolicLink())continue;
  const source=path.join(directory,entry.name),name=nameAt(source);
  if(name){if(names.has(name))items.push({name,source,relative:path.relative(skills,source),reason:names.get(name),inventory:sourceInventory(source)});}
  else if(entry.isDirectory())visit(source,depth+1);
 }}visit(skills,0);return {contract:1,canonical,generation:current.generation,items};
}
export function reconcileCompanySkillSources(root,graph){
 const plan=planCompanySkillSources(root,graph);if(!plan.items.length)return {status:'unchanged',count:0};
 const parent=path.join(root,'company-tools','skill-archives');rejectLinks(parent);fs.mkdirSync(parent,{recursive:true,mode:0o700});
 const archive=path.join(parent,'migration-'+crypto.randomUUID());fs.mkdirSync(archive,{mode:0o700});
 const manifest=path.join(archive,'manifest.json'),items=plan.items.map((item,index)=>({...item,archive:path.join(archive,String(index)+'-'+item.name),moved:false}));
 const save=status=>{const file=manifest+'.new-'+crypto.randomUUID();fs.writeFileSync(file,JSON.stringify({contract:1,status,canonical:plan.canonical,generation:plan.generation,items},null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(file,manifest);};
 save('planned');
 try{for(const item of items){if(sourceInventory(item.source).sha256!==item.inventory.sha256)throw fault('SKILL_SOURCE_CHANGED');fs.renameSync(item.source,item.archive);item.moved=true;if(sourceInventory(item.archive).sha256!==item.inventory.sha256)throw fault('SKILL_ARCHIVE_VERIFICATION_FAILED');save('moving');}save('complete');}
 catch(error){save('incomplete');throw error;}
 return {status:'archived',count:items.length,names:items.map(i=>i.name),archive,manifest};
}
