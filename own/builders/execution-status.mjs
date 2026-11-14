import fs from 'node:fs';
import path from 'node:path';
import {parse} from 'acorn';
const marker='/* codex-own:execution-status-v2 */';
const template=fs.readFileSync(new URL('../desktop/execution-status.js',import.meta.url),'utf8');
export const executionPreload=String.raw`;(()=>{const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('codexOwnExecutionTiming',Object.freeze({read:threadId=>ipcRenderer.invoke('codex-own:execution-timing:v1',threadId)}));})();`+'\n';
function walk(n,fn,parents=[]){if(!n||typeof n!=='object')return;fn(n,parents);for(const v of Object.values(n)){if(Array.isArray(v))for(const c of v)walk(c,fn,[...parents,n]);else if(v&&typeof v==='object')walk(v,fn,[...parents,n]);}}
const isFn=n=>['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(n.type);
export function patchExecutionStatus(source){
 if(source.includes(marker))return {source,count:1};
 if(!source.includes('data-codex-composer-root')||!source.includes('data-above-composer-conversation-id'))return {source,count:0};
 const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'}),edits=[],modules=new Set(),functions=new Set();let count=0;
 const property=(n,key)=>n?.properties?.find(p=>(p.key?.value??p.key?.name)===key);
 walk(ast,(n,parents)=>{
  if(n.type!=='ObjectExpression'||!property(n,'data-codex-composer-root'))return;
  const fn=[...parents].reverse().find(isFn);if(!fn||functions.has(fn))return;
  const anchors=[];
  walk(fn.body,(obj,ancestors)=>{if(obj.type!=='ObjectExpression')return;const owner=[...ancestors].reverse().find(isFn);if(owner&&owner!==fn)return;const p=property(obj,'data-above-composer-conversation-id');if(p)anchors.push(p.value);});
  // The native composer already publishes the canonical active conversation ID.
  if(!anchors.length)return;if(anchors.length!==1)throw Error('Native composer conversation anchor is ambiguous');
  const module=[...parents].reverse().find(p=>p.type==='FunctionExpression'&&p.params.length===3);if(!module||module.params[2].type!=='Identifier')throw Error('Execution status module contract changed');
  const anchor=anchors[0],thread=source.slice(anchor.start,anchor.end);
  walk(fn.body,(ret,ancestors)=>{if(ret.type!=='ReturnStatement'||!ret.argument)return;const owner=[...ancestors].reverse().find(isFn);if(owner&&owner!==fn)return;const v=ret.argument;if(v.start<anchor.end)throw Error('Native composer returns before its conversation anchor');edits.push([v.start,v.end,`__ownComposerExecutionFrame(${thread},(${source.slice(v.start,v.end)}))`]);});
  if(!modules.has(module)){modules.add(module);edits.push([module.body.end-1,module.body.end-1,'\n'+marker+'const __ownReact='+module.params[2].name+'("zd8w"),__ownJsx='+module.params[2].name+'("ABep");\n'+template]);}functions.add(fn);count++;
 });
 for(const [a,b,v]of edits.sort((a,b)=>b[0]-a[0]))source=source.slice(0,a)+v+source.slice(b);
 parse(source,{ecmaVersion:'latest',sourceType:'module'});return {source,count};
}
export function executionStatusChanges(asar,archive,{priorChanges=new Map()}={}){
 const changes=new Map();let count=0;
 for(const file of asar.listPackage(archive).map(n=>n.replaceAll('\\','/').replace(/^\//,''))){if(!file.startsWith('webview/assets/')||!file.endsWith('.js'))continue;
  const original=(priorChanges.get(file)||asar.extractFile(archive,file.replaceAll('/',path.sep))).toString();if(!original.includes('data-codex-composer-root')&&!original.includes(marker))continue;
  const r=patchExecutionStatus(original);count+=r.count;if(r.source!==original)changes.set(file,Buffer.from(r.source));
 }
 if(!count)throw Error('Execution status renderer entry missing');return changes;
}
