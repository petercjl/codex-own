import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {list} from 'tar';
import AdmZip from 'adm-zip';

const unsafe=message=>Object.assign(new Error(message),{code:'UNSAFE_ARCHIVE'});
const digest=data=>crypto.createHash('sha256').update(data).digest('hex');
export function validateArchiveName(name){
 if(typeof name!=='string'||!name||/^[a-zA-Z]:|^\/|^\\|[\0\r\n]/.test(name)||name.replaceAll('\\','/').split('/').includes('..'))throw unsafe('Unsafe archive entry');
}
// Parse archive bytes rather than Windows tar's locale-dependent console text.
// Inventory hashes also detect truncated or silently modified extracted files.
export function archiveInventory(file){
 const fd=fs.openSync(file,'r'),magic=Buffer.alloc(4);try{fs.readSync(fd,magic,0,4,0);}finally{fs.closeSync(fd);}
 const result=[];let total=0;
 function add(entry){validateArchiveName(entry.name);if(!Number.isSafeInteger(entry.size)||entry.size<0||entry.size>8*1024**3||result.length>=200000||(total+=entry.size)>32*1024**3)throw unsafe('Excessive archive inventory');result.push(entry);return entry;}
 if(magic.readUInt32LE(0)===0x04034b50||magic.readUInt32LE(0)===0x06054b50){
  if(fs.statSync(file).size>128*1024**2)throw unsafe('Runtime ZIP exceeds supported size');
  for(const e of new AdmZip(file).getEntries()){
   const link=((e.header.attr>>>16)&0xf000)===0xa000,type=e.isDirectory?'Directory':link?'SymbolicLink':'File';
   const item=add({name:e.entryName,type,size:e.header.size});
   if(type==='File')item.sha256=digest(e.getData());else if(link)item.link=e.getData().toString('utf8');
  }
 }else{
  list({file,sync:true,strict:true,preservePaths:true,onReadEntry:e=>{
   if(['ExtendedHeader','GlobalExtendedHeader','NextFileHasLongPath','NextFileHasLongLinkpath'].includes(e.type))return;
   if(!['File','OldFile','ContiguousFile','Directory','SymbolicLink','Link'].includes(e.type))throw unsafe('Unsupported archive entry type');
   const item=add({name:e.path,type:e.type,size:e.size,link:e.linkpath});
   if(['File','OldFile','ContiguousFile'].includes(e.type)){const hash=crypto.createHash('sha256');e.on('data',b=>hash.update(b));e.on('end',()=>{item.sha256=hash.digest('hex');});}
  }});
 }
 if(!result.length)throw unsafe('Empty archive');
 for(const e of result){if(['File','OldFile','ContiguousFile'].includes(e.type)&&!e.sha256)throw unsafe('Incomplete archive content');if(e.link){if(/^[a-zA-Z]:|^\/|^\\|[\0\r\n]/.test(e.link))throw unsafe('Unsafe archive link');const base=e.type==='Link'?'':path.posix.dirname(e.name.replaceAll('\\','/'));const normalized=path.posix.normalize(path.posix.join(base,e.link.replaceAll('\\','/')));if(normalized==='..'||normalized.startsWith('../'))throw unsafe('Escaping archive link');}}
 return result;
}
export function extractedHash(file){
 const hash=crypto.createHash('sha256'),buffer=Buffer.allocUnsafe(256*1024),fd=fs.openSync(file,'r');
 try{let count;while((count=fs.readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,count));return hash.digest('hex');}finally{fs.closeSync(fd);}
}
