import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'own-ui-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'own-updater'));fs.writeFileSync(path.join(root,'own-updater','desktop-version.json'),'{"version":"0.2.2"}');
 let handler,menu,window,reply={ok:true,current:'0.2.2',available:'0.2.3',updateAvailable:true},quits=0;const spawns=[],timers=[],events={},messages=[];
 class Menu{constructor(){this.items=[];}append(x){this.items.push(x);}getMenuItemById(id){return this.items.find(i=>i.id===id);}}Menu.setApplicationMenu=m=>{menu=m;};Menu.getApplicationMenu=()=>menu;
 class Window extends EventEmitter{constructor(options){super();this.options=options;this.webContents=new EventEmitter();Object.assign(this.webContents,{mainFrame:{},setWindowOpenHandler:()=>{},send:()=>{}});window=this;}isDestroyed(){return false;}loadFile(f){this.file=f;}show(){}focus(){}}
 const electron={app:{whenReady:()=>Promise.resolve(),on:(n,fn)=>{events[n]=fn;},quit:()=>{quits++;}},BrowserWindow:Window,Menu,MenuItem:class{constructor(opts){Object.assign(this,opts)}},ipcMain:{handle:(_c,h)=>{handler=h;}},dialog:{}};
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(new URL('../desktop/controller.cjs',import.meta.url),'utf8'),{module,process:{platform:process.platform,resourcesPath:root,env:{OPENAI_API_KEY:'fixture',NODE_OPTIONS:'--bad',PATH:'path'}},setTimeout:(fn,ms)=>{timers.push({fn,ms});return{unref(){}}},setInterval:(fn,ms)=>{timers.push({fn,ms});return{unref(){}}},require:n=>({'node:fs':fs,'node:path':path,'node:child_process':{spawn:(exe,args,opts)=>{spawns.push({exe,args,opts});const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.unref=()=>{};c.connected=true;c.send=(m,fn)=>{messages.push(m);fn();};queueMicrotask(()=>{c.stdout.emit('data',Buffer.from(JSON.stringify({result:reply})+'\n'));c.emit('exit',0);});return c;}}}[n])});
 const controller=module.exports.start(electron,root);
 return {controller,electron,spawns,timers,events,messages,get quits(){return quits;},get menu(){return menu;},get window(){return window;},get handler(){return handler;},set reply(v){reply=v;}};
}
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
test('only the dedicated update window can download; ready state remains available without network',async t=>{
 const a=setup(t);await a.controller.action('check');
 assert.throws(()=>a.handler({sender:{},senderFrame:{}},'download'),/Forbidden/);
 assert.throws(()=>a.handler({sender:a.window.webContents,senderFrame:{}},'download'),/Forbidden/);
 a.reply={ok:true,current:'0.2.2',available:'0.2.3',updateAvailable:true,receipt:'fixture'};
 await a.handler({sender:a.window.webContents,senderFrame:a.window.webContents.mainFrame},'download');assert.equal(a.controller.getState().phase,'ready');
 const count=a.spawns.length;await a.controller.action('check');assert.equal(a.spawns.length,count);
});
