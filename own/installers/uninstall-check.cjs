'use strict';
// The Windows uninstaller removes only the managed program and shortcuts.
// Configuration, credentials, chats, tools and rollback data remain intact.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
try{
 const target=path.join(process.env.LOCALAPPDATA,'Programs','codex-own','current');
 let p=target;while(true){if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())throw Error('Linked installation refused');const parent=path.dirname(p);if(parent===p)break;p=parent;}
 if(JSON.parse(fs.readFileSync(path.join(target,'codex-own-build.json'))).identity!=='local.codex-own')throw Error('Unmanaged installation refused');
 const active=cp.execFileSync('powershell.exe',['-NoProfile','-Command',"@(Get-Process -Name 'codex-own' -ErrorAction SilentlyContinue).Count"],{encoding:'utf8',windowsHide:true}).trim();
 if(active!=='0')throw Error('Quit codex-own before uninstalling');
 console.log('Managed program can be removed; private data will be retained.');
}catch{console.error('请完全退出 codex-own 后重试；未知安装保持不变。');process.exitCode=1;}
