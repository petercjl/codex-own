import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {checkUpdate,prepareUpdate,readPrepared,finishUpdate,restorePrepared} from '../lib/app-update.mjs';
import {paths,exclusive,rejectLinks} from '../lib/manager.mjs';
import {cleanupAfterHealthyStartup} from '../lib/cleanup.mjs';
const [action,current,receipt]=process.argv.slice(2);
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
const cancellation=new AbortController();
process.on('message',message=>{if(message?.cancel===true)cancellation.abort();});
try {
  if(action==='check')send({result:await restorePrepared(current)||await checkUpdate(current)});
  else if(action==='cleanup')send({result:await cleanupAfterHealthyStartup(current)});
  else if(action==='download')send({result:await prepareUpdate(current,{signal:cancellation.signal,report:message=>send({progress:message})})});
  else if(action==='apply'){
    readPrepared(receipt);
    const resultFile=path.join(paths().manager,'update-result-'+randomUUID()+'.json');rejectLinks(resultFile);
    exclusive(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../handoff-ready.json'),{schema:2,ready:true,pid:process.pid,resultFile,current,receipt});
    try{const result=await finishUpdate(receipt);exclusive(resultFile,result);send({result});}
    catch(e){exclusive(resultFile,{ok:false,code:e.code||'UPDATE_FAILED'});throw e;}
  }else throw Object.assign(Error('Unknown update action'),{code:'INVALID_COMMAND'});
}catch(e){send({error:{code:e.code||'UPDATE_FAILED',message:e.message}});process.exitCode=1;}
finally{if(process.connected)process.disconnect();}
