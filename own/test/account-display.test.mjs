import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {patchProductModePreload,policyPreload} from '../builders/product-mode.mjs';
import vm from 'node:vm';
const {start,CHANNEL,DISPLAY,displayState,mainDocument}=createRequire(import.meta.url)('../desktop/account.cjs');
test('account display exposes identity only and recognizes the exact application document',()=>{
 assert.deepEqual(displayState({phase:'signed-in',authenticated:true,name:'同事',token:'secret',apiKey:'secret'}),{phase:'signed-in',authenticated:true,name:'同事',restartRequired:false,userCode:''});assert.equal(displayState({authenticated:false,name:'Previous account'}).name,'');
 assert(mainDocument('app://-/index.html#/thread'));for(const url of ['https://-/index.html','app://-/other.html','app://user@-/index.html','file:///index.html'])assert(!mainDocument(url));
});
test('fresh and older preloads gain one account display without duplicating the existing product bridge',()=>{
 const source='contextBridge.exposeInMainWorld("fixture",{});',fresh=patchProductModePreload(source);assert.equal(patchProductModePreload(fresh),fresh);
 const boundary=policyPreload.search(/;\(\(\)=>\{\r?\n/);assert.ok(boundary>0);const bridge=policyPreload.slice(0,boundary);const upgraded=patchProductModePreload(bridge+source);assert.equal(upgraded,fresh);assert.equal(upgraded.split('codexOwnProductPolicy",').length-1,1);
});
test('Windows account placement follows the native rail as it mounts and keeps the settings action',()=>{
 const source=fs.readFileSync(new URL('../desktop/account-display-preload.js',import.meta.url),'utf8'),body=source.slice(source.indexOf(' function place(){'),source.indexOf(' function render('));
 const style=()=>({setProperty(name,value){this[name]=value;}}),legacy={children:[],append(node){node.parentElement=this;}},native={parentElement:legacy,style:style(),setAttribute(){},tabIndex:0},gear={textContent:'设置',style:style(),setAttribute(){},tabIndex:0},badge={parentElement:legacy,style:style()},label={style:style()},rail={querySelectorAll:()=>[gear,badge],append(node){node.parentElement=this;}},overlay={},root={tagName:'DIV',inert:false};let mounted=true;
 const document={body:{children:[root],append(node){node.parentElement=this;}},querySelector:q=>q==='[data-app-navigation-rail]'?(mounted?rail:null):native};overlay.parentElement=document.body;
 const context={process:{platform:'win32'},document,badge,label,overlay,state:{authenticated:true},inertBefore:new Map()};vm.createContext(context);vm.runInContext(body+';place()',context);assert.equal(badge.parentElement,rail);assert.equal(gear.style.display,'none');assert.equal(native.style.display,'none');assert.equal(badge.style.marginTop,'auto');assert.equal(root.inert,false);
 mounted=false;vm.runInContext('place()',context);assert.equal(badge.parentElement,legacy);mounted=true;vm.runInContext('place()',context);assert.equal(badge.parentElement,rail);assert.ok(source.includes("const open=()=>invoke(state.authenticated?'settings':'login')"));
});
test('legacy local API files do not bypass enterprise login and renderer display IPC cannot start login or read credentials',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'own-account-display-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'core'));fs.writeFileSync(path.join(root,'core/auth.json'),'legacy-local-key');
 const oldResources=process.resourcesPath;process.resourcesPath=root;t.after(()=>{if(oldResources===undefined)delete process.resourcesPath;else process.resourcesPath=oldResources;});
 const app=new EventEmitter();app.whenReady=()=>Promise.resolve();const handlers=new Map(),windows=[];
 class Window{constructor(){windows.push(this);this.webContents=new EventEmitter();this.webContents.send=()=>{};this.webContents.setWindowOpenHandler=()=>{};this.events=new EventEmitter();}isDestroyed(){return false;}loadFile(){}on(...args){this.events.on(...args);}show(){}focus(){}}
 const Menu={setApplicationMenu(){},getApplicationMenu:()=>null};let calls=0,selectedOrigin;
 start({app,BrowserWindow:Window,Menu,MenuItem:class{},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},shell:{}},root,{loadClient:async()=>({loginStatus:async()=>{calls++;return {authenticated:false};},beginLogin:async(origin)=>{selectedOrigin=origin;throw Error('End of fixture');}})});t.after(()=>app.emit('before-quit'));
 await new Promise(r=>setImmediate(r));assert.equal(calls,1);assert.equal(windows.length,0,'startup must use the main login page without a second account window');
 const web=new EventEmitter();web.mainFrame={url:'app://-/index.html'};web.getURL=()=>web.mainFrame.url;web.send=()=>{};web.isDestroyed=()=>false;app.emit('browser-window-created',{}, {webContents:web});const event={sender:web,senderFrame:web.mainFrame};
 assert.equal((await handlers.get(DISPLAY)(event,'status')).authenticated,false);
 await assert.rejects(handlers.get(DISPLAY)(event,'configure'),/Invalid account display action/);
 await assert.rejects(handlers.get(DISPLAY)({...event,senderFrame:{url:'app://-/index.html'}},'status'),/Invalid account display sender/);
 web.mainFrame.url='https://foreign.example';await assert.rejects(handlers.get(DISPLAY)(event,'open'),/Invalid account display sender/);
 web.mainFrame.url='app://-/index.html';await handlers.get(DISPLAY)(event,'login',{origin:'http://foreign.example',allowHttp:true});assert.equal(selectedOrigin,'https://codex.lumyne.cn');assert.equal(windows.length,0);
 const html=fs.readFileSync(new URL('../desktop/account.html',import.meta.url),'utf8');assert(!html.includes('id="origin"'));assert(!html.includes('id="http"'));
});
