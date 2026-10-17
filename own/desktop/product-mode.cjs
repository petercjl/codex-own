'use strict';
const fs=require('node:fs'),path=require('node:path');
const CHANNEL='codex-own:product-policy:v1';
function apiMode(core){
  try{
    const auth=JSON.parse(fs.readFileSync(path.join(core,'auth.json'),'utf8'));
    return auth.auth_mode==='apikey'||(typeof auth.OPENAI_API_KEY==='string'&&auth.OPENAI_API_KEY.trim().length>0);
  }catch{return false;}
}
// Expose the access mode only. Credentials never cross into the webview.
function install({ipcMain},core){
  ipcMain.on(CHANNEL,event=>{event.returnValue={contract:1,apiMode:apiMode(core)};});
}
module.exports={CHANNEL,apiMode,install};
