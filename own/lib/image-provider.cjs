'use strict';
// Product preferences and routing only; providers own credentials and generation.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const MARKER='codex-own-image-provider';
const providers=Object.freeze([{id:'toapiscli',label:'ToAPIs（内置）',skill:'toapiscli'}]);
const models=Object.freeze([{id:'gpt-image-2.6-sunburst',label:'GPT Image 2.6 Sunburst'},{id:'gemini-nano-banana-2.1',label:'Gemini Nano Banana 2.1'},{id:'doubao-seedream-5-5',label:'Doubao Seedream 5.5'}]);
const defaultModel='gpt-image-2.6-sunburst';
function read(core){
 const file=path.join(core,'image-provider.json');
 const value=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{schema:1,provider:'toapiscli'};
 if(value.schema!==1||!providers.some(p=>p.id===value.provider))throw Object.assign(Error('Unsupported image provider preference'),{code:'IMAGE_PROVIDER_INVALID'});
 const model=value.model??defaultModel;
 if(!models.some(m=>m.id===model))throw Object.assign(Error('Unsupported default image model'),{code:'IMAGE_MODEL_INVALID'});
 return {schema:1,provider:value.provider,model};
}
function status(core){return {...read(core),providers:providers.map(p=>({...p})),models:models.map(m=>({...m}))};}
function save(core,id,model=read(core).model){
 if(!providers.some(p=>p.id===id))throw Object.assign(Error('Unsupported image provider'),{code:'IMAGE_PROVIDER_INVALID'});
 if(!models.some(m=>m.id===model))throw Object.assign(Error('Unsupported default image model'),{code:'IMAGE_MODEL_INVALID'});
 const file=path.join(core,'image-provider.json'),value={schema:1,provider:id,model};
 fs.mkdirSync(core,{recursive:true,mode:0o700});
 if(fs.existsSync(file)){
  if(!fs.lstatSync(file).isFile())throw Error('Invalid image preference path');
  if(read(core).provider===id&&JSON.parse(fs.readFileSync(file,'utf8')).model===model)return status(core);
  fs.copyFileSync(file,file+'.backup-'+crypto.randomUUID(),fs.constants.COPYFILE_EXCL);
 }
 const temp=file+'.new-'+crypto.randomUUID();
 try{fs.writeFileSync(temp,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
 return status(core);
}
function policy(core){
 const {provider:selected,model}=read(core);
 return `<${MARKER} version="1">\nThe user selected ${selected} in codex-own Settings as the image generation and editing provider. For image requests, resolve and read the complete current toapiscli Skill at ${JSON.stringify(path.join(core,'skills','toapiscli','SKILL.md'))}, follow its generic adapter and target-owned CLI runtime, then return its results. The configured default image model is ${model}. Use this default when the current task does not explicitly select an image model; an explicit model choice in the current task takes precedence. Check current model availability and parameter contracts through the selected provider before submission. This selection applies to existing and new chats and takes precedence over generic image tool defaults. Execute image operations through this selected provider; imagegen, image_gen, native image_generation and other providers' image generation/editing tools are unavailable for this route. Do not substitute another provider after an error. Report missing credentials or capability and follow the selected Skill's recovery contract. Preserve sandbox and network approval requirements; request the normal approval if HTTPS is blocked.\n</${MARKER}>`;
}
function filtered(tools){
 return tools.flatMap(tool=>{
  if(tool.type==='image_generation'||/(?:imagegen|image_gen|generate_image|edit_image|image_generate|image_edit)/i.test(tool.name||''))return [];
  if(tool.type==='namespace'&&Array.isArray(tool.tools)){const children=filtered(tool.tools);return children.length?[{...tool,tools:children}]:[];}
  return [tool];
 });
}
function apply(body,core){
 if(!body||typeof body!=='object')return body;
 const clean=String(body.instructions||'').replace(new RegExp(`<${MARKER} version="1">[\\s\\S]*?<\\/${MARKER}>`,'g'),'').trim();
 const result={...body,instructions:[clean,policy(core)].filter(Boolean).join('\n\n')};
 if(Array.isArray(body.tools))result.tools=filtered(body.tools);
 if(Array.isArray(body.input))result.input=body.input.map(item=>['tool_search_output','additional_tools'].includes(item.type)&&Array.isArray(item.tools)?{...item,tools:filtered(item.tools)}:item);
 return result;
}
module.exports={providers,models,defaultModel,read,status,save,policy,filtered,apply};
