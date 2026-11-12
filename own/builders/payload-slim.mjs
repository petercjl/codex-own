import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),acorn=require('acorn');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function walk(node,visit){if(!node||typeof node!=='object')return;visit(node);for(const v of Object.values(node))if(Array.isArray(v))v.forEach(n=>walk(n,visit));else if(v&&typeof v==='object')walk(v,visit);}
const literal=n=>n?.type==='Literal'?n.value:n?.type==='TemplateLiteral'&&!n.expressions.length?n.quasis[0].value.cooked:undefined;
const parse=s=>acorn.parse(s,{ecmaVersion:'latest',sourceType:'module'});
const marker='/* codex-own optional presentation */';

// Only file-backed sections and non-signature load commands participate. Signing
// changes LINKEDIT sizes and LC_CODE_SIGNATURE, but must never change code/data.
function machoIdentity(b){
 if(b.length<32||b.readUInt32LE(0)!==0xfeedfacf)throw Error('Expected thin 64-bit Mach-O');
 const parts=[b.subarray(4,16),b.subarray(24,28)];let p=32,code=false;
 for(let i=0;i<b.readUInt32LE(16);i++){
  const cmd=b.readUInt32LE(p),length=b.readUInt32LE(p+4);if(length<8||p+length>b.length)throw Error('Invalid Mach-O command');
  if(cmd===0x19){
   const count=b.readUInt32LE(p+64);if(72+count*80>length)throw Error('Invalid Mach-O sections');
   for(let j=0;j<count;j++){
    const q=p+72+j*80,name=b.subarray(q,q+32),size=Number(b.readBigUInt64LE(q+40)),offset=b.readUInt32LE(q+48),type=b.readUInt32LE(q+64)&255;
    parts.push(name,b.subarray(q+32,q+48),b.subarray(q+64,q+68));
    if(name.subarray(0,16).toString().replaceAll('\0','')==='__text')code=true;
    if(![1,12,18].includes(type)){if(offset+size>b.length)throw Error('Invalid Mach-O section range');parts.push(b.subarray(offset,offset+size));}
   }
  }else if(cmd!==0x1d)parts.push(b.subarray(p,p+length));
  p+=length;
 }
 if(!code)throw Error('Mach-O executable text missing');return sha(Buffer.concat(parts));
}
function regular(root,relative){
 let p=root;for(const part of relative.split('/')){p=path.join(p,part);const s=fs.lstatSync(p);if(s.isSymbolicLink())throw Error('Unexpected resource link: '+relative);}
 if(!fs.statSync(p).isFile())throw Error('Expected regular resource: '+relative);return p;
}
export function slimMacPayload(resources){
 const links=[],root=path.join(resources,'codex'),nested='codex-cli/CodexCLI.app/Contents/MacOS/codex';
 if(fs.existsSync(root)&&!fs.lstatSync(root).isSymbolicLink()&&fs.existsSync(path.join(resources,nested))){
  const a=regular(resources,'codex'),b=regular(resources,nested);
  if(machoIdentity(fs.readFileSync(a))!==machoIdentity(fs.readFileSync(b)))throw Error('Duplicated CLI executables have different runtime contents');
  const bytes=fs.statSync(a).size;fs.unlinkSync(a);fs.symlinkSync(nested,a);links.push({path:'codex',target:nested,savedBytes:bytes});
 }
 // Plugins are independent installable packages. Keep their resource copies
 // self-contained; only CUA's inseparable application runtime shares files.
 const bases=['cua_node/lib/node_modules/@oai/browser-desktop/scripts','cua_node/lib/node_modules/@oai/cua/dist/lib/js/oai_js_browser/dist/skill/scripts'];
 for(const name of ['browser-accessibility.wasm.br','zxing_reader.wasm','browser-service.mjs']){
  let canonical,digest;
  for(const base of bases){const relative=base+'/'+name,file=path.join(resources,relative);if(!fs.existsSync(file)||fs.lstatSync(file).isSymbolicLink())continue;regular(resources,relative);const hash=sha(fs.readFileSync(file));
   if(!canonical){canonical=file;digest=hash;continue;}if(hash!==digest)continue;
   const bytes=fs.statSync(file).size,target=path.relative(path.dirname(file),canonical);fs.unlinkSync(file);fs.symlinkSync(target,file);links.push({path:relative,target,savedBytes:bytes});
  }
 }
 return {links,savedBytes:links.reduce((n,x)=>n+x.savedBytes,0)};
}

