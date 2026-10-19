import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {StringDecoder} from 'node:string_decoder';
import {pathToFileURL} from 'node:url';
function setup(t,platform=process.platform){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'own-ui-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'own-updater'));fs.writeFileSync(path.join(root,'own-updater','desktop-version.json'),'{"version":"0.2.2"}');
 let handler,menu,window,reply={ok:true,current:'0.2.2',available:'0.2.3',updateAvailable:true},quits=0,chunks=[];const spawns=[],timers=[],events={},messages=[],states=[],windows=[],styles=new Map();let styleId=0;
 class Menu{constructor(){this.items=[];}append(x){this.items.push(x);}getMenuItemById(id){return this.items.find(i=>i.id===id);}}Menu.setApplicationMenu=m=>{menu=m;};Menu.getApplicationMenu=()=>menu;
 class Window extends EventEmitter{static getAllWindows(){return windows;}constructor(options){super();this.options=options;this.url='about:blank';this.destroyed=false;this.crashed=false;this.loading=false;this.webContents=new EventEmitter();Object.assign(this.webContents,{mainFrame:{},getURL:()=>this.url,isDestroyed:()=>this.destroyed,isCrashed:()=>this.crashed,isLoadingMainFrame:()=>this.loading,insertCSS:async css=>{const key=String(++styleId);styles.set(key,css);return key;},removeInsertedCSS:async key=>{styles.delete(key);},setWindowOpenHandler:()=>{},send:(_channel,state)=>{states.push({...state});}});windows.push(this);window=this;events['browser-window-created']?.({},this);}isDestroyed(){return this.destroyed;}loadFile(f){this.file=f;}show(){}focus(){}}
 const electron={app:{whenReady:()=>Promise.resolve(),on:(n,fn)=>{events[n]=fn;},quit:()=>{quits++;}},BrowserWindow:Window,Menu,MenuItem:class{constructor(opts){Object.assign(this,opts)}},ipcMain:{handle:(_c,h)=>{handler=h;}},dialog:{}};
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(new URL('../desktop/controller.cjs',import.meta.url),'utf8'),{module,URL,process:{platform,resourcesPath:root,env:{OPENAI_API_KEY:'fixture',NODE_OPTIONS:'--bad',PATH:'path'}},setTimeout:(fn,ms)=>{timers.push({fn,ms});return{unref(){}}},setInterval:(fn,ms)=>{timers.push({fn,ms});return{unref(){}}},require:n=>({'../lib/instance.cjs':{identity:()=>({automaticUpdates:true})},'node:fs':fs,'node:path':path,'node:url':{pathToFileURL},'node:string_decoder':{StringDecoder},'node:child_process':{spawn:(exe,args,opts)=>{spawns.push({exe,args,opts});const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.unref=()=>{};c.connected=true;c.send=(m,fn)=>{messages.push(m);fn();};queueMicrotask(()=>{for(const b of chunks)c.stdout.emit('data',b);c.stdout.emit('data',Buffer.from(JSON.stringify({result:reply})+'\n'));c.emit('exit',0);});return c;}}}[n])});
 const controller=module.exports.start(electron,root);
 return {controller,electron,spawns,timers,events,messages,states,styles,set chunks(v){chunks=v;},get quits(){return quits;},get menu(){return menu;},get window(){return window;},get handler(){return handler;},set reply(v){reply=v;}};
}
test('only a loaded healthy primary renderer arms cleanup; success remains visible during later update checks',async t=>{
 const a=setup(t);await Promise.resolve();const w=new a.electron.BrowserWindow({});w.url='app://-/index.html?initialRoute=%2F';
 w.webContents.emit('did-finish-load');const timer=a.timers.find(x=>x.ms===30000);assert.ok(timer);assert.equal(a.spawns.length,0);
 a.reply={ok:true,reclaimedBytes:1048576,rollbackRetained:true,warnings:[]};timer.fn();await new Promise(r=>setImmediate(r));assert.equal(a.spawns[0].args[1],'cleanup');assert.equal(a.controller.getState().cleanup.reclaimedBytes,1048576);
 await a.controller.action('check');assert.equal(a.controller.getState().cleanup.reclaimedBytes,1048576);
});
test('error/update pages, closed windows and crashed/reloaded renderers cannot provide premature health evidence',async t=>{
 const a=setup(t);await Promise.resolve();const w=new a.electron.BrowserWindow({});w.url='data:text/html,error';w.webContents.emit('did-finish-load');assert.equal(a.timers.filter(x=>x.ms===30000).length,0);
 w.url='app://-/index.html';w.webContents.emit('did-finish-load');const first=a.timers.filter(x=>x.ms===30000).at(-1);w.crashed=true;w.webContents.emit('render-process-gone');first.fn();assert.equal(a.spawns.length,0);
 w.crashed=false;w.webContents.emit('did-finish-load');const second=a.timers.filter(x=>x.ms===30000).at(-1);w.webContents.emit('did-finish-load');second.fn();assert.equal(a.spawns.length,0);assert.notEqual(a.timers.filter(x=>x.ms===30000).at(-1),second);
 w.destroyed=true;a.timers.filter(x=>x.ms===30000).at(-1).fn();assert.equal(a.spawns.length,0);
});
test('a hidden prewarmed renderer waits until its main interface is actually shown',async t=>{
 const a=setup(t);await Promise.resolve();const w=new a.electron.BrowserWindow({});let visible=false;w.isVisible=()=>visible;w.url='app://-/index.html';w.webContents.emit('did-finish-load');assert.equal(a.timers.filter(x=>x.ms===30000).length,0);
 visible=true;w.emit('show');assert.equal(a.timers.filter(x=>x.ms===30000).length,1);assert.equal(a.spawns.length,0);
});
test('a visible URL alone and a failed main-frame navigation do not confirm a successful load',async t=>{
 const a=setup(t);await Promise.resolve();const w=new a.electron.BrowserWindow({});w.url='app://-/index.html';w.emit('show');assert.equal(a.timers.filter(x=>x.ms===30000).length,0);
 w.webContents.emit('did-finish-load');const timer=a.timers.filter(x=>x.ms===30000).at(-1);w.webContents.emit('did-start-navigation',{},w.url,false,true);w.webContents.emit('did-fail-load',{},-2,'failed',w.url,true);timer.fn();assert.equal(a.spawns.length,0);
});
test('deferred cleanup retries are bounded and do not become update errors',async t=>{
 const a=setup(t);await Promise.resolve();const w=new a.electron.BrowserWindow({});w.url='app://-/index.html';w.webContents.emit('did-finish-load');a.reply={ok:true,deferred:true,reason:'INCOMPLETE_TRANSACTION',reclaimedBytes:0};
 for(let i=0;i<5;i++){a.timers.filter(x=>x.ms===30000).at(-1).fn();await new Promise(r=>setImmediate(r));}
 assert.equal(a.spawns.length,5);assert.equal(a.timers.filter(x=>x.ms===30000).length,5);assert.equal(a.controller.getState().phase,'idle');
});
test('cleanup summary reports reclaimed space without disabling available updates',async()=>{
 const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);};let render;
 const s={phase:'available',current:'0.6.4',available:'0.6.5',updateAvailable:true,cleanup:{ok:true,reclaimedBytes:1048576,rollbackRetained:true,warnings:[]}};
 vm.runInNewContext(fs.readFileSync(new URL('../desktop/update-ui.js',import.meta.url),'utf8'),{window:{codexOwnUpdates:{listen:fn=>{render=fn;},action:()=>Promise.resolve(s)}},document:{getElementById:get}});await Promise.resolve();
 assert.match(get('cleanup').textContent,/1\.0 MiB/);assert.equal(get('download').hidden,false);
 render({...s,cleanup:{ok:false}});assert.match(get('cleanup').textContent,/自动清理暂未完成/);assert.equal(get('download').hidden,false);
});
test('automatic checks mark the Mac menu and retain the notice across upstream menu rebuilds',async t=>{
 const a=setup(t,'darwin');await Promise.resolve();assert.equal(a.menu.getMenuItemById('codex-own-updates').label,'更新');
 a.timers[0].fn();await new Promise(r=>setImmediate(r));assert.equal(a.menu.getMenuItemById('codex-own-updates').label,'更新 ↓');
 const fresh=new a.electron.Menu();a.electron.Menu.setApplicationMenu(fresh);assert.equal(fresh.getMenuItemById('codex-own-updates').label,'更新 ↓');
 a.reply={ok:true,current:'0.2.2',updateAvailable:false};await a.controller.action('check');assert.equal(fresh.getMenuItemById('codex-own-updates').label,'更新');assert.equal(a.styles.size,0);
});
test('Windows custom title bar retains one download or ready badge through reload and repeated checks',async t=>{
 const a=setup(t,'win32');await Promise.resolve();const main=new a.electron.BrowserWindow({});
 await a.controller.action('check');await new Promise(r=>setImmediate(r));assert.match([...a.styles.values()].join(''),/content: " ↓"/);
 main.webContents.emit('did-finish-load');main.webContents.emit('did-finish-load');await new Promise(r=>setImmediate(r));assert.equal(a.styles.size,1);
 a.reply={ok:true,current:'0.2.2',available:'0.2.3',updateAvailable:true,receipt:'fixture'};await a.controller.action('download');await new Promise(r=>setImmediate(r));
 assert.equal(a.menu.getMenuItemById('codex-own-updates').label,'更新 ✓');assert.equal(a.styles.size,2);assert.ok([...a.styles.values()].every(css=>css.includes('content: " ✓"')));
 const count=a.spawns.length;await a.controller.action('check');assert.equal(a.spawns.length,count);
});
test('desktop menu survives upstream rebuilds; startup and interval checks use bundled runtime',async t=>{
 const a=setup(t);await Promise.resolve();assert.ok(a.menu.getMenuItemById('codex-own-updates'));
 const fresh=new a.electron.Menu();a.electron.Menu.setApplicationMenu(fresh);a.electron.Menu.setApplicationMenu(fresh);assert.equal(fresh.items.length,1);
 assert.deepEqual(a.timers.map(x=>x.ms),[15000,21600000]);
 await a.controller.action('check');assert.equal(a.controller.getState().phase,'available');assert.ok(a.window.file.endsWith('update.html'));
 assert.ok(a.spawns[0].exe.includes('own-updater'));assert.equal(a.spawns[0].opts.env.OPENAI_API_KEY,undefined);assert.equal(a.spawns[0].opts.env.NODE_OPTIONS,undefined);
 assert.equal(a.window.options.webPreferences.sandbox,true);assert.equal(a.window.options.webPreferences.nodeIntegration,false);
});
test('normal quit cancels a download cooperatively and waits for lock cleanup',async t=>{
 const a=setup(t);const pending=a.controller.action('download');let prevented=false;
 a.events['before-quit']({preventDefault:()=>{prevented=true;}});assert.equal(prevented,true);assert.equal(a.messages[0].cancel,true);assert.equal(a.quits,0);
 await pending;assert.equal(a.quits,1);
});
test('download progress preserves Chinese characters across pipe byte boundaries',async t=>{
 const a=setup(t);await a.controller.action('check');
 const bytes=Buffer.from(JSON.stringify({progress:'正在下载更新'})+'\n'),cut=bytes.indexOf(Buffer.from('正'))+1;
 a.chunks=[bytes.subarray(0,cut),bytes.subarray(cut)];await a.controller.action('download');
 assert.ok(a.states.some(s=>s.message==='正在下载更新'));
});
test('only the dedicated update window can download; ready state remains available without network',async t=>{
 const a=setup(t);await a.controller.action('check');
 assert.throws(()=>a.handler({sender:{},senderFrame:{}},'download'),/Forbidden/);
 assert.throws(()=>a.handler({sender:a.window.webContents,senderFrame:{}},'download'),/Forbidden/);
 a.reply={ok:true,current:'0.2.2',available:'0.2.3',updateAvailable:true,receipt:'fixture'};
 await a.handler({sender:a.window.webContents,senderFrame:a.window.webContents.mainFrame},'download');assert.equal(a.controller.getState().phase,'ready');
 const count=a.spawns.length;await a.controller.action('check');assert.equal(a.spawns.length,count);
});
