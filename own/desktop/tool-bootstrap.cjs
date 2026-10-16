'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {StringDecoder}=require('node:string_decoder');
const tools=require('../lib/tool-env.cjs');
let pending;
function ensureTools(electron,root,apply,{launch=spawn}={}){
 const bundle=path.resolve(__dirname,'..'),base=path.join(root,'runtimes');
 const meta=JSON.parse(fs.readFileSync(path.join(bundle,'desktop-version.json')));
 try{if(tools.active(base)?.version===meta.toolRuntimeVersion){apply();return Promise.resolve({ok:true,unchanged:true});}}catch{}
 if(pending)return pending;
 pending=(async()=>{
  const {app,BrowserWindow,dialog}=electron;await app.whenReady();
  const logs=path.join(root,'logs');fs.mkdirSync(logs,{recursive:true,mode:0o700});
  const logPath=path.join(logs,'runtime-bootstrap-'+crypto.randomUUID()+'.log'),log=fs.openSync(logPath,'wx',0o600);
  const win=new BrowserWindow({title:'codex-own · 准备运行环境',width:620,height:320,resizable:false,show:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  win.setMenuBarVisibility(false);
  await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><meta charset="utf-8"><title>codex-own</title><body style="font:16px system-ui;background:#182c38;color:#f2f5f8;padding:32px"><h2>正在准备 codex-own 工作环境</h2><p>首次升级需要从 npm 下载独立 Node、npm 和 Python。完成后将自动打开应用。</p><p id="status" style="font-size:14px;overflow-wrap:anywhere">正在连接 npm…</p><p style="font-size:13px;color:#b7c7d3">已有配置和对话会保留。关闭此窗口可取消，之后重新打开应用继续。</p></body>'));
  let child,cancelled=false,finished=false;
  const cancel=()=>{if(!finished){cancelled=true;if(child?.connected)child.send({cancel:true});}};
  win.on('closed',cancel);app.on('before-quit',cancel);
  try{
   return await new Promise((resolve,reject)=>{
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
    if(cancelled){reject(Object.assign(Error('Runtime preparation cancelled'),{code:'CANCELLED'}));return;}
    try{child=launch(path.join(bundle,process.platform==='win32'?'node.exe':'node'),[path.join(bundle,'desktop','bootstrap-tools.mjs')],{env,cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});}catch(e){reject(e);return;}
    const decoder=new StringDecoder('utf8'),stdoutDecoder=new StringDecoder('utf8');let output='',tail='';
    child.stdout.on('data',b=>{output+=stdoutDecoder.write(b);if(output.length>1048576)cancel();});
    child.stderr.on('data',b=>{fs.writeSync(log,b);tail+=decoder.write(b);const messages=tail.split('\n');tail=messages.pop();const last=messages.at(-1);if(last&&!win.isDestroyed())win.webContents.executeJavaScript('document.getElementById("status").textContent='+JSON.stringify(last)).catch(()=>{});});
    child.once('error',reject);
    child.once('close',code=>{
     output+=stdoutDecoder.end();
     if(cancelled){reject(Object.assign(Error('Runtime preparation cancelled'),{code:'CANCELLED'}));return;}
     if(code!==0){reject(Error('Runtime preparation failed; see '+logPath));return;}
     try{const r=JSON.parse(output);if(!r.ok||tools.active(base)?.version!==meta.toolRuntimeVersion)throw Error('Unexpected runtime install receipt');apply();
      // Showing preparation has already made Electron ready. Restart before
      // upstream startup registers pre-ready protocols and window lifecycle.
      finished=true;app.relaunch();app.exit(0);resolve(r);
     }catch(e){reject(e);}
    });
   });
  }catch(e){if(e.code!=='CANCELLED')dialog.showErrorBox('codex-own 运行时准备失败','请检查 npm 网络连接后重新打开应用。诊断日志：\n'+logPath);throw e;}
  finally{finished=true;app.removeListener('before-quit',cancel);if(!win.isDestroyed())win.destroy();fs.closeSync(log);}
 })();
 return pending;
}
module.exports={ensureTools};
