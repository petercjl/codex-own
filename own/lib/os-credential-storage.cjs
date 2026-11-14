'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFile}=require('node:child_process');
const fail=()=>Object.assign(Error('OS credential storage is unavailable'),{code:'CREDENTIAL_STORAGE_UNAVAILABLE'});
function execute(file,args,input,{encoding=null}={}){
 return new Promise((resolve,reject)=>{
  const child=execFile(file,args,{encoding,windowsHide:true,timeout:30000,maxBuffer:3*1024*1024},(error,stdout)=>error?reject(fail()):resolve(stdout));
  child.stdin.on('error',()=>{});child.stdin.end(input);
 });
}
function forCore(core,{platform=process.platform,bundle=path.resolve(__dirname,'..'),run=execute}={}){
 const identity=platform==='win32'?path.win32.resolve(core).toLowerCase():path.resolve(core);
 const service='codex-own.credentials.'+crypto.createHash('sha256').update(identity).digest('hex');
 const mac=path.join(bundle,'native','credential-store'),script=path.join(bundle,'native','credential-store.ps1');
 const powershell=path.win32.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 async function operation(mode,input){
  if(platform==='darwin')return run(mac,[mode,service],Buffer.from(input));
  if(platform==='win32'){
   const text=await run(powershell,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Mode',mode,'-Service',service],Buffer.from(input).toString('base64'),{encoding:'utf8'});
   return Buffer.from(text.trim(),'base64');
  }
  throw fail();
 }
 return {isAsyncEncryptionAvailable:async()=>platform==='darwin'?fs.existsSync(mac):platform==='win32'&&fs.existsSync(script)&&fs.existsSync(powershell),
  encryptStringAsync:value=>operation('encrypt',Buffer.from(value)),
  decryptStringAsync:async value=>({result:(await operation('decrypt',value)).toString('utf8'),shouldReEncrypt:false})};
}
module.exports={forCore};