export function slimPresentationSource(source){
 if(source.includes(marker)||!source.includes('payment-success-celebration')&&!source.includes('appshot-demo'))return {source,patches:0};
 const ast=parse(source),edits=[];
 if(source.includes('payment-success-celebration')){
  const names=new Set();walk(ast,n=>{
   if(n.type==='Property'&&(n.key.name||literal(n.key))==='PaymentCelebrationAnimation'&&n.value.type==='ArrowFunctionExpression'&&n.value.body.type==='Identifier')names.add(n.value.body.name);
   if(n.type==='ExportSpecifier'&&(n.exported.name||n.exported.value)==='PaymentCelebrationAnimation')names.add(n.local.name);
  });
  walk(ast,n=>{if(n.type==='FunctionDeclaration'&&names.has(n.id?.name))edits.push([n.body.start,n.body.end,'{'+marker+'return null;}']);});
  if(edits.length!==1)throw Error('Payment presentation component contract changed');
 }else{
  const names=new Set();walk(ast,n=>{const target=n.type==='VariableDeclarator'?n.id:n.type==='AssignmentExpression'?n.left:null,value=n.type==='VariableDeclarator'?n.init:n.type==='AssignmentExpression'?n.right:null;if(target?.type==='Identifier'&&value&&source.slice(value.start,value.end).includes('appshot-demo'))names.add(target.name);});
  walk(ast,n=>{if(n.type!=='CallExpression'||literal(n.arguments[0])!=='video'||n.arguments[1]?.type!=='ObjectExpression')return;
   if(n.arguments[1].properties.some(p=>(p.key?.name||literal(p.key))==='src'&&p.value.type==='Identifier'&&names.has(p.value.name)))edits.push([n.start,n.end,'null']);
  });
  if(edits.length!==1)throw Error('Screenshot demo video contract changed');
 }
 let result=source;for(const[a,b,text]of edits.sort((a,b)=>b[0]-a[0]))result=result.slice(0,a)+text+result.slice(b);
 if(!result.includes(marker))result=marker+result;parse(result);return {source:result,patches:edits.length};
}
export function planPresentationResources(asar,archive,{priorChanges=new Map()}={}){
 const files=asar.listPackage(archive).map(n=>n.replaceAll('\\','/').replace(/^\//,'')),changes=new Map(),removed=new Set();let patches=0;
 for(const name of files.filter(n=>n.startsWith('webview/')&&n.endsWith('.js'))){const source=priorChanges.get(name)?.toString()||asar.extractFile(archive,name.replaceAll('/',path.sep)).toString();const result=slimPresentationSource(source);if(result.patches){patches+=result.patches;changes.set(name,Buffer.from(result.source));}}
 const media=files.filter(n=>/^webview\/assets\/(?:payment-success-celebration[.-].*\.(?:json|webm)|appshot-demo[.-].*\.mp4)$/.test(n));
 if(media.length&&!patches){
  const already=files.some(n=>n.endsWith('.js')&&asar.extractFile(archive,n.replaceAll('/',path.sep)).toString().includes(marker));if(!already)throw Error('Presentation media cannot be removed without disabling consumers');
 }
 for(const name of media)removed.add(name);
 return {changes,removed,report:{patches,removedFiles:removed.size,removedBytes:media.reduce((n,f)=>n+asar.statFile(archive,f.replaceAll('/',path.sep)).size,0)}};
}
