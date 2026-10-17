import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {archiveInventory,validateArchiveName,extractedHash} from './archive-inventory.mjs';

const error=(code,message,extra={})=>Object.assign(new Error(message),{code,...extra});
export function archiveNames(text){
 const names=text.split('\n').map(n=>n.replace(/\r$/,'')).filter(Boolean);
 if(!names.length||names.length>200000)throw error('UNSAFE_ARCHIVE','Empty or excessive archive inventory');
 for(const n of names){const normalized=n.replaceAll('\\','/');if(/^[a-zA-Z]:|^\/|^\\|[\0\r\n]/.test(n)||normalized.split('/').includes('..'))throw error('UNSAFE_ARCHIVE','Unsafe archive entry');}
 return [...new Set(names)];
}
function inspectTree(root){
 function walk(dir){for(const x of fs.readdirSync(dir,{withFileTypes:true})){
  const f=path.join(dir,x.name),s=fs.lstatSync(f);
  if(s.isSymbolicLink()){const link=fs.readlinkSync(f),resolved=path.resolve(path.dirname(f),link);if(path.isAbsolute(link)||!resolved.startsWith(root+path.sep))throw error('UNSAFE_ARCHIVE','Escaping archive symlink');}
  else if(s.isDirectory())walk(f);else if(!s.isFile())throw error('UNSAFE_ARCHIVE','Unsupported archive file type');
 }}walk(root);
}
export function extractChecked(archive,dest,{tar,attempts=3,report=()=>{},inventory=archiveInventory,execute=execFileSync,delay=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)}={}){
 if(!Number.isInteger(attempts)||attempts<1||attempts>3)throw error('INVALID_ARGUMENT','Extraction attempts must be 1..3');
 const cwd=path.dirname(path.resolve(archive)),source=path.basename(archive),root=path.resolve(dest),target=path.relative(cwd,root);
 const entries=inventory(archive);for(const e of entries)validateArchiveName(e.name);const names=entries.map(e=>e.name);
 fs.mkdirSync(root);let missing=names,lastError;
 const absent=()=>entries.filter(e=>{try{const file=path.join(root,e.name),s=fs.lstatSync(file);if(e.type==='Directory')return !s.isDirectory();if(e.type==='SymbolicLink')return !s.isSymbolicLink()||e.link!==undefined&&fs.readlinkSync(file)!==e.link;if(!s.isFile())return true;return e.size!==undefined&&e.type!=='Link'&&s.size!==e.size||!!e.sha256&&extractedHash(file)!==e.sha256;}catch(e){if(['ENOENT','ENOTDIR','EPERM','EBUSY','EACCES'].includes(e.code))return true;throw e;}}).map(e=>e.name);
 for(let attempt=1;attempt<=attempts;attempt++){
  // A previous partial extraction must not provide an escaping link for retry.
  inspectTree(root);
  try{
   if(attempt===1||!missing.length||missing.length>32||missing.some(n=>/[^\x20-\x7e]/.test(n)))execute(tar,['-xf',source,'-C',target],{cwd,stdio:'pipe'});
   else{
    // One entry at a time also keeps Windows argv bounded for long inventories.
    for(const n of missing)execute(tar,['-xf',source,'-C',target,'--',n],{cwd,stdio:'pipe'});
   }
   lastError=null;
  }catch(e){lastError=e;}
  inspectTree(root);report('正在核对解压文件大小与内容校验和');missing=absent();
  if(!missing.length&&!lastError)return {entries:names.length,attempts:attempt};
  if(attempt<attempts){report(`解压验证未完成：${missing.length} 项缺失或内容不符，重试 ${attempt}/${attempts-1}`);delay(attempt*500);}
 }
 throw error(missing.length?'UNPACK_INCOMPLETE':'UNPACK_FAILED',`解压验证失败，${missing.length} 项缺失或内容不符；可能被占用或被安全软件拦截。示例：${missing.slice(0,5).join(', ')||'tar 未正常退出'}`,{missing:missing.slice(0,30),missingCount:missing.length,stage:root,tarExit:lastError?.status??null});
}
