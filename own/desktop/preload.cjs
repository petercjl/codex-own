'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('codexOwnUpdates',{
  action:action=>ipcRenderer.invoke('codex-own:update',action),
  listen:callback=>{ipcRenderer.on('codex-own:update-state',(_event,state)=>callback(state));},
});
