import fs from 'node:fs';
import path from 'node:path';

// Reserve a new directory atomically, then copy its children. This avoids the
// Windows Node 24.22 strict cp(existing empty directory) incompatibility while
// still refusing an existing destination and every existing child.
export function copyNewDirectory(source,target,{onCreate=()=>{},copy=fs.cpSync}={}){
 fs.mkdirSync(target);
 try{onCreate();for(const name of fs.readdirSync(source))copy(path.join(source,name),path.join(target,name),{recursive:true,force:false,errorOnExist:true,dereference:false,verbatimSymlinks:true});}
 catch(e){try{removeNewTreeSync(target);}catch{e.partialTarget=target;}throw e;}
}
// Do not invoke native recursive rmSync: older Windows runtimes can terminate
// the process on sharing violations instead of returning a JavaScript error.
export function removeNewTreeSync(file){
 const st=fs.lstatSync(file);
 if(st.isDirectory()&&!st.isSymbolicLink()){for(const n of fs.readdirSync(file))removeNewTreeSync(path.join(file,n));fs.rmdirSync(file);}
 else fs.unlinkSync(file);
}
export async function removeTemporary(file,{report=()=>{}}={}){
 try{await fs.promises.rm(file,{recursive:true,force:true,maxRetries:3,retryDelay:200});return true;}
 catch(e){report(`临时目录被占用，保留供 repair 检查：${file}`);return false;}
}
