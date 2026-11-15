import {spawn} from 'node:child_process';
// A successful npm upload can remain hidden during registry processing.
export function registryConfirmationPending(output,exitCode){
 if(exitCode===0)return false;
 try{const start=output.lastIndexOf('\n{'),result=JSON.parse(output.slice(start<0?0:start+1));return result.ok===false&&result.error?.code==='REGISTRY_CONFIRMATION_PENDING';}catch{return false;}
}

export function runLocalPublication(command,args,{stderr=process.stderr}={}){
 return new Promise((resolve,reject)=>{
  // npm web OTP requires real stdin and stdout terminals. Kit errors use stderr.
  const child=spawn(command,args,{stdio:['inherit','inherit','pipe']});let output='';
  child.stderr.on('data',bytes=>{stderr.write(bytes);output=(output+bytes.toString()).slice(-131072);});
  child.once('error',reject);child.once('close',code=>code===0||registryConfirmationPending(output,code)?resolve({pending:code!==0}):reject(Error('LOCAL_PUBLICATION_FAILED: '+code)));
 });
}
