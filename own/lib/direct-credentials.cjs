'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const fail=code=>Object.assign(Error('Protected model credentials are unavailable'),{code});
async function storage(protection,core){
 const store=protection||require('./os-credential-storage.cjs').forCore(core);
 const available=store?.isAsyncEncryptionAvailable?await store.isAsyncEncryptionAvailable():store?.isEncryptionAvailable?store.isEncryptionAvailable():typeof store?.encryptStringAsync==='function'&&typeof store?.decryptStringAsync==='function';
 if(!available||process.platform==='linux'&&store.getSelectedStorageBackend?.()==='basic_text')throw fail('CREDENTIAL_STORAGE_UNAVAILABLE');
 return store;
}
function fileAt(core,name){
 if(!/^direct-credentials-[a-f0-9-]+\.bin$/.test(name))throw fail('CREDENTIAL_PATH_INVALID');
 const file=path.join(core,name);let current=path.resolve(file);
 for(;;){if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw fail('CREDENTIAL_PATH_INVALID');const parent=path.dirname(current);if(parent===current)break;current=parent;}
 return file;
}
async function save(core,value,{protection}={}){
 const store=await storage(protection,core),plain=JSON.stringify(value),encoded=store.encryptStringAsync?await store.encryptStringAsync(plain):store.encryptString(plain),name='direct-credentials-'+crypto.randomUUID()+'.bin',file=fileAt(core,name);
 fs.mkdirSync(core,{recursive:true,mode:0o700});
 if(fs.existsSync(file))throw fail('CREDENTIAL_PATH_EXISTS');
 fs.writeFileSync(file,encoded,{flag:'wx',mode:0o600});
 if(!fs.readFileSync(file).equals(encoded))throw fail('CREDENTIAL_WRITE_FAILED');
 return name;
}
async function load(core,name,{protection}={}){
 const file=fileAt(core,name),stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.size>1024*1024||process.platform!=='win32'&&(stat.mode&0o077))throw fail('CREDENTIAL_PATH_INVALID');
 try{const store=await storage(protection,core),bytes=fs.readFileSync(file);const value=store.decryptStringAsync?(await store.decryptStringAsync(bytes)).result:store.decryptString(bytes);return JSON.parse(value);}catch{throw fail('CREDENTIAL_DECRYPT_FAILED');}
}
async function bootstrap(core,options={}){
 const file=path.join(core,'managed-login.json');if(!fs.existsSync(file))return null;
 if(fs.lstatSync(file).isSymbolicLink())throw fail('CREDENTIAL_PATH_INVALID');
 const meta=JSON.parse(fs.readFileSync(file,'utf8'));if(meta.contract!==2)return null;
 if(!meta.active)throw fail('AUTH_REQUIRED');
 const value=await load(core,meta.credentialFile,options);
 if(value.schema!==1||!value.access||!value.session||value.session.origin!==meta.origin||value.session.subject!==meta.subject)throw fail('CREDENTIAL_BINDING_INVALID');
 return {...value,session:{...value.session,credentialFile:meta.credentialFile}};
}
function required(core){
 const file=path.join(core,'managed-login.json');if(!fs.existsSync(file))return false;
 if(fs.lstatSync(file).isSymbolicLink())throw fail('CREDENTIAL_PATH_INVALID');
 const meta=JSON.parse(fs.readFileSync(file,'utf8'));return meta.contract===2&&meta.active===true;
}
module.exports={save,load,bootstrap,required};
