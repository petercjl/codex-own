// Discover real locale import catalogs, never infer translation files from
// two-letter filenames (editor grammars and application chunks may share them).
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),acorn=require('acorn');
const marker='/* codex-own languages: zh-CN,en-US */';
const keep=locale=>['en','en-us','zh-cn','zh-hans'].includes(locale.toLowerCase());
const literal=n=>n?.type==='Literal'?n.value:n?.type==='TemplateLiteral'&&!n.expressions.length?n.quasis[0].value.cooked:null;
function walk(node,visit){if(!node||typeof node!=='object')return;visit(node);for(const value of Object.values(node))if(Array.isArray(value))value.forEach(n=>walk(n,visit));else if(value&&typeof value==='object')walk(value,visit);}
const parse=source=>acorn.parse(source,{ecmaVersion:'latest',sourceType:'module',allowHashBang:true});
const resolve=(file,spec)=>typeof spec==='string'&&spec.startsWith('.')?path.posix.normalize(path.posix.join(path.posix.dirname(file),spec)):null;
const chunkCall=node=>node.type==='CallExpression'&&node.callee.type==='MemberExpression'&&node.callee.property.name==='e'&&node.arguments.length===1&&/^\d+$/.test(String(literal(node.arguments[0])))?String(literal(node.arguments[0])):null;
function translationChunk(source,id){
 if(!source.includes('__rspack_esm_ids')||!source.includes('sidebarElectron.productMode.trigger'))return null;
 let ids,modules;walk(parse(source),n=>{if(n.type!=='VariableDeclarator')return;if(n.id.name==='__rspack_esm_ids')ids=n.init?.elements?.map(literal).map(String);if(n.id.name==='__webpack_modules__'&&n.init?.type==='ObjectExpression')modules=n.init.properties;});
 if(ids?.length!==1||ids[0]!==id||modules?.length!==1)return null;
 const body=modules[0].value?.body?.body,statement=body?.[0]?.expression;
 if(body?.length!==1||statement?.type!=='AssignmentExpression'||statement.left?.property?.name!=='exports'||statement.right?.type!=='CallExpression'||statement.right.callee?.object?.name!=='JSON'||statement.right.callee?.property?.name!=='parse'||typeof literal(statement.right.arguments[0])!=='string')return null;
 return String(literal(modules[0].key)||modules[0].key.name);
}

export function restrictLocaleCatalogs(source){
 const mainLocale=source.includes('localeOverride')&&source.includes('Intl.getCanonicalLocales');
 if(!source.includes('locales/')&&!source.includes(marker)&&!mainLocale)return {source,catalogs:0,canonicalizers:0,removedImports:[],removedChunks:[]};
 const ast=parse(source),edits=[],removedImports=[],removedChunks=[];let catalogs=0,canonicalizers=source.includes(marker)?1:0;
 walk(ast,node=>{
  if(node.type!=='ObjectExpression'||!node.properties.length)return;
  const props=node.properties.map(p=>({node:p,match:p.type==='Property'&&String(literal(p.key)||'').match(/(?:^|\/)locales\/([^/]+)\.json$/)}));
  if(!props.every(p=>p.match)||!props.some(p=>/^zh-(?:CN|Hans)$/i.test(p.match[1])))return;
  catalogs++;const retained=props.filter(p=>keep(p.match[1]));
  if(retained.length===props.length)return;
  for(const {node:p,match} of props.filter(p=>!keep(p.match[1])))walk(p.value,n=>{if(n.type==='ImportExpression'){const spec=literal(n.source);if(typeof spec!=='string'||!spec.startsWith('.'))throw Error('Unknown locale import contract');removedImports.push(spec);}const id=chunkCall(n);if(id)removedChunks.push(id);});
  edits.push([node.start,node.end,'{'+retained.map(p=>source.slice(p.node.start,p.node.end)).join(',')+'}']);
 });
 if((catalogs||mainLocale)&&!source.includes(marker))walk(ast,node=>{
  if(node.type!=='FunctionDeclaration'||node.params.length!==1||node.params[0].type!=='Identifier'||node.body.end-node.body.start>250)return;
  if(!source.slice(node.body.start,node.body.end).includes('Intl.getCanonicalLocales'))return;
  const name=node.params[0].name;
  edits.push([node.body.start,node.body.end,`{${marker}return /^zh(?:-|_|$)/i.test(typeof ${name}==="string"?${name}.trim():"")?"zh-CN":"en-US";}`]);canonicalizers++;
 });
 let result=source,end=source.length;
 for(const [start,stop,text] of edits.sort((a,b)=>b[0]-a[0])){if(stop>end)throw Error('Overlapping locale edits');result=result.slice(0,start)+text+result.slice(stop);end=start;}
 return {source:result,catalogs,canonicalizers,removedImports,removedChunks};
}

