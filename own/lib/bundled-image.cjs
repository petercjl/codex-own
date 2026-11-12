'use strict';
// Desktop-owned adapter. The bundled CLI owns credential validation and Skill updates.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFile}=require('node:child_process');
const runFile=require('node:util').promisify(execFile);
const {resolveBundledNode}=require('./bundled-node.cjs');
const codeError=code=>Object.assign(Error('Image capability configuration failed'),{code});
function safe(root,file){
 const base=path.resolve(root),target=path.resolve(file);
 if(target!==base&&!target.startsWith(base+path.sep))throw codeError('UNSAFE_IMAGE_PATH');
 let current=base;
 for(const part of [null,...path.relative(base,target).split(path.sep).filter(Boolean)]){
  if(part!==null)current=path.join(current,part);
  try{if(fs.lstatSync(current).isSymbolicLink())throw codeError('UNSAFE_IMAGE_PATH');}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 return target;
}
const metadata=root=>path.join(root,'core','managed-image.json');
function save(root,value){
 const file=safe(root,metadata(root));fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 if(fs.existsSync(file)){if(!fs.statSync(file).isFile())throw codeError('UNSAFE_IMAGE_PATH');fs.copyFileSync(file,file+'.backup-'+crypto.randomUUID(),fs.constants.COPYFILE_EXCL);}
 const temp=file+'.new-'+crypto.randomUUID();fs.writeFileSync(temp,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});fs.renameSync(temp,file);
}
function deactivate(root,reason='SIGNED_OUT'){save(root,{contract:1,active:false,reason});return {enabled:false,reason};}
function environment(root,inherited={}){
 const env={...inherited};for(const key of Object.keys(env))if(/^TOAPISCLI_/i.test(key))delete env[key];
 let account='signed-out';const file=safe(root,metadata(root));
 if(fs.existsSync(file)){
  const m=JSON.parse(fs.readFileSync(file,'utf8'));
  if(m.contract===1&&m.active===true&&/^[a-f0-9]{64}$/.test(m.account)&&Date.parse(m.expiresAt)>Date.now())account=m.account;
 }
 return {...env,TOAPISCLI_CONFIG_DIR:safe(root,path.join(root,'accounts',account,'toapiscli')),TOAPISCLI_UPDATE_CHECK:'0',TOAPISCLI_AUTO_UPDATE:'0'};
}
async function cli(root,args,{bundle=path.resolve(__dirname,'..'),run=runFile,env=environment(root,process.env)}={}){
 const entry=path.join(bundle,'node_modules','@petercjl','toapiscli','bin','toapiscli.mjs');
 try{const result=await run(resolveBundledNode(bundle),[entry,...args,'--json'],{env,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:45000,maxBuffer:1024*1024,windowsHide:true});return JSON.parse(typeof result==='string'?result:result.stdout);}
 catch{throw codeError('IMAGE_CLI_FAILED');} // Never propagate subprocess output containing credential inputs.
}
async function ensureSkill(root,options={}){
 const target=safe(root,path.join(root,'core','skills','toapiscli'));
 const args=['--target',target,'--agent','codex-own'];
 const status=await cli(root,['skill','status',...args],options);
 if(status.recovery?.required||status.edited||status.installed&&!status.managed)throw codeError('IMAGE_SKILL_CONFLICT');
 if(!status.current){const installed=await cli(root,['skill',status.installed?'update':'install',...args],options);if(!installed.current)throw codeError('IMAGE_SKILL_INVALID');}
 return {installed:true};
}
async function configure(root,bootstrap,{expiresAt,...options}={}){
 // Invalidate the old account first, including when importing a replacement fails.
 deactivate(root,'CONFIGURING');
 const image=bootstrap?.image;
 if(image?.enabled!==true)return deactivate(root,typeof image?.reason==='string'?image.reason:'KEY_NOT_BOUND');
 const org=bootstrap.organization?.id,member=bootstrap.member?.id,c=image.credential;
 if(![org,member].every(v=>typeof v==='string'&&v.length>0&&v.length<=256)||!Number.isFinite(Date.parse(expiresAt))||Date.parse(expiresAt)<=Date.now()||image.adapter!=='toapiscli'||image.package!=='@petercjl/toapiscli'||c?.schemaVersion!==1||!['cn','com'].includes(c.site)||!/^sk-[A-Za-z0-9_-]{12,}$/.test(c.apiKey)||Object.keys(c).some(k=>!['schemaVersion','site','apiKey','label'].includes(k)))throw codeError('IMAGE_BOOTSTRAP_INVALID');
 const account=crypto.createHash('sha256').update(JSON.stringify([org,member])).digest('hex');
 const config=safe(root,path.join(root,'accounts',account,'toapiscli'));
 fs.mkdirSync(config,{recursive:true,mode:0o700});
 const file=path.join(config,'import-'+crypto.randomUUID()+'.json');
 const env={...environment(root,process.env),TOAPISCLI_CONFIG_DIR:config};
 try{
  fs.writeFileSync(file,JSON.stringify(c),{flag:'wx',mode:0o600});
  const target=safe(root,path.join(config,'credentials.json'));
  const result=await cli(root,['auth','import','--file',file,...(fs.existsSync(target)?['--replace']:[])],{...options,env});
  if(!result.configured||!Array.isArray(result.models)||!result.models.length)throw codeError('IMAGE_CREDENTIAL_INVALID');
  await ensureSkill(root,{...options,env});
  save(root,{contract:1,active:true,account,expiresAt});
  return {enabled:true,models:result.models};
 }finally{if(fs.existsSync(file))fs.unlinkSync(file);}
}
module.exports={environment,deactivate,ensureSkill,configure};
