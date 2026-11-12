'use strict';
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const CHANNEL='codex-own:account:v1';
const DISPLAY='codex-own:account-display:v1';
const COMPANY_ORIGIN=require('../defaults/company-auth.json').origin;
const imageProvider=require('../lib/image-provider.cjs');
if(new URL(COMPANY_ORIGIN).protocol!=='https:')throw Error('Enterprise authorization requires HTTPS');
function displayState(state){return {phase:state.phase,authenticated:state.authenticated===true,name:state.authenticated===true?String(state.name||'企业账号').slice(0,100):'',restartRequired:state.restartRequired===true,userCode:state.phase==='waiting'?String(state.userCode||'').slice(0,8):''};}
function mainDocument(url){try{const u=new URL(url);return u.protocol==='app:'&&u.host==='-'&&u.pathname==='/index.html'&&!u.username&&!u.password;}catch{return false;}}
function start({app,BrowserWindow,Menu,MenuItem,ipcMain,shell},root,{loadClient}={}){
 const core=path.join(root,'core'),bundle=path.dirname(__dirname),page=path.join(__dirname,'account.html');
 const p={root,core,manager:path.join(root,'manager'),target:process.platform==='darwin'?path.resolve(process.resourcesPath,'../..'):path.dirname(process.resourcesPath)};
 let state={phase:'checking',authenticated:false},pending=null,abort=null,busy=false,statusPromise=null,revision=0,lastChecked=0;
 const contents=new Set();
 app.on('browser-window-created',(_event,win)=>{const web=win.webContents;contents.add(web);web.once('destroyed',()=>contents.delete(web));web.on('did-finish-load',()=>{if(mainDocument(web.getURL()))web.send(DISPLAY,displayState(state));});});
 const client=loadClient||(()=>import(pathToFileURL(path.join(bundle,'lib','managed-login.mjs'))));
 const emit=value=>{state={...state,...value};revision++;for(const web of contents)if(!web.isDestroyed()&&mainDocument(web.getURL()))web.send(DISPLAY,displayState(state));};
 function cancel(){abort?.abort();abort=null;pending=null;}
 function show(){return openSettings();}
 async function status(){
  if(busy)return state;if(statusPromise)return statusPromise;const started=revision;
  statusPromise=(async()=>{
   try{const result=await(await client()).loginStatus(p);if(started===revision&&!busy)emit({...result,phase:result.authenticated?'signed-in':'signed-out',restartRequired:state.restartRequired===true,message:result.expired?'登录已过期或权限已变化，请重新登录。':''});}
   catch(e){if(started===revision&&!busy)emit({phase:'error',authenticated:false,name:'',message:e.code==='SESSION_INVALID'?e.message:'暂时无法连接登录服务，请检查网络后重试。'});}
   finally{lastChecked=Date.now();statusPromise=null;}return state;
  })();return statusPromise;
 }
 async function openSettings(){
  const find=items=>{for(const item of items||[]){if(item.id==='settings'||/^(?:设置|Settings|Preferences)(?:[.…]|$)/i.test(item.label||''))return item;const nested=find(item.submenu?.items);if(nested)return nested;}};
  const item=find(Menu.getApplicationMenu()?.items);if(!item?.click)throw Error('Application settings menu unavailable');
  await item.click(item);
 }
 ipcMain.handle(DISPLAY,async(event,action,input)=>{
  if(!contents.has(event.sender)||event.senderFrame!==event.sender.mainFrame||!mainDocument(event.senderFrame?.url))throw Error('Invalid account display sender');
  if(action==='open'){await show();return displayState(state);}
  if(action==='settings'){await openSettings();return displayState(state);}
  if(action==='image-settings')return imageProvider.status(core);
  if(action==='save-image-settings'){
   if(!state.authenticated)throw Error('Login required');
   return imageProvider.save(core,input?.provider,input?.model);
  }
  if(action==='status')return displayState(state);
  if(['login','cancel','restart','logout'].includes(action)){if(['restart','logout'].includes(action)&&!state.authenticated)throw Error('Login required');return displayState(await execute(action));}
  throw Error('Invalid account display action');
 });
 ipcMain.handle(CHANNEL,async()=>{throw Error('Account settings use the main application window');});
 async function execute(action){
  if(action==='status')return busy?state:status();
  if(action==='cancel'){cancel();emit({phase:'signed-out',authenticated:false,restartRequired:false,userCode:'',message:'已取消本次登录。'});return state;}
  if(action==='restart'){app.relaunch();app.quit();return {ok:true};}
  if(busy)return state;
  busy=true;
  try{
   const api=await client();
   if(action==='logout'){
    cancel();const result=await api.logout(p);emit({phase:'signed-out',authenticated:false,restartRequired:result.restartRequired,name:'',message:result.remoteRevoked?'已退出登录。请重启应用，使已有会话采用新状态。':'已清除本机登录。服务端凭证暂未确认注销，请恢复网络后联系管理员或等待凭证到期。'});return state;
   }
   if(action!=='login')throw Error('Invalid account action');
   cancel();abort=new AbortController();const signal=abort.signal;
   pending=await api.beginLogin(COMPANY_ORIGIN,{signal});
   emit({phase:'waiting',authenticated:false,name:'',origin:pending.origin,userCode:pending.userCode,message:'请在浏览器中完成钉钉登录并确认授权。'});
   await shell.openExternal(pending.verificationUrl);
   while(!signal.aborted){
    const grant=await api.pollLogin(pending,{signal});
    if(grant){
     const result=await api.completeLogin(grant,{p,isRunning:()=>[],signal});pending=null;
     emit({phase:'signed-in',authenticated:true,name:result.name,restartRequired:true,userCode:'',message:result.image?.enabled?'登录成功，文本模型与个人生图能力已配置。请结束正在运行的任务后重启应用。':'登录成功，文本模型已加载。个人生图配置尚未就绪，请联系管理员核对。请结束正在运行的任务后重启应用。'});return state;
    }
    await new Promise((resolve,reject)=>{const listener=()=>{clearTimeout(timer);reject(Error('Cancelled'));};const timer=setTimeout(()=>{signal.removeEventListener('abort',listener);resolve();},pending.intervalMs);signal.addEventListener('abort',listener,{once:true});});
   }
   return state;
  }catch(e){if(abort?.signal.aborted||e.name==='AbortError'||e.message==='Cancelled')return state;emit({phase:'error',userCode:'',message:['SERVICE_URL_INVALID','AUTH_REQUIRED','ACCESS_DENIED','AUTH_REQUEST_EXPIRED','SERVICE_INVALID'].includes(e.code)?e.message:'登录未完成，请检查网络或重新发起登录。'});return state;}
  finally{busy=false;}
 }
 const setMenu=Menu.setApplicationMenu.bind(Menu);
 Menu.setApplicationMenu=function(menu){if(menu&&!menu.getMenuItemById('codex-own-account'))menu.append(new MenuItem({id:'codex-own-account',label:'账户',submenu:[{label:'设置…',click:openSettings}]}));return setMenu(menu);};
 app.whenReady().then(()=>{
  const menu=Menu.getApplicationMenu();if(menu)Menu.setApplicationMenu(menu);
  status();
 });
 const timer=setInterval(()=>{if(!busy)status();},15*60*1000);timer.unref();
 app.on('browser-window-focus',()=>{if(!busy&&Date.now()-lastChecked>30000)status();});
 app.on('before-quit',()=>clearInterval(timer));
 app.on('before-quit',cancel);
 return {show};
}
module.exports={CHANNEL,DISPLAY,displayState,mainDocument,start};
