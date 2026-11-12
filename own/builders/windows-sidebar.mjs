import path from 'node:path';import {parse} from 'acorn';
const marker='/* codex-own:unified-sidebar-v1 */';
const helper='function __codexOwnUnifiedSidebar(){return globalThis.codexOwnProductPolicy?.contract===1&&globalThis.codexOwnProductPolicy.apiMode===true;}';
const relevant=s=>s.includes('3085093835')&&s.includes('rail-with-contextual-sidebar')&&s.includes('rail-only');
function walk(n,fn){if(!n||typeof n!=='object')return;fn(n);for(const v of Object.values(n))if(Array.isArray(v))v.forEach(x=>walk(x,fn));else if(v&&typeof v==='object')walk(v,fn);}
export function patchWindowsSidebar(source){
 if(source.includes(marker))return{source,already:true};if(!relevant(source))return{source,patched:false};
 const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'}),targets=[];
 walk(ast,n=>{
  if(n.type!=='ArrowFunctionExpression'||n.params[0]?.type!=='ObjectPattern'||n.body.type!=='CallExpression')return;
  const getter=n.params[0].properties.find(p=>(p.key?.name??p.key?.value)==='get')?.value;
  if(getter?.type==='Identifier'&&n.body.callee.type==='Identifier'&&n.body.callee.name===getter.name&&n.body.arguments.length===2&&n.body.arguments[1].value==='3085093835')targets.push(n.body);
 });
 if(!targets.length)return{source,patched:false};
 if(targets.length!==1||source.includes('__codexOwnUnifiedSidebar'))throw Error('Unified sidebar policy contract changed');
 const n=targets[0];source=source.slice(0,n.start)+'(__codexOwnUnifiedSidebar()||'+source.slice(n.start,n.end)+')'+source.slice(n.end)+'\n'+marker+'\n'+helper+'\n';
 parse(source,{ecmaVersion:'latest',sourceType:'module'});return{source,patched:true};
}
export function windowsSidebarChanges(asar,archive,{priorChanges=new Map()}={}){
 const changes=new Map();let count=0;
 for(const name of asar.listPackage(archive).map(n=>n.replaceAll('\\','/').replace(/^\//,'')).filter(n=>n.startsWith('webview/assets/')&&n.endsWith('.js'))){
  const source=priorChanges.get(name)?.toString()??asar.extractFile(archive,name.replaceAll('/',path.sep)).toString();if(!relevant(source))continue;
  const result=patchWindowsSidebar(source);if(result.patched||result.already)count++;if(result.source!==source)changes.set(name,Buffer.from(result.source));
 }
 if(count!==1)throw Error('Expected one unified sidebar policy module');return changes;
}
export function verifyWindowsSidebar(app,asar){
 if(windowsSidebarChanges(asar,path.join(app,'resources/app.asar')).size)throw Error('Windows unified sidebar policy missing');return{contract:1,nativeNavigationRail:true,contextualSidebar:true,apiModeOnly:true};
}
