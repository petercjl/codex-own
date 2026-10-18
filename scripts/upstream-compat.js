const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const OPTIONAL_BINDINGS=new Set([
 'node_modules/@worklouder/device-kit-oai/node_modules/@serialport/bindings-cpp/build/Release/bindings.node',
 'node_modules/@worklouder/device-kit-oai/node_modules/node-hid/build/Release/HID.node',
]);
function selectPlatforms(args){
 const all=['mac-arm64','mac-x64','win'],i=args.indexOf('--platform');
 if(i>=0&&!all.includes(args[i+1]))throw Error('Unknown --platform');
 const selected=i>=0?[args[i+1]]:all;
 const result=selected.filter(p=>!(args.includes('--skip-mac')&&p.startsWith('mac-'))&&!(args.includes('--skip-win')&&p==='win'));
 if(!result.length)throw Error('Conflicting platform selection');return result;
}
function findMacApplication(root){
 const apps=[];function walk(dir,depth){if(depth>4)return;for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(!e.isDirectory())continue;const p=path.join(dir,e.name);if(e.name.endsWith('.app')){if(fs.existsSync(path.join(p,'Contents/Resources/app.asar')))apps.push(p);}else walk(p,depth+1);}}
 walk(root,0);if(apps.length!==1)throw Error(`Missing or ambiguous upstream application: ${apps.length}`);return apps[0];
}
function entries(header,prefix=''){return Object.entries(header.files).flatMap(([n,e])=>e.files?entries(e,prefix+n+'/'):[[prefix+n,e]]);}
function missingUnpacked(header,archive,{allowed=OPTIONAL_BINDINGS}={}){
 const missing=entries(header).filter(([n,e])=>e.unpacked&&!fs.existsSync(archive+'.unpacked/'+n)).map(([n])=>n);
 const unknown=missing.filter(n=>!allowed.has(n));if(unknown.length)throw Error('Required upstream unpacked files missing: '+unknown.join(', '));return missing;
}
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function safePath(root,name){const file=path.resolve(root,name);if(!file.startsWith(path.resolve(root)+path.sep))throw Error('Archive entry escapes output: '+name);return file;}
function extractAsar(archive,dest){
 const asar=require('@electron/asar'),header=asar.getRawHeader(archive).header,missing=missingUnpacked(header,archive);
 fs.mkdirSync(dest,{recursive:true});
 for(const [name,e]of entries(header)){
  const file=safePath(dest,name);fs.mkdirSync(path.dirname(file),{recursive:true});
  if(e.link){const target=safePath(dest,e.link);fs.symlinkSync(path.relative(path.dirname(file),target),file);continue;}
  if(missing.includes(name))continue;
  // Official signing may change unpacked Mach-O bytes after the ASAR header
  // was produced. Their trust comes from the enclosing signed app/MSIX input.
  const data=asar.extractFile(archive,name.replaceAll('/',path.sep));if(!e.unpacked&&e.integrity?.hash&&sha(data)!==e.integrity.hash)throw Error('Source integrity mismatch '+name);
  fs.writeFileSync(file,data,{flag:'wx',mode:e.executable?0o755:0o644});
 }
 return {missingOptionalBindings:missing};
}
async function repackAsar(archive,extracted,target){
 const asar=require('@electron/asar'),header=structuredClone(asar.getRawHeader(archive).header);
 const {Pickle}=await import(pathToFileURL(path.join(path.dirname(require.resolve('@electron/asar')),'pickle.js')));
 let offset=0;const buffers=[];
 for(const [name,e]of entries(header)){
  if(e.link||e.unpacked)continue;const b=fs.readFileSync(safePath(extracted,name));e.size=b.length;e.offset=String(offset);offset+=b.length;
  const blockSize=4194304,blocks=[];for(let i=0;i<b.length;i+=blockSize)blocks.push(sha(b.subarray(i,i+blockSize)));
  e.integrity={algorithm:'SHA256',hash:sha(b),blockSize,blocks};buffers.push(b);
 }
 const hp=new Pickle();hp.writeString(JSON.stringify(header));const hb=hp.toBuffer(),sp=new Pickle();sp.writeUInt32(hb.length);
 if(archive!==target&&fs.existsSync(archive+'.unpacked')&&!fs.existsSync(target+'.unpacked'))fs.cpSync(archive+'.unpacked',target+'.unpacked',{recursive:true,force:false,errorOnExist:true});
 fs.writeFileSync(target,Buffer.concat([sp.toBuffer(),hb,...buffers]));asar.uncache(target);return sha(Buffer.from(JSON.stringify(header)));
}
function patchWindowsIntegrity(root,before,after){
 const candidates=fs.readdirSync(root).filter(n=>n.endsWith('.exe')).map(n=>path.join(root,n));
 const matches=[];for(const file of candidates){const b=fs.readFileSync(file),needle=Buffer.from(before);let at=b.indexOf(needle);while(at>=0){matches.push({file,b,at});at=b.indexOf(needle,at+1);}}
 if(matches.length!==1)throw Error('Windows ASAR integrity target missing or ambiguous: '+matches.length);
 const {file,b,at}=matches[0];Buffer.from(after).copy(b,at);fs.writeFileSync(file,b);return file;
}
function patchMacFramework(app,headerHash){
 const file=fs.realpathSync(path.join(app,'Contents/Frameworks/Codex Framework.framework/Codex Framework'));
 const b=fs.readFileSync(file),marker=Buffer.from('AGbevlPCksUGKNL8TSn7wGmJEuJsXb2A'),i=b.indexOf(marker);
 if(i<0||b.lastIndexOf(marker)!==i||b[i+32]!==1||b[i+33]!==1)throw Error('Unknown framework integrity contract');
 crypto.createHash('sha256').update('Resources/app.asarSHA256'+headerHash).digest().copy(b,i+34);fs.writeFileSync(file,b);
}
module.exports={selectPlatforms,findMacApplication,missingUnpacked,extractAsar,repackAsar,patchWindowsIntegrity,patchMacFramework};
