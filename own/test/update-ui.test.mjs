import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {StringDecoder} from 'node:string_decoder';
function setup(t,platform=process.platform){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'own-ui-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'own-updater'));fs.writeFileSync(path.join(root,'own-updater','desktop-version.json'),'{"version":"0.2.2"}');
 let handler,menu,window,reply={ok:true,current:'0.2.2',available:'0.2.3',updateAvailable:true},quits=0,chunks=[];const spawns=[],timers=[],events={},messages=[],states=[],windows=[],styles=new Map();let styleId=0;
 class Menu{constructor(){this.items=[];}append(x){this.items.push(x);}getMenuItemById(id){return this.items.find(i=>i.id===id);}}Menu.setApplicationMenu=m=>{menu=m;};Menu.getApplicationMenu=()=>menu;
 class Window extends EventEmitter{static getAllWindows(){return windows;}constructor(options){super();this.options=options;this.webContents=new EventEmitter();Object.assign(this.webContents,{mainFrame:{},isDestroyed:()=>false,insertCSS:async css=>{const key=String(++styleId);styles.set(key,css);return key;},removeInsertedCSS:async key=>{styles.delete(key);},setWindowOpenHandler:()=>{},send:(_channel,state)=>{states.push({...state});}});windows.push(this);window=this;events['browser-window-created']?.({},this);}isDestroyed(){return false;}loadFile(f){this.file=f;}show(){}focus(){}}
 const electron={app:{whenReady:()=>Promise.resolve(),on:(n,fn)=>{events[n]=fn;},quit:()=>{quits++;}},BrowserWindow:Window,Menu,MenuItem:class{constructor(opts){Object.assign(this,opts)}},ipcMain:{handle:(_c,h)=>{handler=h;}},dialog:{}};
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(new URL('../desktop/controller.cjs',import.meta.url),'utf8'),{module,process:{platform,resourcesPath:root,env:{OPENAI_API_KEY:'fixture',NODE_OPTIONS:'--bad',PATH:'path'}},setTimeout:(fn,ms)=>{timers.push({fn,ms});return{unref(){}}},setInterval:(fn,ms)=>{timers.push({fn,ms});return{unref(){}}},require:n=>({'node:fs':fs,'node:path':path,'node:string_decoder':{StringDecoder},'node:child_process':{spawn:(exe,args,opts)=>{spawns.push({exe,args,opts});const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.unref=()=>{};c.connected=true;c.send=(m,fn)=>{messages.push(m);fn();};queueMicrotask(()=>{for(const b of chunks)c.stdout.emit('data',b);c.stdout.emit('data',Buffer.from(JSON.stringify({result:reply})+'\n'));c.emit('exit',0);});return c;}}}[n])});
 const controller=module.exports.start(electron,root);
 return {controller,electron,spawns,timers,events,messages,states,styles,set chunks(v){chunks=v;},get quits(){return quits;},get menu(){return menu;},get window(){return window;},get handler(){return handler;},set reply(v){reply=v;}};
}
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
