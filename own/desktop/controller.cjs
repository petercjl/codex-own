'use strict';
const fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process');
const {StringDecoder}=require('node:string_decoder');
const CHANNEL='codex-own:update';
module.exports.start=function({app,BrowserWindow,Menu,MenuItem,ipcMain,dialog},root){
  const bundle=path.join(process.resourcesPath,'own-updater');
  const meta=JSON.parse(fs.readFileSync(path.join(bundle,'desktop-version.json'),'utf8'));
  let state={phase:'idle',current:meta.version,updateAvailable:false},window=null,busy=false,receipt=null,announced=null,downloadWorker=null,quitRequested=false;
  const env={...process.env};for(const k of Object.keys(env))if(/^(NODE_OPTIONS|NODE_PATH|ELECTRON_|CODEX_|OPENAI_|CHATGPT_)/.test(k))delete env[k];
  const notice=()=>receipt?'✓':state.updateAvailable?'↓':'';
  const menuLabel=()=>`更新${notice()?' '+notice():''}`;
  const badges=new WeakMap();let lastNotice='';
  function syncBadge(contents){
    // Windows draws its own menu bar. Style its stable owned menu ID without
    // exposing updater IPC to the application renderer or changing React state.
    if(process.platform!=='win32'||!contents.insertCSS)return;
    const previous=badges.get(contents)||Promise.resolve(null),mark=notice();
    const next=previous.catch(()=>null).then(async key=>{
      if(contents.isDestroyed())return null;
      if(key)await contents.removeInsertedCSS(key).catch(()=>{});
      if(!mark)return null;
      return contents.insertCSS(`#application-menu-trigger-codex-own-updates::after { content: " ${mark}"; color: var(--color-text, currentColor); font-weight: 700; }`);
    }).catch(()=>null);
    badges.set(contents,next);
  }
  function syncNotice(){
    const menu=Menu.getApplicationMenu(),item=menu?.getMenuItemById('codex-own-updates');
    if(item)item.label=menuLabel();
    for(const w of BrowserWindow.getAllWindows?.()||[])if(!w.isDestroyed())syncBadge(w.webContents);
  }
  const emit=patch=>{state={...state,...patch};if(notice()!==lastNotice){lastNotice=notice();syncNotice();}if(window&&!window.isDestroyed())window.webContents.send('codex-own:update-state',state);};
  const errors={APP_RUNNING:'应用尚未完全退出，安装已取消。请结束任务后重试。',UNMANAGED_TARGET:'当前 App 尚未由 codex-own 安装器管理，请先完成一次命令行安装。',BUSY:'另一项安装或更新正在运行，请稍后重试。',CHECKSUM_MISMATCH:'下载文件校验失败，当前版本保持不变，请重试。',INSTALLATION_CHANGED:'安装版本已经改变，请重新检查更新。'};
  function run(action){return new Promise((resolve,reject)=>{
    const child=spawn(path.join(bundle,process.platform==='win32'?'node.exe':'node'),[path.join(bundle,'desktop','worker.mjs'),action,meta.version],{env,cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
    if(action==='download')downloadWorker=child;
    let output='',error,result,settled=false;const decoder=new StringDecoder('utf8');
    child.stdout.on('data',b=>{output+=decoder.write(b);for(;;){const i=output.indexOf('\n');if(i<0)break;const line=output.slice(0,i);output=output.slice(i+1);let m;try{m=JSON.parse(line);}catch{continue;}
      if(m.progress)emit({message:m.progress});if(m.error)error=m.error;if(m.result)result=m.result;
    }});
    child.stderr.on('data',()=>{});
    child.on('error',e=>{if(downloadWorker===child)downloadWorker=null;if(!settled){settled=true;reject(e);}});
    child.on('exit',code=>{if(downloadWorker===child)downloadWorker=null;if(settled)return;
      settled=true;if(error||code!==0||!result)reject(Object.assign(Error('Update worker failed'),error||{code:'WORKER_FAILED'}));else resolve(result);
    });
  });}
  function show(){
    if(window&&!window.isDestroyed()){window.show();window.focus();return;}
    window=new BrowserWindow({width:590,height:440,title:'codex-own 更新',icon:path.join(process.resourcesPath,'codex-own.png'),resizable:false,autoHideMenuBar:true,webPreferences:{preload:path.join(bundle,'desktop','preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',e=>e.preventDefault());
    window.loadFile(path.join(bundle,'desktop','update.html'));window.on('closed',()=>{window=null;});
  }
  async function action(kind,manual=false){
    if(kind==='state')return state;
    if(busy)return state;
    if(kind==='install'){
      if(!receipt||state.phase!=='ready')return state;
      const answer=await dialog.showMessageBox(window||undefined,{type:'question',title:'安装 codex-own 更新',message:'结束当前任务并重启安装更新？',detail:'请确认正在运行的任务已结束。配置和对话会保留，安装前会创建备份。',buttons:['取消','重启并安装'],defaultId:0,cancelId:0});
      if(answer.response!==1)return state;
      busy=true;emit({phase:'installing',message:'等待应用退出后，更新程序将替换并重新打开 codex-own。'});
      try{
        // Windows cannot replace a running helper inside the installation directory.
        const base=path.join(root,'manager','handoffs');fs.mkdirSync(base,{recursive:true,mode:0o700});
        const handoff=fs.mkdtempSync(path.join(base,'apply-'));fs.cpSync(bundle,path.join(handoff,'runtime'),{recursive:true,force:false,errorOnExist:true});
        const runtime=path.join(handoff,'runtime'),log=fs.openSync(path.join(handoff,'install.log'),'wx',0o600);
        let child;
        try{child=spawn(path.join(runtime,process.platform==='win32'?'node.exe':'node'),[path.join(runtime,'desktop','worker.mjs'),'apply',meta.version,receipt],{env,cwd:root,windowsHide:true,detached:true,stdio:['ignore',log,log]});}finally{fs.closeSync(log);}
        let spawnError;child.on('error',e=>{spawnError=e;});child.unref();
        child.on('exit',()=>{busy=false;emit({phase:'ready',message:'应用未完成退出或安装未完成，请结束任务后重试。安装记录已保存在独立更新目录。'});});
        const ready=path.join(runtime,'handoff-ready.json'),deadline=Date.now()+15000;
        while(!fs.existsSync(ready)){if(spawnError)throw spawnError;if(child.exitCode!==null||Date.now()>deadline)throw Error('Update helper did not start');await new Promise(r=>setTimeout(r,100));}
        app.quit();
      }catch(e){emit({phase:'ready',message:errors[e.code]||'无法启动更新程序，请重试。'});busy=false;}
      return state;
    }
    if(!['check','download'].includes(kind))return state;
    if(kind==='check'&&receipt){if(manual)show();return state;}
    busy=true;emit({phase:kind==='check'?'checking':'downloading',message:''});
    try{
      const result=await run(kind);
      if(result.receipt)receipt=result.receipt;
      emit({...result,phase:receipt?'ready':result.updateAvailable?'available':'current',message:''});
      if(manual||(result.updateAvailable&&announced!==result.available)){announced=result.available;show();}
    }catch(e){emit({phase:'error',message:errors[e.code]||'无法完成更新，请检查网络连接后重试。'});if(manual)show();}
    finally{busy=false;if(quitRequested){quitRequested=false;app.quit();}}
    return state;
  }
  ipcMain.handle(CHANNEL,(event,kind)=>{
    if(!window||window.isDestroyed()||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||!['state','check','download','install'].includes(kind))throw Error('Forbidden update request');
    return action(kind,true);
  });
  app.on('before-quit',event=>{
    if(downloadWorker){event.preventDefault();quitRequested=true;emit({message:'正在取消下载并退出，已校验分片会保留。'});if(downloadWorker.connected)downloadWorker.send({cancel:true},()=>{});}
  });
  const original=Menu.setApplicationMenu.bind(Menu);
  Menu.setApplicationMenu=menu=>{
    if(menu&&!menu.getMenuItemById('codex-own-updates'))menu.append(new MenuItem({id:'codex-own-updates',label:menuLabel(),submenu:[{label:'检查 codex-own 更新…',click:()=>{show();void action('check',true);}}]}));
    const item=menu?.getMenuItemById('codex-own-updates');if(item)item.label=menuLabel();
    return original(menu);
  };
  app.on('browser-window-created',(_event,w)=>{
    w.webContents.on('did-finish-load',()=>syncBadge(w.webContents));
  });
  app.whenReady().then(()=>{
    const menu=Menu.getApplicationMenu();Menu.setApplicationMenu(menu||new Menu());
    const timer=setTimeout(()=>{void action('check');},15000);timer.unref();
    const interval=setInterval(()=>{if(!receipt)void action('check');},6*60*60*1000);interval.unref();
  });
  return {show,action,getState:()=>state};
};