export function planLanguageResources(asar,archive,{priorChanges=new Map()}={}){
 const files=asar.listPackage(archive).map(n=>n.replaceAll('\\','/').replace(/^\//,'')),known=new Set(files),sources=new Map(),changes=new Map(),candidates=new Set(),requestedChunks=new Set(),chunkTargets=new Map(),moduleTargets=new Map();
 let catalogs=0,canonicalizers=0;
 for(const file of files.filter(n=>n.startsWith('webview/')&&n.endsWith('.js'))){
  const before=priorChanges.get(file)?.toString()||asar.extractFile(archive,file.replaceAll('/',path.sep)).toString();
  const result=restrictLocaleCatalogs(before);catalogs+=result.catalogs;canonicalizers+=result.canonicalizers;
  sources.set(file,result.source);if(result.source!==before)changes.set(file,Buffer.from(result.source));
  for(const spec of result.removedImports){const target=resolve(file,spec);if(!known.has(target))throw Error('Locale catalog resource missing: '+target);candidates.add(target);}
  for(const id of result.removedChunks)requestedChunks.add(id);
 }
 if(!catalogs||!canonicalizers)throw Error('Supported-language catalog or fallback anchor missing');
 for(const id of requestedChunks){
  const targets=files.filter(file=>file.startsWith('webview/assets/async/')&&path.posix.basename(file).startsWith(id+'.')&&file.endsWith('.js'));
  if(targets.length!==1)continue;const target=targets[0],module=translationChunk(sources.get(target)||'',id);if(!module)continue;
  candidates.add(target);chunkTargets.set(id,target);moduleTargets.set(module,target);
 }
 // Any retained module's real import wins over pruning. Vite preload-index
 // strings alone are not imports; removed factories no longer request them.
 const edges=[];
 for(const [file,source] of sources){
  walk(parse(source),node=>{
   if(['ImportExpression','ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(node.type)){const target=resolve(file,literal(node.source));if(target&&candidates.has(target))edges.push([file,target]);}
   const chunk=chunkCall(node);if(chunkTargets.has(chunk))edges.push([file,chunkTargets.get(chunk)]);
   if(node.type==='CallExpression'){
    const first=literal(node.arguments[0]),second=literal(node.arguments[1]),member=node.callee.type==='MemberExpression'?node.callee:null;
    if(node.callee.type==='Identifier'&&moduleTargets.has(first)||member?.property.name==='t'&&moduleTargets.has(first))edges.push([file,moduleTargets.get(first)]);
    if(member?.property.name==='bind'&&member.object?.property?.name==='t'&&moduleTargets.has(second))edges.push([file,moduleTargets.get(second)]);
   }
  });
 }
 const removed=new Set(candidates);
 for(let changed=true;changed;){changed=false;for(const [from,to] of edges)if(!removed.has(from)&&removed.delete(to))changed=true;}
 for(const file of files){const match=file.match(/^native-menu-locales\/([^/]+)\.json$/);if(match&&!keep(match[1]))removed.add(file);}
 const entries=[...removed].map(file=>({path:file,size:asar.statFile(archive,file.replaceAll('/',path.sep)).size||0}));
 return {changes,removed,report:{languages:['zh-CN','en-US'],catalogs,canonicalizers,removedFiles:entries.length,removedBytes:entries.reduce((s,x)=>s+x.size,0),entries,retainedSharedModules:[...candidates].filter(n=>!removed.has(n))}};
}

export function pruneLanguageHeader(header,removed){
 // Preflight the entire deletion set before changing the copied header.
 const entries=[...removed].map(file=>{const parts=file.split('/');let parent=header;for(const n of parts.slice(0,-1)){parent=parent.files?.[n];if(!parent)throw Error('Language header entry missing: '+file);}const name=parts.at(-1),entry=parent.files?.[name];if(!entry||entry.files||entry.unpacked||entry.link)throw Error('Unsupported language archive entry: '+file);return {parent,name};});
 for(const {parent,name} of entries)delete parent.files[name];
}
