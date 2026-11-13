import fs from 'node:fs';
import path from 'node:path';
import {parse} from 'acorn';
const navMarker='/* codex-own:company-tools-nav-v1 */',routeMarker='/* codex-own:company-tools-route-v1 */';
const template=fs.readFileSync(new URL('../desktop/company-tools-page.js',import.meta.url),'utf8');
const key=p=>p.key?.name??p.key?.value,prop=(n,k)=>n?.properties?.find(p=>key(p)===k);
function walk(node,fn,parents=[]){if(!node||typeof node!=='object')return;fn(node,parents);for(const v of Object.values(node)){if(Array.isArray(v))for(const c of v)walk(c,fn,[...parents,node]);else if(v&&typeof v==='object')walk(v,fn,[...parents,node]);}}
export function patchCompanyTools(source){
 const already={nav:source.includes(navMarker),route:source.includes(routeMarker)};
 if(already.nav||already.route)return {source,...already};
 if(!source.includes('sidebar-plugins')&&!source.includes('path:"/skills"'))return {source,nav:false,route:false};
 const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'}),nav=[],routes=[];
 walk(ast,(n,parents)=>{
  if(n.type!=='CallExpression')return;
  const object=n.arguments[0];
  if(n.callee.type==='MemberExpression'&&n.callee.property.name==='push'&&object?.type==='ObjectExpression'&&prop(object,'animatedIcon')?.value.value==='sidebar-plugins'&&prop(object,'onSelect')&&prop(object,'isCurrentDestination'))nav.push({n,object});
  const props=n.arguments[1];
  if(props?.type==='ObjectExpression'&&prop(props,'path')?.value.value==='/skills'&&parents.at(-1)?.type==='ArrayExpression')routes.push({n,module:[...parents].reverse().find(p=>p.type==='FunctionExpression'||p.type==='FunctionDeclaration')});
 });
 if(nav.length>1||routes.length>1)throw Error('Company tools navigation contract is ambiguous');
 const edits=[];
 if(nav.length){
  const {n,object}=nav[0],select=prop(object,'onSelect').value,paths=[];let navigate;
  walk(select,node=>{if(node.type==='CallExpression'&&node.arguments[1]?.type==='Identifier'){if(navigate)throw Error('Company tools navigation binding changed');navigate=node.arguments[1].name;}});
  walk(prop(object,'isCurrentDestination').value,node=>{if(node.type==='CallExpression'&&node.callee.type==='MemberExpression'&&node.callee.property.name==='startsWith'&&node.callee.object.type==='Identifier')paths.push(node.callee.object.name);});
  const names=[...new Set(paths)];if(!navigate||names.length!==1)throw Error('Company tools sidebar bindings changed');
  const original=source.slice(n.start,n.end),push=source.slice(n.callee.start,n.callee.end),item=source.slice(object.start,object.end);
  edits.push([n.start,n.end,`(${original},${navMarker}${push}({...${item},id:"codex-own-company-tools",newTabPath:"/company-tools",label:"公司工具集",onSelect:()=>${navigate}("/company-tools"),isCurrentDestination:${names[0]}.startsWith("/company-tools"),onPrefetch:()=>{}}))`]);
 }
 if(routes.length){
  const {n,module}=routes[0],imports=new Map();
  if(!module)throw Error('Company tools route module missing');
  for(const statement of module.body.body)if(statement.type==='VariableDeclaration')for(const d of statement.declarations)if(d.init?.type==='CallExpression'&&typeof d.init.arguments[0]?.value==='string')imports.set(d.init.arguments[0].value,d.id.name);
  const jsx=imports.get('ABep'),react=imports.get('zd8w');if(!jsx||!react)throw Error('Company tools React imports changed');
  const router=source.slice(n.arguments[0].start,n.arguments[0].end);
  edits.push([n.start,n.start,`${routeMarker}${jsx}.jsx(${router},{path:"/company-tools",element:${jsx}.jsx(__codexOwnCompanyTools,{})}),`]);
  edits.push([module.body.end-1,module.body.end-1,'\n'+template.replaceAll('__JSX__',jsx).replaceAll('__REACT__',react)+'\n']);
 }
 for(const [a,b,value]of edits.sort((a,b)=>b[0]-a[0]))source=source.slice(0,a)+value+source.slice(b);
 parse(source,{ecmaVersion:'latest',sourceType:'module'});return {source,nav:!!nav.length,route:!!routes.length};
}
export function companyToolsChanges(asar,archive,{priorChanges=new Map()}={}){
 const changes=new Map();let nav=0,route=0;
 for(const file of asar.listPackage(archive).map(n=>n.replaceAll('\\','/').replace(/^\//,''))){if(!file.startsWith('webview/assets/')||!file.endsWith('.js'))continue;
  const original=(priorChanges.get(file)||asar.extractFile(archive,file.replaceAll('/',path.sep))).toString();
  if(!original.includes('sidebar-plugins')&&!original.includes('path:"/skills"')&&!original.includes(routeMarker))continue;
  const result=patchCompanyTools(original);nav+=Number(result.nav);route+=Number(result.route);if(result.source!==original)changes.set(file,Buffer.from(result.source));
 }
 if(nav!==1||route!==1)throw Error(`Company tools entry points missing: nav=${nav}, route=${route}`);return changes;
}
