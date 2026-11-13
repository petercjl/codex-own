#!/usr/bin/env node
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {request,wait} from '../lib/client.mjs';import {source,meta,status,install,checkUpdate,update} from '../lib/lifecycle.mjs';
const argv=process.argv.slice(2),pos=[],opts={};let parseError;
for(let i=0;i<argv.length;i++){const a=argv[i];if(a.startsWith('--')){const k=a.slice(2);if(['json','yes','help','version'].includes(k))opts[k]=true;else{if(!argv[i+1]||argv[i+1].startsWith('--')){parseError=Object.assign(Error('Missing option '+a),{code:'INVALID_OPTION'});break;}opts[k]=argv[++i];}}else pos.push(a);}
const output=x=>console.log(JSON.stringify(x,null,2));
try{
 if(parseError)throw parseError;
 const [group,action,id]=pos;
 if(opts.agent&&!/^[a-z][a-z0-9-]{0,63}$/.test(opts.agent))throw Object.assign(Error('Invalid Agent'),{code:'INVALID_AGENT'});
 if(opts.skill&&opts.skill!=='codex-own-cli')throw Object.assign(Error('Unknown Skill'),{code:'SKILL_NOT_FOUND'});
 const contracts=JSON.parse(fs.readFileSync(path.join(source,'capabilities.json'),'utf8')).commandContracts;const command=group==='chat'||group==='skill'||group==='update'||group==='operations'?group+' '+action:group;const declared=contracts[command]?.options;for(const k of Object.keys(opts)){if(!['help','version'].includes(k)&&declared&&!declared['--'+k])throw Object.assign(Error('Unsupported option --'+k),{code:'INVALID_OPTION'});}
 if(opts.help){const m=JSON.parse(fs.readFileSync(path.join(source,'capabilities.json'),'utf8'));output({...m,...(declared?{options:declared}:{})});}
 else if(group==='version'||opts.version){output({ok:true,package:meta.name,version:meta.version,contract:1});}
 else if(group==='capabilities')output(JSON.parse(fs.readFileSync(path.join(source,'capabilities.json'),'utf8')));
 else if(group==='skill'){
  if(action==='source')output({...JSON.parse(fs.readFileSync(path.join(source,'capabilities.json'),'utf8')),ok:true,contract:1,name:'codex-own-cli',package:meta.name,version:meta.version,path:path.join(source,'skills/codex-own-cli'),entry:'SKILL.md',complete:true,items:[{ok:true,name:'codex-own-cli',package:meta.name,version:meta.version,path:path.join(source,'skills/codex-own-cli')}]});
  else if(action==='status')output(status(opts['target-root']));
  else if(['install','update'].includes(action))output(install(opts['target-root']));
  else throw Object.assign(Error('Unsupported Skill operation'),{code:'INVALID_COMMAND'});
 }
 else if(group==='update'){if(action==='check')output(await checkUpdate());else if(action==='install')output(await update(opts['target-root'],opts.yes));else throw Error('Unsupported update operation');}
 else if(group==='doctor'){
  let desktop;try{desktop={ok:true,...await request(opts.root,'doctor')};}catch(e){desktop={ok:false,code:e.code,message:e.message};}
  output({package:meta.name,version:meta.version,node:process.version,desktop,skill:opts['target-root']?status(opts['target-root']):{status:'target-unresolved'},update:await checkUpdate()});if(!desktop.ok)process.exitCode=1;
 }
 else if(group==='chat'){
  const allowed=['create','list','send','read','events','status','wait','result','interrupt','resume','respond'];if(!allowed.includes(action))throw Object.assign(Error('Unknown chat operation'),{code:'INVALID_COMMAND'});
  if(action==='wait')output(await wait(opts.root,id,{timeout:Number(opts.timeout??60)}));
  else{
   const p={};if(id)p.threadId=id;
   if(action==='create'){p.cwd=opts.cwd;p.title=opts.title;if(opts.model)p.model=opts.model;}
   if(action==='send'){p.text=opts['message-file']?fs.readFileSync(opts['message-file'],'utf8'):opts.text??pos.slice(3).join(' ');}
   if(action==='respond'){p.requestId=opts['request-id'];p.decision=opts.decision;p.confirmed=opts.yes===true;}
   if(['create','send','respond'].includes(action)){p.operationId=opts['operation-id']||crypto.randomUUID();console.error(JSON.stringify({operationId:p.operationId,recovery:'operations read --operation-id '+p.operationId}));}
   if(opts.after)p.after=opts.after;if(opts.cursor)p.cursor=opts.cursor;if(opts.limit)p.limit=Number(opts.limit);
   output(await request(opts.root,'chat.'+action,p));
  }
 }
 else if(group==='operations'&&action==='read')output(await request(opts.root,'operations.read',{operationId:opts['operation-id']}));
 else if(!group||group==='help'||opts.help)output({package:meta.name,version:meta.version,usage:['version','capabilities','doctor [--root PATH] [--target-root SKILLS]','chat create --cwd PATH [--title TITLE] [--model MODEL] [--operation-id ID]','chat list','chat send THREAD --text MESSAGE [--operation-id ID]','chat events THREAD [--after CURSOR]','chat status|read|result THREAD','chat wait THREAD [--timeout 0..60]','chat interrupt|resume THREAD','chat respond THREAD --request-id ID --decision accept|decline|cancel --yes','operations read --operation-id ID','skill source|status|install|update --target-root SKILLS','update check|install --target-root SKILLS --yes'],defaultTarget:'local codex-own development desktop',output:'JSON; operation IDs on stderr; --root selects an explicit control profile'});
 else throw Object.assign(Error('Unknown command'),{code:'INVALID_COMMAND'});
}catch(e){output({ok:false,error:{code:e.code||'CLI_FAILED',message:e.message}});process.exitCode=1;}
