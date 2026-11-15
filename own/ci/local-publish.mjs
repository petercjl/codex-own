import {spawn} from 'node:child_process';
// A successful npm upload can remain hidden during registry processing.
export function registryConfirmationPending(output,exitCode){
 if(exitCode===0)return false;
 try{const start=output.lastIndexOf('\n{'),result=JSON.parse(output.slice(start<0?0:start+1));return result.ok===false&&result.error?.code==='REGISTRY_CONFIRMATION_PENDING';}catch{return false;}
}

export function runLocalPublication(command,args,{stdout=process.stdout,stderr=process.stderr}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{stdio:['inherit','pipe','pipe']});let output='';
  for(const [stream,target]of [[child.stdout,stdout],[child.stderr,stderr]])stream.on('data',bytes=>{target.write(bytes);output=(output+bytes.toString()).slice(-131072);});
  child.once('error',reject);child.once('close',code=>code===0||registryConfirmationPending(output,code)?resolve({pending:code!==0}):reject(Error('LOCAL_PUBLICATION_FAILED: '+code)));
 });
}
