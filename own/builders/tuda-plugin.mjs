import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {createRequire} from 'node:module';
// Builder-local dependency copying is supplied by the host's existing packager.
import contract from '../lib/tuda-contract.cjs';
export const verifyTudaContract=contract.verifyTudaContract;
export function treeIdentity(root){
 const stat=fs.lstatSync(root);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Tuda input must be a physical directory');
 const realRoot=fs.realpathSync(root);
 const hash=crypto.createHash('sha256');let bytes=0,files=0;
 function walk(directory){for(const name of fs.readdirSync(directory).sort()){
  const file=path.join(directory,name),relative=path.relative(root,file).replaceAll(path.sep,'/'),s=fs.lstatSync(file);
  if(s.isSymbolicLink()){
   const link=fs.readlinkSync(file),resolved=path.resolve(path.dirname(file),link);
   if(path.isAbsolute(link)||!resolved.startsWith(path.resolve(root)+path.sep)||!fs.realpathSync(file).startsWith(realRoot+path.sep))throw Error('Tuda artifact contains an external link');
   hash.update(JSON.stringify(['link',relative,link])+'\n');
  }else if(s.isDirectory())walk(file);
  else if(s.isFile()){
   const digest=crypto.createHash('sha256'),fd=fs.openSync(file,'r'),buffer=Buffer.alloc(4*1024*1024);try{let n;while((n=fs.readSync(fd,buffer,0,buffer.length,null)))digest.update(buffer.subarray(0,n));}finally{fs.closeSync(fd);}
   hash.update(JSON.stringify(['file',relative,s.mode&0o111,s.size,digest.digest('hex')])+'\n');bytes+=s.size;files++;
  }else throw Error('Tuda artifact contains an unsupported entry');
 }}walk(root);return {sha256:hash.digest('hex'),bytes,files};
}
function installedPackageRoot(){const resolver=createRequire(import.meta.url);return (resolver.resolve.paths('@petercjl/tuda')||[]).map(dir=>path.join(dir,'@petercjl/tuda')).find(dir=>fs.existsSync(path.join(dir,'package.json')));}
export function bundleTuda(dest,{copyDependencies,packageRoot=process.env.OWN_TUDA_PACKAGE_ROOT||installedPackageRoot(),inputsFile=new URL('../defaults/tuda-inputs.json',import.meta.url),platform=process.platform}={}){
 if(!packageRoot)throw Error('Tuda plugin requires OWN_TUDA_PACKAGE_ROOT');
 const inputs=JSON.parse(fs.readFileSync(inputsFile,'utf8')),expected=inputs.platforms?.[platform+'-'+process.arch];
 if(inputs.contract!==2||!expected)throw Error('No accepted Tuda plugin identity for this platform');
 const meta=JSON.parse(fs.readFileSync(path.join(packageRoot,'package.json'),'utf8'));
 if(meta.name!=='@petercjl/tuda'||meta.version!==inputs.version)throw Error('Tuda package identity mismatch');
 const contracts=verifyTudaContract(packageRoot),pkg=treeIdentity(packageRoot);
 if(pkg.sha256!==expected.packageSha256)throw Error('Tuda input checksum mismatch');
 // This boundary accepts a self-contained connector package, never an Electron tree.
 function check(dir){for(const name of fs.readdirSync(dir)){const file=path.join(dir,name);if(/\.app$|^Tuda\.exe$|^tuda-desktop$/i.test(name))throw Error('Tuda desktop is not a plugin input');if(fs.lstatSync(file).isDirectory())check(file);}}check(packageRoot);
 const dependencies=copyDependencies(['@petercjl/tuda'],createRequire(path.join(packageRoot,'package.json')),dest);
 fs.writeFileSync(path.join(dest,'tuda-plugin.json'),JSON.stringify({contract:2,package:meta.name,version:meta.version,profile:'board-only',connection:'independent-existing',contracts,inputs:{package:pkg}}),{flag:'wx'});
 return {version:meta.version,dependencies,desktopBytes:0,connection:'independent-existing'};
}
