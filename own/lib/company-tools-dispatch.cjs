'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const contract=require('./company-tools-env.cjs');
const fault=code=>Object.assign(Error(code),{code});
function resolve(root,name,env=process.env){
 if(!/^[a-zA-Z0-9_-]+$/.test(name||''))throw fault('COLLECTION_COMMAND_INVALID');
 const current=contract.selection(root);if(!current)throw fault('COLLECTION_NOT_INSTALLED');
 const graph=JSON.parse(fs.readFileSync(path.join(current.directory,'collection.json'),'utf8'));
 if(graph.package!==contract.PACKAGE||graph.version!==current.version)throw fault('COLLECTION_IDENTITY');
 let entry;
 if(name==='taobao-ai-ops')entry=path.join(current.directory,'shell/bin/taobao-ai-ops.mjs');
 else {const member=graph.members.find(m=>m.bin===name);if(!member)throw fault('COLLECTION_COMMAND_REMOVED');const records=JSON.parse(fs.readFileSync(path.join(current.directory,'state/components.json'),'utf8')).components,record=records[member.id];if(record?.package!==member.package||record?.version!==member.version)throw fault('COLLECTION_COMPONENT');entry=record.entry;}
 if(typeof entry!=='string'||!path.isAbsolute(entry))throw fault('COLLECTION_ENTRY');
 const relative=path.relative(current.directory,entry);if(!relative||relative.startsWith('..'+path.sep)||relative==='..'||path.isAbsolute(relative))throw fault('COLLECTION_ENTRY');
 let cursor=current.directory;for(const part of relative.split(path.sep)){cursor=path.join(cursor,part);if(fs.lstatSync(cursor).isSymbolicLink())throw fault('COLLECTION_ENTRY');}
 if(!fs.statSync(entry).isFile())throw fault('COLLECTION_ENTRY');
 return {entry,env:contract.environment(root,env)};
}
async function run(root,name,args){
 const selected=resolve(root,name),child=spawn(process.execPath,[selected.entry,...args],{env:selected.env,stdio:'inherit',windowsHide:true}),handlers=new Map();
 for(const signal of ['SIGINT','SIGTERM','SIGHUP']){const handler=()=>child.kill(signal);handlers.set(signal,handler);process.on(signal,handler);}
 try{return await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve(code??128+(require('node:os').constants.signals[signal]||1)));});}
 finally{for(const [signal,handler]of handlers)process.removeListener(signal,handler);}
}
module.exports={resolve,run};
if(require.main===module)run(process.argv[2],process.argv[3],process.argv.slice(4)).then(code=>{process.exitCode=code;},e=>{process.stderr.write(JSON.stringify({ok:false,error:{code:e.code||'COLLECTION_COMMAND_FAILED'}})+'\n');process.exitCode=1;});
