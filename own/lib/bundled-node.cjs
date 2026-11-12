'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const invalid=message=>Object.assign(Error(message),{code:'BUNDLED_NODE_INVALID'});
const name=platform=>platform==='win32'?'node.exe':'node';
function regular(file){const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink())throw invalid('Bundled Node must be a regular file');return s;}
function resolveBundledNode(bundle,platform=process.platform){
 const local=path.join(bundle,name(platform)),receipt=path.join(bundle,'node-runtime.json');
 // Historical bundles and standalone installer engines keep this entry.
 if(!fs.existsSync(receipt))return local;
 regular(receipt);const meta=JSON.parse(fs.readFileSync(receipt,'utf8'));
 const relative='../cua_node/bin/'+name(platform);
 if(meta.schema!==1||meta.source!=='application-cua-node'||meta.binary!==relative||!/^\d+\.\d+\.\d+$/.test(meta.version)||Number(meta.version.split('.')[0])<22)throw invalid('Unsupported bundled Node reference');
 // An update handoff materializes a private copy before the old app exits.
 if(fs.existsSync(local)){regular(local);return local;}
 const resources=path.dirname(path.resolve(bundle)),target=path.resolve(bundle,relative);
 let current=resources;for(const part of path.relative(resources,target).split(path.sep)){current=path.join(current,part);if(fs.lstatSync(current).isSymbolicLink())throw invalid('Bundled Node reference contains a link');}
 regular(target);return target;
}
function digest(file){const fd=fs.openSync(file,'r'),hash=crypto.createHash('sha256'),buffer=Buffer.alloc(4*1024*1024);try{let bytes;while((bytes=fs.readSync(fd,buffer,0,buffer.length,null)))hash.update(buffer.subarray(0,bytes));return hash.digest('hex');}finally{fs.closeSync(fd);}}
function materializeBundledNode(bundle,destination,platform=process.platform){
 const dir=fs.lstatSync(destination);if(!dir.isDirectory()||dir.isSymbolicLink())throw invalid('Expected a new handoff runtime directory');
 const source=resolveBundledNode(bundle,platform),target=path.join(destination,name(platform));regular(source);
 if(!fs.existsSync(target))fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);
 regular(target);if(digest(source)!==digest(target))throw invalid('Handoff Node differs from the bundled runtime');return target;
}
module.exports={resolveBundledNode,materializeBundledNode};
