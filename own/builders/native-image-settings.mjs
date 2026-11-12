import fs from 'node:fs';
import path from 'node:path';
import {parse} from 'acorn';
const marker='/* codex-own:native-image-settings-v1 */';
const template=fs.readFileSync(new URL('../desktop/image-settings-component.js',import.meta.url),'utf8');
function walk(node,fn,ancestors=[]){if(!node||typeof node!=='object')return;fn(node,ancestors);for(const value of Object.values(node)){if(Array.isArray(value))for(const child of value)walk(child,fn,[...ancestors,node]);else if(value&&typeof value==='object')walk(value,fn,[...ancestors,node]);}}
const key=node=>node.key?.name??node.key?.value;
export function patchNativeImageSettings(source){
 if(source.includes(marker))return {source,already:true};
 if(!source.includes('GeneralSettings:'))return {source,patched:false};
 const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'}),exports=[];
 walk(ast,(n,parents)=>{if(n.type==='Property'&&key(n)==='GeneralSettings'&&n.value?.type==='ArrowFunctionExpression'&&n.value.body.type==='Identifier')exports.push({name:n.value.body.name,module:[...parents].reverse().find(p=>['FunctionExpression','FunctionDeclaration'].includes(p.type))});});
 if(exports.length!==1||!exports[0].module)throw Error('Native general settings export contract changed');
 const {module,name}=exports[0],imports=new Map();
 for(const statement of module.body.body)if(statement.type==='VariableDeclaration')for(const d of statement.declarations)if(d.init?.type==='CallExpression'&&typeof d.init.arguments[0]?.value==='string')imports.set(d.init.arguments[0].value,d.id.name);
 const mapping={__JSX__:imports.get('ABep'),__REACT__:imports.get('zd8w'),__GROUP__:imports.get('BSnr'),__ROW__:imports.get('AWNZ')};
 if(Object.values(mapping).some(v=>!v))throw Error('Native settings UI imports changed');
 const general=module.body.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name),targets=[];
 if(!general)throw Error('Native settings component missing');
 walk(general,n=>{if(n.type==='ObjectExpression'&&n.properties.some(p=>key(p)==='title')){const p=n.properties.find(p=>key(p)==='children'&&p.value.type==='ArrayExpression');if(p)targets.push(p.value);}});
 if(targets.length!==1)throw Error('Native general settings content contract changed');
 let component=template;for(const [from,to] of Object.entries(mapping))component=component.replaceAll(from,to);
 const edits=[[module.body.end-1,'\n'+marker+'\n'+component+'\n'],[targets[0].start+1,`${mapping.__JSX__}.jsx(__codexOwnAccountSettings,{}),${mapping.__JSX__}.jsx(__codexOwnImageSettings,{}),`]];
 for(const [at,value]of edits.sort((a,b)=>b[0]-a[0]))source=source.slice(0,at)+value+source.slice(at);
 parse(source,{ecmaVersion:'latest',sourceType:'module'});return {source,patched:true};
}
export function verifyNativeImageSettings(app,asar){
 const archive=path.join(app,fs.existsSync(path.join(app,'Contents'))?'Contents/Resources/app.asar':'resources/app.asar');let count=0;
 for(const name of asar.listPackage(archive).map(n=>n.replaceAll('\\','/').replace(/^\//,'')))if(name.startsWith('webview/assets/')&&name.endsWith('.js')){const source=asar.extractFile(archive,name.replaceAll('/',path.sep)).toString();if(source.includes('GeneralSettings:')){if(!source.includes(marker))throw Error('Native image settings missing');count++;}}
 if(count!==1)throw Error('Expected one native general settings integration');return {contract:1,placement:'settings/general-settings',preservesUpstreamSettings:true};
}
