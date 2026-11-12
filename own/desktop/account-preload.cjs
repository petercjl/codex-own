'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const CHANNEL='codex-own:account:v1';
contextBridge.exposeInMainWorld('codexOwnAccount',{
 action:(action,input)=>ipcRenderer.invoke(CHANNEL,action,input),
 listen:callback=>ipcRenderer.on(CHANNEL,(_event,value)=>callback(value)),
});
