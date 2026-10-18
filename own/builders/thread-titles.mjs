import path from 'node:path';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),acorn=require('acorn');
const policy='/* codex-own:title-ownership-v1 */',modelMarker='/* codex-own:title-model-v1 */',delayMarker='/* codex-own:title-after-turn-v1 */';
export const titlePreload=';(()=>{const {contextBridge,ipcRenderer}=require("electron");contextBridge.exposeInMainWorld("codexOwnThreadTitles",{trace:data=>ipcRenderer.send("codex-own:thread-title-policy:v1:trace",data),allow:(threadId,options)=>{const r=ipcRenderer.sendSync("codex-own:thread-title-policy:v1",{threadId,options});if(!r?.ok)throw Error("Title policy unavailable");return r.allowed;}});})();\n';
const native='require(require("node:path").join(process.resourcesPath,"own-updater","desktop","thread-titles.cjs"))';
function walk(n,fn){if(!n||typeof n!=='object')return;fn(n);for(const v of Object.values(n)){if(Array.isArray(v))v.forEach(x=>walk(x,fn));else if(v&&typeof v==='object')walk(v,fn);}}
// The callback is scheduled without blocking thread admission. Its subscription
// belongs to this client and is removed on completion, deletion or deadline.
export const afterTurn=String.raw`const __ownTitlePending=new WeakMap;
function __ownTitleAfterTurn(client,id,run){
 const trace=(event,details={})=>globalThis.codexOwnThreadTitles?.trace?.({event,threadId:id,...details});
 let pending=__ownTitlePending.get(client);if(!pending){pending=new Set;__ownTitlePending.set(client,pending);}if(pending.has(id))return;pending.add(id);trace('scheduled');
 let finished=false,timer,lastStatus,errors=0;const deadline=Date.now()+30*60*1000;
 const done=ok=>{if(finished)return;finished=true;clearTimeout(timer);pending.delete(id);trace('settled',{ready:ok});if(ok)Promise.resolve().then(run).catch(()=>trace('callback-error'));};
 const read=async(method,args,select)=>{let request,value;try{request=client[method](...args);value=await request;return select(value);}finally{value?.[Symbol.dispose]?.();if(request!==value)request?.[Symbol.dispose]?.();}};
 const poll=async()=>{if(finished)return;try{
  const state=await read('getThreadExecutionState',[id],v=>v==null?null:{inProgress:v.inProgress});
  if(state&&!state.inProgress){const status=await read('listThreadTurns',[id,{limit:1}],v=>v?.response?.data?.[0]?.status??null);if(status!==lastStatus){lastStatus=status;trace('history',{status:status??'empty'});}if(status==='completed'){done(true);return;}if(status==='failed'||status==='interrupted'){done(false);return;}}
  errors=0;
 }catch{if(errors++<3)trace('rpc-read-error');}
 if(Date.now()>=deadline){done(false);return;}timer=setTimeout(poll,1000);
 };void poll();
}
`;
export function patchTitleSource(source,{renderer=false}={}){
 const edits=[];let guards=source.includes(policy)?1:0,models=source.includes(modelMarker)?1:0,delays=source.includes(delayMarker)?1:0;
 if(renderer&&source.includes(delayMarker)&&!source.includes(afterTurn.trim()))throw Error('Outdated thread title scheduler');
 const ast=acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'});
 walk(ast,n=>{
  if(n.type==='MethodDefinition'&&n.key.name==='setThreadTitle'&&source.slice(n.start,n.end).includes('persistThreadTitle')&&!source.slice(n.start,n.end).includes(policy)){
   const f=n.value,[id,,options]=f.params;const opt=options?.type==='AssignmentPattern'?options.left:options;
   if(id?.type!=='Identifier'||opt?.type!=='Identifier')throw Error('Thread title guard bindings changed');
   const body=source.slice(f.body.start,f.body.end);if(!body.includes('expectedTitle')||!body.includes('persistThreadTitle'))throw Error('Thread title persistence changed');
   const guard=renderer?'globalThis.codexOwnThreadTitles.allow('+id.name+','+opt.name+')':native+'.allow(process.env.CODEX_HOME,'+id.name+','+opt.name+')';
   // Validate the upstream normalized title before recording ownership.
   const validation=f.body.body.find(x=>x.type==='IfStatement'&&source.slice(x.start,x.end).includes('==null'));
   if(!validation)throw Error('Thread title validation changed');
   edits.push([validation.end,validation.end,policy+'if(!('+guard+'))return false;']);
   const commits=[];walk(f.body,x=>{if(x.type==='ArrowFunctionExpression'&&x.async&&x.body.type==='BlockStatement'&&source.slice(x.body.start,x.body.end).includes('hasUnacknowledgedTitle'))commits.push(x);});
   if(commits.length!==1)throw Error('Thread title commit changed');
   edits.push([commits[0].body.start+1,commits[0].body.start+1,'if(('+opt.name+'.onlyIfUntitled||Object.hasOwn('+opt.name+',"expectedTitle"))&&!('+guard+'))return;']);guards++;
  }
  if(!renderer&&n.type==='MethodDefinition'&&n.key.name==='generateTitle'&&!source.slice(n.start,n.end).includes(modelMarker)){
   const ms=[];walk(n.value.body,x=>{if(x.type==='Property'&&x.key.name==='model')ms.push(x.value);});
   if(ms.length!==1)throw Error('Title model binding changed');const m=ms[0];
   edits.push([m.start,m.end,modelMarker+native+'.model(process.env.CODEX_HOME,('+source.slice(m.start,m.end)+'))']);models++;
  }
  if(renderer&&n.type==='FunctionDeclaration'&&!source.slice(n.start,n.end).includes(delayMarker)&&source.slice(n.start,n.end).includes('Failed to load pasted text excerpts for title generation')){
   const [scope,client,params]=n.params;if(params?.type!=='ObjectPattern')throw Error('Title callback changed');
   const id=params.properties.find(x=>x.key.name==='conversationId')?.value;if(!id)throw Error('Title thread binding changed');
   edits.push([params.end-1,params.end-1,',__ownReady=false']);
   const fields=params.properties.map(p=>p.key.name+':'+p.value.name).join(',');
   edits.push([n.body.start+1,n.body.start+1,delayMarker+'if(!__ownReady){__ownTitleAfterTurn('+client.name+','+id.name+',()=>'+n.id.name+'('+scope.name+','+client.name+',{'+fields+',__ownReady:true}));return;}']);delays++;
  }
 });
 for(const [a,b,v]of edits.sort((a,b)=>b[0]-a[0]))source=source.slice(0,a)+v+source.slice(b);
 if(renderer&&delays&& !source.includes('function __ownTitleAfterTurn(')){source=afterTurn+source;edits.push([0,0,afterTurn]);}
 acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'});return {source,guards,models,delays,edits};
}
export function titleChanges(asar,archive,{priorChanges=new Map()}={}){
 const changes=new Map();let guards=0,models=0,delays=0,preload=0;
 for(const name of asar.listPackage(archive).map(x=>x.replaceAll('\\','/').replace(/^\//,''))){
  if(!name.endsWith('.js')||!(name.startsWith('.vite/build/')||name.startsWith('webview/assets/')))continue;
  let s=(priorChanges.get(name)||asar.extractFile(archive,name.replaceAll('/',path.sep))).toString(),before=s;
  if(name==='.vite/build/preload.js'){preload++;if(!s.includes(titlePreload))s=titlePreload+s;}
  else if(s.includes('async setThreadTitle(')||s.includes('async generateTitle(')||s.includes('Failed to load pasted text excerpts for title generation')){const r=patchTitleSource(s,{renderer:name.startsWith('webview/')});s=r.source;guards+=r.guards;models+=r.models;delays+=r.delays;}
  if(s!==before)changes.set(name,Buffer.from(s));
 }
 if(guards!==2||models!==1||delays!==1||preload!==1)throw Error(`Title entry points changed: ${guards}/${models}/${delays}/${preload}`);
 return changes;
}
export function verifyThreadTitles(app,asar){
 const resources=path.join(app,fs.existsSync(path.join(app,'Contents'))?'Contents/Resources':'resources');
 if(titleChanges(asar,path.join(resources,'app.asar')).size)throw Error('Thread title patch is missing from desktop');
 fs.statSync(path.join(resources,'own-updater','desktop','thread-titles.cjs'));
 return {contract:1,afterFirstTurn:true,manualTitlePersistent:true};
}
