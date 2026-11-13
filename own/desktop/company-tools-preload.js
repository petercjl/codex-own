;(()=>{
 const {contextBridge,ipcRenderer}=require('electron'),channel='codex-own:company-tools:v1';
 if(globalThis.location?.protocol!=='app:'||location.host!=='-'||location.pathname!=='/index.html'||window!==window.top)return;
 contextBridge.exposeInMainWorld('codexOwnCompanyTools',Object.freeze({
  read:()=>ipcRenderer.invoke(channel,'read'),check:()=>ipcRenderer.invoke(channel,'check'),update:()=>ipcRenderer.invoke(channel,'update'),
  setAutoUpdate:enabled=>ipcRenderer.invoke(channel,'auto-update',{enabled}),refresh:()=>ipcRenderer.invoke(channel,'refresh'),
  subscribe:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on(channel,listener);return()=>ipcRenderer.removeListener(channel,listener);}
 }));
})();
