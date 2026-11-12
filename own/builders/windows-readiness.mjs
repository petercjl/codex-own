import fs from 'node:fs';
import path from 'node:path';
import {parse} from 'acorn';
const marker='/* codex-own:windows-readiness-retry-v1 */';
const anchor='Failed to load Windows sandbox readiness';
const helper=fs.readFileSync(new URL('../desktop/windows-readiness-retry.js',import.meta.url),'utf8');
function walk(node,visit,parents=[]){if(!node||typeof node!=='object')return;visit(node,parents);for(const value of Object.values(node))if(Array.isArray(value))value.forEach(n=>walk(n,visit,[...parents,node]));else if(value&&typeof value==='object')walk(value,visit,[...parents,node]);}
export function patchWindowsReadiness(source){
 if(source.includes(marker))return{source,already:true,patches:0};
 if(!source.includes(anchor))return{source,patches:0};
 const tree=parse(source,{ecmaVersion:'latest',sourceType:'module'}),targets=[],owners=new Set();
 walk(tree,(node,parents)=>{
  if(node.type!=='AwaitExpression'||node.argument.type!=='CallExpression')return;
  const call=node.argument;
  if(call.callee.type!=='MemberExpression'||call.callee.computed||call.callee.property.name!=='sendRequest'||call.arguments[0]?.value!=='windowsSandbox/readiness')return;
  const owner=[...parents].reverse().find(n=>['FunctionExpression','FunctionDeclaration','ArrowFunctionExpression'].includes(n.type));
  if(!owner?.async||!source.slice(owner.start,owner.end).includes(anchor))return;
  targets.push(call);owners.add(owner);
 });
 if(!targets.length||owners.size!==targets.length||source.split(anchor).length-1!==targets.length)throw Error('Windows sandbox readiness query contract changed');
 if(source.includes('__codexOwnWindowsReadiness'))throw Error('Windows readiness helper binding collision');
 for(const node of targets.sort((a,b)=>b.start-a.start))source=source.slice(0,node.start)+'__codexOwnWindowsReadiness(()=>'+source.slice(node.start,node.end)+')'+source.slice(node.end);
 source+='\n'+marker+'\n'+helper;
 parse(source,{ecmaVersion:'latest',sourceType:'module'});return{source,patches:targets.length};
}
export function windowsReadinessChanges(asar,archive,{priorChanges=new Map()}={}){
 const changes=new Map();let queries=0;
 for(const name of asar.listPackage(archive).map(n=>n.replaceAll('\\','/').replace(/^\//,'')).filter(n=>n.startsWith('webview/assets/')&&n.endsWith('.js'))){
  const source=priorChanges.get(name)?.toString()??asar.extractFile(archive,name.replaceAll('/',path.sep)).toString();
  if(!source.includes(anchor))continue;
  const result=patchWindowsReadiness(source);queries++;if(result.source!==source)changes.set(name,Buffer.from(result.source));
 }
 if(!queries)throw Error('Windows sandbox readiness integration missing');return changes;
}
export function verifyWindowsReadiness(app,asar){
 const archive=path.join(app,'resources/app.asar');let queries=0;
 for(const name of asar.listPackage(archive).map(n=>n.replaceAll('\\','/').replace(/^\//,'')).filter(n=>n.startsWith('webview/assets/')&&n.endsWith('.js'))){
  const source=asar.extractFile(archive,name.replaceAll('/',path.sep)).toString();if(!source.includes(anchor))continue;
  if(!source.includes(marker)||!source.includes(helper))throw Error('Windows readiness recovery missing');queries++;
 }
 if(!queries)throw Error('Windows sandbox readiness integration missing');return{contract:1,queries,boundedTransientRecovery:true,sandboxPolicyUnchanged:true};
}
