'use strict';
const fs=require('node:fs'),path=require('node:path');
const CHANNEL='codex-own:thread-title-policy:v1';
function configuration(core){return require('smol-toml').parse(fs.readFileSync(path.join(core,'config.toml'),'utf8'));}
function trace(core,data){try{const file=path.join(core,'thread-title-diagnostics.jsonl');if(fs.existsSync(file)){const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>262144)return;}const clean={time:Date.now()};for(const key of ['event','threadId','ready','status','kind','count','automatic','allowed'])if(['string','number','boolean'].includes(typeof data?.[key]))clean[key]=typeof data[key]==='string'?data[key].slice(0,240):data[key];fs.appendFileSync(file,JSON.stringify(clean)+'\n',{mode:0o600});}catch{}}
function model(core,fallback){trace(core,{event:'model-selected'});const c=configuration(core);return c.forced_login_method==='api'&&typeof c.model==='string'&&c.model.trim()?c.model:fallback;}
function automatic(options={}){return options.onlyIfUntitled===true||Object.hasOwn(options,'expectedTitle')||options.persist===false;}
function allow(core,id,options={}){
 if(typeof id!=='string'||!/^[-\w/:.]{1,240}$/.test(id))throw Error('Invalid thread title identity');
 const file=path.join(core,'thread-title-locks.jsonl');
 let locked=false,exists=fs.existsSync(file);
 if(exists){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Unsafe thread title policy');
  for(const line of fs.readFileSync(file,'utf8').split('\n').filter(Boolean)){const entry=JSON.parse(line);if(entry.contract!==1||typeof entry.threadId!=='string')throw Error('Invalid thread title policy');if(entry.threadId===id)locked=true;}
 }
 if(automatic(options)){trace(core,{event:'title-guard',threadId:id,automatic:true,allowed:!locked});return !locked;}
 trace(core,{event:'title-guard',threadId:id,automatic:false,allowed:true});if(!locked){fs.mkdirSync(core,{recursive:true,mode:0o700});fs.appendFileSync(file,JSON.stringify({contract:1,threadId:id})+'\n',{mode:0o600});}
 return true;
}
function install({ipcMain},core){const key=Symbol.for(CHANNEL);if(ipcMain[key])return;ipcMain[key]=true;trace(core,{event:'policy-installed'});ipcMain.on(CHANNEL+':trace',(_event,data)=>trace(core,data));ipcMain.on(CHANNEL,(event,request)=>{try{event.returnValue={ok:true,allowed:allow(core,request?.threadId,request?.options)};}catch{event.returnValue={ok:false,allowed:false};}});}
module.exports={CHANNEL,model,automatic,allow,install};
