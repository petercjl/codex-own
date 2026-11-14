'use strict';
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {execFile}=require('node:child_process'),{StringDecoder}=require('node:string_decoder');
const {resolveBundledNode}=require('../lib/bundled-node.cjs');
const {mainDocument}=require('./account.cjs');
const CHANNEL='codex-own:company-tools:v1',services=new Map();
function service(root,{bundle=path.resolve(__dirname,'..'),execute=execFile,load=()=>import(pathToFileURL(path.join(bundle,'lib/company-tools.mjs')).href),refresh=()=>require('../lib/desktop-control.cjs').refreshSkills(root)}={}){
 if(services.has(root))return services.get(root);
 let busy=false,message='',progress=null,warning='',worker=null,operation=null;const listeners=new Set();
 const notify=()=>{for(const fn of listeners)try{fn();}catch{}};
 const read=async()=>({...((await load()).companyToolsState(root)),busy,message,progress,warning});
 const run=(mode,onProgress,channels)=>{
  if(busy)return operation;
  busy=true;warning='';progress={phase:'checking',completed:0,total:mode==='check'?1:4,step:1,indeterminate:true};message=mode==='check'?'正在检查工具集与成员版本…':'正在更新公司工具集…';notify();
  operation=new Promise(resolve=>{
   const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
   let done=false;const finish=async(error,stdout)=>{
    if(done)return;done=true;worker=null;let result;
    try{result=JSON.parse(stdout);}catch{result={status:'failed',reason:typeof error?.code==='string'?error.code:'COLLECTION_FAILED'};}
    if(['activated','recovered'].includes(result.status)||result.sourceMigration?.count>0){message='正在刷新 Skill 列表…';progress={phase:'refreshing',completed:3,total:4,step:4,indeterminate:true};notify();try{await refresh();}catch{warning='工具集已启用，Skill 列表暂未刷新，请点击“重试刷新”。';}}
    busy=false;message=result.status==='recovered'?'已保存冲突文件并恢复集合版本，可继续更新或选择渠道。':result.status==='activated'?'更新完成，已立即生效。':result.status==='available'?'发现可用更新，可点击“更新工具集”下载并应用。':result.status==='current'?'工具集和成员均已是最新版本。':result.status==='failed'?'更新失败，当前已启用的版本保持可用。':'';
    progress={...(progress||{}),phase:result.status==='failed'?'failed':'complete',indeterminate:false,...(result.status!=='failed'?{completed:mode==='check'?1:4,total:mode==='check'?1:4}:{})};notify();resolve(result);
   };
   try{worker=execute(resolveBundledNode(bundle),[path.join(bundle,'desktop/company-tools.mjs'),root,mode,...(channels?[JSON.stringify(channels)]:[])],{env,cwd:root,windowsHide:true,timeout:15*60000,maxBuffer:8*1024*1024},finish);
    const decoder=new StringDecoder('utf8');let pending='';const consume=line=>{let event;try{event=JSON.parse(line);}catch{}if(event?.type==='progress'){const {phase,completed=0,total=4,step=1,indeterminate=true}=event;progress={phase,completed,total,step,indeterminate};message=String(event.label||'').slice(0,240);}else message=line.trim().slice(-400);onProgress?.(message);notify();};worker.stderr?.on('data',b=>{pending+=decoder.write(b);let index;while((index=pending.indexOf('\n'))>=0){consume(pending.slice(0,index));pending=pending.slice(index+1);}if(pending&&!pending.trimStart().startsWith('{')){consume(pending);pending='';}});
   }catch(e){finish(e,'');}
  });return operation;
 };
 const result={read,run,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},cancel(){worker?.kill();},async refresh(){await refresh();warning='';notify();return read();},async policy(autoUpdate){if(busy)throw Error('工具集正在更新，请稍后调整。');await (await load()).setCompanyToolsPolicy(root,autoUpdate);notify();return read();}};
 services.set(root,result);return result;
}
function start({app,ipcMain},root,options={}){
 const state=service(root,options),contents=new Set();
 const broadcast=async()=>{let value;try{value=await state.read();}catch{return;}for(const web of contents)if(!web.isDestroyed()&&mainDocument(web.getURL()))web.send(CHANNEL,value);};
 const unsubscribe=state.subscribe(broadcast);
 app.on('browser-window-created',(_event,window)=>{const web=window.webContents;contents.add(web);web.once('destroyed',()=>contents.delete(web));});
 ipcMain.handle(CHANNEL,async(event,action,input)=>{
  if(!contents.has(event.sender)||event.senderFrame!==event.sender.mainFrame||!mainDocument(event.senderFrame?.url))throw Error('Invalid company tools sender');
  if(action==='read')return state.read();
  if(action==='auto-update')return state.policy(input?.enabled);
  if(['check','update','recover'].includes(action)){void state.run(action);return state.read();}
  if(action==='component-channel'){if(state&&typeof input?.id==='string'&&/^[a-zA-Z0-9._-]+$/.test(input.id)&&['latest','next'].includes(input.channel)){const current=await state.read();if(current.busy)throw Error('工具集正在更新，请稍后切换。');if(!current.members?.some(m=>m.id===input.id))throw Error('Unknown component');void state.run('update',undefined,{[input.id]:input.channel});return state.read();}throw Error('Invalid component channel');}
  if(action==='refresh')return state.refresh();
  throw Error('Invalid company tools action');
 });
 app.once('before-quit',()=>{unsubscribe();state.cancel();});return state;
}
module.exports={CHANNEL,service,start};
