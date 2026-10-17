import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

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
export function extractChecked(archive,dest,{tar,attempts=3,report=()=>{},execute=execFileSync,delay=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)}={}){
 if(!Number.isInteger(attempts)||attempts<1||attempts>3)throw error('INVALID_ARGUMENT','Extraction attempts must be 1..3');
 const cwd=path.dirname(path.resolve(archive)),source=path.basename(archive),root=path.resolve(dest),target=path.relative(cwd,root);
 const names=archiveNames(execute(tar,['-tf',source],{cwd,encoding:'utf8',maxBuffer:64*1024*1024}));
 fs.mkdirSync(root);let missing=names,lastError;
 const absent=()=>names.filter(n=>{try{const s=fs.lstatSync(path.join(root,n));return n.endsWith('/')?!s.isDirectory():!s.isFile()&&!s.isSymbolicLink();}catch(e){if(['ENOENT','ENOTDIR'].includes(e.code))return true;throw e;}});
 for(let attempt=1;attempt<=attempts;attempt++){
  // A previous partial extraction must not provide an escaping link for retry.
  inspectTree(root);
  try{
   if(attempt===1||!missing.length||missing.length>32)execute(tar,['-xf',source,'-C',target],{cwd,stdio:'pipe'});
   else{
    // One entry at a time also keeps Windows argv bounded for long inventories.
    for(const n of missing)execute(tar,['-xf',source,'-C',target,'--',n],{cwd,stdio:'pipe'});
   }
   lastError=null;
  }catch(e){lastError=e;}
  inspectTree(root);missing=absent();
  if(!missing.length&&!lastError)return {entries:names.length,attempts:attempt};
  if(attempt<attempts){report(`解压验证未完成：缺少 ${missing.length} 项，重试 ${attempt}/${attempts-1}`);delay(attempt*500);}
 }
 throw error(missing.length?'UNPACK_INCOMPLETE':'UNPACK_FAILED',`解压验证失败，缺少 ${missing.length} 项；可能被占用或被安全软件拦截。示例：${missing.slice(0,5).join(', ')||'tar 未正常退出'}`,{missing:missing.slice(0,30),missingCount:missing.length,stage:root,tarExit:lastError?.status??null});
}
