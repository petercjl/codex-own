'use strict';
const fs=require('node:fs'),path=require('node:path');
const {selection,policy}=require('../lib/company-tools-env.cjs');
const {pathToFileURL}=require('node:url');
const started=new Set();
async function ensure(electron,root,apply){
 const {app,BrowserWindow,Notification}=electron;
 const bundle=path.resolve(__dirname,'..');
 // Build/CI probes freeze package acquisition explicitly. Product launches use the default.
 if(process.env.OWN_COMPANY_TOOLS_AUTO_UPDATE==='0')return {status:'disabled'};
 if(started.has(root))return {status:'unchanged'};started.add(root);
 const lifecycle=await import(pathToFileURL(path.join(bundle,'lib','company-tools.mjs')).href);
 try{await lifecycle.activatePending(root);apply();}catch(e){console.error('Company tools activation deferred:',e.code||'COLLECTION_FAILED');}
 const active=selection(root);if(active){lifecycle.stableShims(root,JSON.parse(fs.readFileSync(path.join(active.directory,'collection.json'),'utf8')));apply();}
 const manager=require('./company-tools-manager.cjs').service(root),run=manager.run;
 app.once('before-quit',()=>manager.cancel());
 const statusFile=path.join(root,'company-tools','status.json');
 let recent=false;try{recent=Date.now()-JSON.parse(fs.readFileSync(statusFile)).checkedAt<6*3600000;}catch{}
 if(!selection(root)&&!recent){
  await app.whenReady();
  const win=new BrowserWindow({title:'codex-own · 公司工具集',width:600,height:300,resizable:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  win.setMenuBarVisibility(false);
  await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><meta charset="utf-8"><body style="font:16px system-ui;padding:28px"><h2>正在准备公司 Skill 与 CLI</h2><p>首次安装需要下载完整工具集。配置和对话保留。</p><p id="status">正在连接 npm…</p><small>关闭窗口可取消，后续启动会继续检查。</small>'));
  win.on('closed',()=>manager.cancel());
  const result=await run('initial',message=>{if(!win.isDestroyed())win.webContents.executeJavaScript('document.getElementById("status").textContent='+JSON.stringify(message.trim())).catch(()=>{});});
  if(!win.isDestroyed())win.destroy();
  if(result.status==='activated'){
   apply();app.relaunch();app.exit(0);return result;
  }
  console.error('Company tools preparation:',result.reason||result.status);
  if(Notification.isSupported())new Notification({title:'公司工具集尚未就绪',body:'本次将继续打开应用。下次启动会重试；诊断见 company-tools/status.json。'}).show();
  // Chromium is already ready; restart once so upstream can register pre-ready hooks.
  // The persistent check throttle makes a failed first installation non-blocking on retry.
  if(result.status!=='throttled'){app.relaunch();app.exit(0);return result;}
 }
 const check=async()=>{
  if(!policy(root).autoUpdate)return;
  const result=await run('prepare');
  if(result.status==='activated'&&Notification.isSupported())new Notification({title:'公司工具集已更新',body:'新版 Skill 和 CLI 已启用。'}).show();
 };
 app.whenReady().then(()=>{const first=setTimeout(check,15000);first.unref();const interval=setInterval(check,6*3600000);interval.unref();app.once('before-quit',()=>{clearTimeout(first);clearInterval(interval);});});
 return {status:'available',version:selection(root)?.version||null};
}
module.exports={ensure};
