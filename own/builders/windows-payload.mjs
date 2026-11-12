// Windows desktop distribution owns a native Windows runtime only.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),acorn=require('acorn');
const marker='/* codex-own native Windows */';
export function disableUpstreamUpdates(source){
 const ast=acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'}),edits=[];
 walk(ast,n=>{
  if(n.type!=='Property'||!['shouldIncludeSparkle','shouldIncludeWindowsUpdater','shouldIncludeWindowsMsixUpdater','shouldIncludeUpdater'].includes(n.key?.name||n.key?.value)||!['ArrowFunctionExpression','FunctionExpression'].includes(n.value?.type))return;
  const body=n.value.body;edits.push([body.start,body.end,body.type==='BlockStatement'?'{return false}':'false']);
 });
 let result=source;for(const [a,b,text]of edits.sort((a,b)=>b[0]-a[0]))result=result.slice(0,a)+text+result.slice(b);
 return {source:result,patches:edits.length};
}
function walk(node,visit,parents=[]){if(!node||typeof node!=='object')return;visit(node,parents);for(const value of Object.values(node))if(Array.isArray(value))value.forEach(n=>walk(n,visit,[...parents,node]));else if(value&&typeof value==='object')walk(value,visit,[...parents,node]);}
export function nativeWindowsSource(source){
 if(source.includes(marker))return {source,patches:0};
 const ast=acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'}),functions=[];
 walk(ast,(n,parents)=>{if(n.type==='FunctionDeclaration'&&source.slice(n.body.start,n.body.end).includes('shouldSpawnInsideWsl not set'))functions.push({node:n,scope:[...parents].reverse().find(p=>['Program','FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(p.type))});});
 functions.sort((a,b)=>(a.node.end-a.node.start)-(b.node.end-b.node.start));const {node:entry,scope}=functions[0]||{};
 if(!entry?.id)throw Error('Native Windows execution policy anchor missing');
 const edits=[[entry.body.start,entry.body.end,'{'+marker+'return false;}']];
 // Webpack modules reuse short binding names. Restrict callers to the module
 // owning this boolean getter so unrelated CLI/path resolvers keep their type.
 walk(scope,n=>{if(n.start>=entry.body.start&&n.end<=entry.body.end)return;
  if(n.type==='LogicalExpression'&&n.operator==='??'&&n.right.type==='CallExpression'&&n.right.callee.type==='Identifier'&&n.right.callee.name===entry.id.name)edits.push([n.start,n.end,'false']);
 });
 let result=source;for(const[a,b,text]of edits.sort((a,b)=>b[0]-a[0]))result=result.slice(0,a)+text+result.slice(b);
 acorn.parse(result,{ecmaVersion:'latest',sourceType:'module'});return {source:result,patches:edits.length};
}
export function nativeWindowsChanges(asar,archive,{priorChanges=new Map()}={}){
 const changes=new Map();let policies=0;
 for(const file of asar.listPackage(archive).map(n=>n.replaceAll('\\','/').replace(/^\//,'')).filter(n=>n.startsWith('.vite/build/')&&n.endsWith('.js'))){
  const before=priorChanges.get(file)?.toString()||asar.extractFile(archive,file.replaceAll('/',path.sep)).toString();
  if(!before.includes('shouldSpawnInsideWsl not set')&&!before.includes(marker))continue;
  const result=nativeWindowsSource(before);policies++;if(result.source!==before)changes.set(file,Buffer.from(result.source));
 }
 if(policies<1||policies>2)throw Error('Expected native Windows main/worker execution policies');return changes;
}
export function optimizeWindowsPayload(app){
 const resources=path.join(app,'resources');
 for(const folder of [app,resources])if(fs.lstatSync(folder).isSymbolicLink()||!fs.statSync(folder).isDirectory())throw Error('Expected a copied Windows application');
 function magic(file){const fd=fs.openSync(file,'r'),b=Buffer.alloc(4);try{fs.readSync(fd,b,0,4,0);return b;}finally{fs.closeSync(fd);}}
 for(const name of ['codex.exe','codex-code-mode-host.exe','rg.exe']){const file=path.join(resources,name);if(!fs.existsSync(file)||fs.lstatSync(file).isSymbolicLink()||!magic(file).subarray(0,2).equals(Buffer.from('MZ')))throw Error('Required native Windows program missing: '+name);}
 const removed=[];
 function inventory(file){const stat=fs.lstatSync(file);if(stat.isSymbolicLink())throw Error('Unexpected link in platform payload');if(stat.isDirectory())return fs.readdirSync(file).flatMap(n=>inventory(path.join(file,n)));if(!stat.isFile())throw Error('Unsupported platform resource');return [{path:path.relative(app,file).replaceAll('\\','/'),size:stat.size,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}];}
 for(const name of ['codex','codex-code-mode-host','rg']){const file=path.join(resources,name);if(!fs.existsSync(file))continue;const items=inventory(file);if(!magic(file).equals(Buffer.from([0x7f,0x45,0x4c,0x46])))throw Error('Unexpected Linux executable identity: '+name);removed.push(...items);fs.unlinkSync(file);}
 const prebuilds=[...['@oai','%40oai'].map(scope=>path.join(resources,'cua_node/bin/node_modules',scope,'cua/dist/lib/js/oai_js_browser/dist/skill/node_modules/classic-level/prebuilds')),path.join(resources,'cua_node/bin/node_modules/classic-level/prebuilds'),...['browser','chrome'].map(n=>path.join(resources,'plugins/openai-bundled/plugins',n,'node_modules/classic-level/prebuilds'))];
 for(const base of prebuilds){if(!fs.existsSync(base))continue;if(fs.lstatSync(base).isSymbolicLink())throw Error('Unexpected prebuild link');for(const name of fs.readdirSync(base)){if(name==='win32-x64'||! /^(android|darwin|linux|win32)-[a-z0-9_-]+$/.test(name))continue;const dir=path.join(base,name);removed.push(...inventory(dir));fs.rmSync(dir,{recursive:true});}}
 return {mode:'windows-native',removed,removedBytes:removed.reduce((s,x)=>s+x.size,0)};
}
