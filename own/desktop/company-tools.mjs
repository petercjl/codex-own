import {maintainCompanyTools} from '../lib/company-tools.mjs';
const [root,mode]=process.argv.slice(2);
const cancellation=new AbortController();
for(const event of ['SIGTERM','SIGINT'])process.once(event,()=>cancellation.abort());
if(!root||!['initial','prepare','check','update'].includes(mode))throw Error('Company tools worker arguments required');
try{
 const result=await maintainCompanyTools(root,{activate:mode!=='check',checkOnly:mode==='check',force:['check','update'].includes(mode),signal:cancellation.signal,report:progress=>process.stderr.write(JSON.stringify({type:'progress',...progress})+'\n')});
 process.stdout.write(JSON.stringify(result)+'\n');
}catch(e){process.stdout.write(JSON.stringify({status:'failed',reason:e.code||'COLLECTION_FAILED'})+'\n');process.exitCode=1;}
