// A successful npm upload can remain hidden during registry processing.
export function registryConfirmationPending(output,exitCode){
 if(exitCode===0)return false;
 try{const start=output.lastIndexOf('\n{'),result=JSON.parse(output.slice(start<0?0:start+1));return result.ok===false&&result.error?.code==='REGISTRY_CONFIRMATION_PENDING';}catch{return false;}
}
