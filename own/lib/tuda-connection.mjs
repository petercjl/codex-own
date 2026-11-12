// Host connection policy; board operations and authentication remain Tuda-owned.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import contract from './tuda-contract.cjs';import {rejectLinks} from './manager.mjs';
export function connectionOptions(root,{platform=process.platform,home=os.homedir(),env=process.env}={}){
 const file=path.join(root,'tuda-connection.json');rejectLinks(file);
 const standard=platform==='darwin'?path.join(home,'Library/Application Support/Tuda'):platform==='win32'?path.join(env.APPDATA||home,'Tuda'):path.join(env.XDG_CONFIG_HOME||path.join(home,'.config'),'Tuda');
 if(!fs.existsSync(file))return {userDataPath:standard};
 const s=fs.lstatSync(file);if(!s.isFile()||s.size>4096||(platform!=='win32'&&(s.mode&0o077)))throw Error('TUDA_CONNECTION_CONFIG_INVALID');
 let v;try{v=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw Error('TUDA_CONNECTION_CONFIG_INVALID');}
 if(v.contract!==1||Object.keys(v).some(k=>!['contract','userDataPath'].includes(k))||typeof v.userDataPath!=='string'||!path.isAbsolute(v.userDataPath))throw Error('TUDA_CONNECTION_CONFIG_INVALID');
 rejectLinks(v.userDataPath);return {userDataPath:v.userDataPath};
}
export function verifyIndependentReady(value,packageRoot){
 if(value?.schemaVersion!==1||value.ok!==true||value.data?.ready!==true||value.data.protocolVersion!==1||! /^[a-f0-9]{64}$/.test(value.data.instanceId))throw Error('TUDA_DESKTOP_INCOMPATIBLE');
 const caps=JSON.parse(fs.readFileSync(path.join(packageRoot,'capabilities.json'),'utf8'));
 // Both the package and the live desktop must attest
 // isolated plugin authorization. Legacy handoff replaces the desktop session.
 const declared=caps.nativePlugin?.sharedDesktopSession,live=value.data.boardPlugin;
 if(declared?.contract!==1||declared.authScope!=='connection'||declared.preservesDesktopSession!==true||live?.contract!==1||live.authScope!=='connection'||live.preservesDesktopSession!==true)throw Error('TUDA_SHARED_AUTH_UNSUPPORTED');
 if(!/^\d+\.\d+\.\d+$/.test(value.data.desktopVersion||''))throw Error('TUDA_DESKTOP_INCOMPATIBLE');
 try{contract.verifyTudaContract(packageRoot,{desktopVersion:value.data.desktopVersion});}catch{throw Error('TUDA_DESKTOP_INCOMPATIBLE');}
 return value.data.instanceId;
}
export function connectionError(error){
 const code=error?.message;
 const messages={
 TUDA_INDEPENDENT_UNAVAILABLE:'请安装或打开独立 Tuda，并升级到支持 codex-own 连接的版本；开发联调请配置现有 Dev 的数据目录。当前连接只连接已运行实例。',
 TUDA_DESKTOP_INCOMPATIBLE:'请升级独立 Tuda 和连接插件；当前桌面的协议、实际版本或能力与插件不兼容。',
 TUDA_SHARED_AUTH_UNSUPPORTED:'请升级独立 Tuda 和连接插件，使其支持独立的插件授权会话。当前版本的交接会替换桌面账号，连接已在签发授权前停止。',
 TUDA_CONNECTION_CONFIG_INVALID:'请检查私有 tuda-connection.json：contract=1、绝对 userDataPath 路径及仅当前用户可读的权限。',
 TUDA_CAPABILITY_DENIED:'此操作超出 Tuda board-only 工具范围。',
 TUDA_HOST_LOGIN_REQUIRED:'请先登录 codex-own 公司账号，画板连接会自动取得专用授权，无需在 Tuda 重复登录。',
 TUDA_HOST_LOGIN_CHANGED:'请登录 codex-own 公司账号，并在账号变更后重启画板连接。'
 };
 return Object.hasOwn(messages,code)?code+': '+messages[code]:'TUDA_CONNECTION_FAILED: 请检查 codex-own 公司登录及授权服务，并重启画板连接。';
}
