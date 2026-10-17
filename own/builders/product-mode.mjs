import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),acorn=require('acorn');
const helper='const __codexOwnApiMode=()=>globalThis.codexOwnProductPolicy?.contract===1&&globalThis.codexOwnProductPolicy.apiMode===true;\n';
const stateMarker='/* codex-own:api-mode-state-v1 */';
const switchMarker='/* codex-own:api-mode-switch-v1 */';
const menuMarker='/* codex-own:api-mode-menu-v1 */';
const detailMarker='/* codex-own:api-detail-state-v1 */';
const preferenceMarker='/* codex-own:api-detail-write-v1 */';
export const policyPreload=';(()=>{const {contextBridge,ipcRenderer}=require("electron");const p=ipcRenderer.sendSync("codex-own:product-policy:v1");if(!p||p.contract!==1||typeof p.apiMode!=="boolean")throw Error("codex-own product policy unavailable");contextBridge.exposeInMainWorld("codexOwnProductPolicy",{contract:1,apiMode:p.apiMode});})();\n';
function walk(node,fn){if(!node||typeof node!=='object')return;fn(node);for(const v of Object.values(node)){if(Array.isArray(v))for(const c of v)walk(c,fn);else if(v&&typeof v==='object')walk(v,fn);}}
const key=p=>p.key?.name??p.key?.value;
const property=(node,name)=>node?.properties?.find(p=>key(p)===name);
const text=(s,n)=>s.slice(n.start,n.end);
const one=(items,name)=>{if(items.length!==1)throw Error(`Product mode contract changed: ${name} count=${items.length}`);return items[0];};
export function patchProductModeSource(source){
  if(!source.includes('sidebarElectron.productMode.trigger'))return {source,patched:false};
  if(source.includes(stateMarker)){verifyProductModeSource(source);return {source,patched:false,already:true};}
  const ast=acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'}),states=[],switches=[],selectors=[];
  walk(ast,n=>{
    if(n.type==='ArrowFunctionExpression'&&n.params[0]?.type==='ObjectPattern'&&property(n.params[0],'get')&&n.body.type==='BlockStatement'){
      const s=text(source,n.body);if(s.includes('conversationDetailMode')&&s.includes('STEPS_PROSE')&&s.length<2000)states.push(n);
    }
    if(n.type==='FunctionDeclaration'&&n.params[1]?.type==='ObjectPattern'&&property(n.params[1],'nextMode')&&property(n.params[1],'codexLocalAccessStatus'))switches.push(n);
    if(n.type==='FunctionDeclaration'&&n.body.end-n.body.start<30000&&text(source,n.body).includes('sidebarElectron.productMode.trigger')&&text(source,n.body).includes('sidebarElectron.productMode.work.description.recommended'))selectors.push(n);
  });
  const state=one(states,'state'),transition=one(switches,'transition'),selector=one(selectors,'selector');
  const mode=property(transition.params[1],'nextMode').value;
  if(mode.type!=='Identifier')throw Error('Unsupported product mode transition binding');
  const edits=[
    [state.body.start+1,state.body.start+1,`${stateMarker}if(__codexOwnApiMode())return "codex";`],
    [transition.body.start+1,transition.body.start+1,`${switchMarker}if(__codexOwnApiMode()&&${mode.name}!=="codex")return;`],
  ];
  const bindings=[];walk(selector.body,n=>{if(n.type==='VariableDeclaration')for(const d of n.declarations)if(d.id.type==='ObjectPattern'&&property(d.id,'codexAvailable')&&property(d.id,'onModeSelect'))bindings.push({declaration:n,pattern:d.id});});
  const {declaration,pattern}=one(bindings,'selector bindings');
  const [available,selected,newChat]=['codexAvailable','mode','onNewChat'].map(k=>property(pattern,k)?.value);
  if([available,selected,newChat].some(n=>n?.type!=='Identifier'))throw Error('Unsupported product mode selector bindings');
  edits.push([declaration.end,declaration.end,`${menuMarker}if(__codexOwnApiMode()){${available.name}=true;${selected.name}="codex";${newChat.name}=void 0;}`]);
  const items=[];walk(selector.body,n=>{
    if(n.type==='ObjectExpression'&&property(n,'onSelect')?.value.type==='Identifier'&&property(n,'SubText')?.value.type==='Identifier'&&property(n,'rightIconAsset')?.value.type==='Identifier')items.push(n);
  });
  const item=one(items,'ChatGPT menu item'),select=property(item,'onSelect').value,classes=property(item,'className').value;
  edits.push([item.start+1,item.start+1,'disabled:__codexOwnApiMode(),"aria-disabled":__codexOwnApiMode(),']);
  edits.push([select.start,select.end,`__codexOwnApiMode()?void 0:(${text(source,select)})`]);
  edits.push([classes.start,classes.end,`(${text(source,classes)})+(__codexOwnApiMode()?" opacity-50 cursor-not-allowed":"")`]);
  for(const [a,b,value]of edits.sort((a,b)=>b[0]-a[0]))source=source.slice(0,a)+value+source.slice(b);
  if(!source.includes(helper.trim()))source=helper+source;acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'});verifyProductModeSource(source);
  return {source,patched:true};
}
export function verifyProductModeSource(source){
  for(const marker of [helper.trim(),stateMarker,switchMarker,menuMarker])if(source.split(marker).length!==2)throw Error('API product mode patch missing or duplicated');
  if(!source.includes('disabled:__codexOwnApiMode(),"aria-disabled":__codexOwnApiMode()'))throw Error('API product mode disabled item missing');
  return true;
}
export function patchProductModePreload(source){
  if(source.includes(policyPreload))return source;
  if(!source.includes('exposeInMainWorld'))throw Error('Main preload contract changed');
  return policyPreload+source;
}
export function patchProductModeShared(source){
  if(source.includes(detailMarker)){verifyProductModeShared(source);return {source,patched:false,already:true};}
  const ast=acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'}),states=[],setters=[];
  walk(ast,n=>{
    if(n.type==='ArrowFunctionExpression'&&n.params[0]?.type==='ObjectPattern'&&property(n.params[0],'get')&&n.body.type==='BlockStatement'){
      const s=text(source,n.body);if(s.length<2000&&s.includes('conversationDetailMode')&&s.includes('detailLevel')&&s.includes('coding')&&s.includes('everyday'))states.push(n);
    }
    if(n.type==='FunctionDeclaration'&&n.params.length===2&&n.params[1].type==='Identifier'){
      const s=text(source,n.body);if(s.length<2500&&s.includes('previousWorkMode:')&&s.includes('selectedThreadDetailLevel:'))setters.push(n);
    }
  });
  const state=one(states,'execution detail state'),setter=one(setters,'execution detail setter');
  const edits=[
    [state.body.start+1,`${detailMarker}if(__codexOwnApiMode())return "STEPS_COMMANDS";`],
    [setter.body.start+1,`${preferenceMarker}if(__codexOwnApiMode())${setter.params[1].name}="STEPS_COMMANDS";`],
  ];
  for(const [at,value]of edits.sort((a,b)=>b[0]-a[0]))source=source.slice(0,at)+value+source.slice(at);
  if(!source.includes(helper.trim()))source=helper+source;acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'});verifyProductModeShared(source);return {source,patched:true};
}
function verifyProductModeShared(source){for(const marker of [helper.trim(),detailMarker,preferenceMarker])if(source.split(marker).length!==2)throw Error('API execution mode patch missing or duplicated');}
export function productModeChanges(asar,archive,{priorChanges=new Map()}={}){
  const changes=new Map();let renderers=0,preloads=0,shared=0;
  for(const file of asar.listPackage(archive).map(n=>n.replaceAll('\\','/').replace(/^\//,''))){
    if(file.startsWith('webview/assets/')&&file.endsWith('.js')){
      const original=(priorChanges.get(file)||asar.extractFile(archive,file.replaceAll('/',path.sep))).toString();let source=original;
      if(source.includes('sidebarElectron.productMode.trigger')&&source.includes('sidebarElectron.productMode.work.description.recommended')&&source.includes('codexLocalAccessStatus:')){
        const result=patchProductModeSource(source);if(result.patched||result.already){renderers++;source=result.source;}
      }
      // Follow the implementation rather than a bundler's current chunk name.
      if(source.includes('previousWorkMode:')&&source.includes('selectedThreadDetailLevel:')){const result=patchProductModeShared(source);shared++;source=result.source;}
      if(source!==original)changes.set(file,Buffer.from(source));
    }
    if(file==='.vite/build/preload.js'){
      const source=(priorChanges.get(file)||asar.extractFile(archive,file.replaceAll('/',path.sep))).toString(),updated=patchProductModePreload(source);preloads++;if(updated!==source)changes.set(file,Buffer.from(updated));
    }
  }
  if(renderers!==1||preloads!==1||shared!==1)throw Error(`API product mode entry points missing: renderer=${renderers}, preload=${preloads}, shared=${shared}`);
  return changes;
}
export function verifyProductMode(app,asar){
  const resources=path.join(app,fs.existsSync(path.join(app,'Contents'))?'Contents/Resources':'resources'),archive=path.join(resources,'app.asar');
  if(productModeChanges(asar,archive).size)throw Error('API product mode patch missing from desktop');
  for(const file of ['desktop/product-mode.cjs'])fs.statSync(path.join(resources,'own-updater',file));
  return {contract:1,apiDefault:'codex',chatgptDisabled:true};
}
