import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url),provider=require('../lib/image-provider.cjs'),bridge=require('../lib/subagent-bridge.cjs');
function fixture(t){const core=fs.mkdtempSync(path.join(os.tmpdir(),'own-image-provider-'));t.after(()=>fs.rmSync(core,{recursive:true,force:true}));return core;}
test('default image provider works before a preference file exists and persists through restart',t=>{
 const core=fixture(t);assert.equal(provider.status(core).provider,'toapiscli');assert.equal(provider.read(core).model,'gpt-image-2.6-sunburst');assert(!fs.existsSync(path.join(core,'image-provider.json')));
 assert.throws(()=>provider.save(core,'unknown'),{code:'IMAGE_PROVIDER_INVALID'});assert(!fs.existsSync(path.join(core,'image-provider.json')));
 provider.save(core,'toapiscli');assert.equal(provider.read(core).provider,'toapiscli');if(process.platform!=='win32')assert.equal(fs.statSync(path.join(core,'image-provider.json')).mode&0o777,0o600);
 fs.writeFileSync(path.join(core,'image-provider.json'),'{"schema":1,"provider":"missing"}');assert.throws(()=>provider.read(core),{code:'IMAGE_PROVIDER_INVALID'});
});
test('default model migrates old preferences, persists selection and reaches the routing policy',t=>{
 const core=fixture(t),file=path.join(core,'image-provider.json');fs.writeFileSync(file,'{"schema":1,"provider":"toapiscli"}');
 assert.equal(provider.read(core).model,'gpt-image-2.6-sunburst');provider.save(core,'toapiscli','gpt-image-2.6-sunburst');
 assert.equal(JSON.parse(fs.readFileSync(file)).model,'gpt-image-2.6-sunburst');assert(fs.readdirSync(core).some(n=>n.startsWith('image-provider.json.backup-')));
 provider.save(core,'toapiscli','gemini-nano-banana-2.1');provider.save(core,'toapiscli');assert.equal(provider.read(core).model,'gemini-nano-banana-2.1');
 const policy=provider.apply({instructions:'Existing',input:[]},core).instructions;assert(policy.includes('default image model is gemini-nano-banana-2.1'));assert(policy.includes('explicit model choice in the current task takes precedence'));
 const previous=fs.readFileSync(file);assert.throws(()=>provider.save(core,'toapiscli','unknown'),{code:'IMAGE_MODEL_INVALID'});assert.deepEqual(fs.readFileSync(file),previous);
});
test('routing preserves ordinary tools and history while filtering native and discovered image providers',t=>{
 const core=fixture(t),tools=[{type:'image_generation'},{type:'namespace',name:'image_gen',tools:[{name:'imagegen'}]},{type:'namespace',name:'mcp__canva',tools:[{name:'generate_image'},{name:'search_designs'}]},{type:'function',name:'exec_command'}];
 const input=[{type:'tool_search_output',call_id:'lookup',tools},{type:'message',role:'user',content:'Generate an image'}];
 const body={model:'fixture',instructions:'Existing instructions',tools,input};const result=provider.apply(body,core);
 assert.equal(body.tools.length,4);assert.equal(result.tools.length,2);assert.deepEqual(result.tools[0].tools,[{name:'search_designs'}]);assert.equal(result.input[0].tools.length,2);assert.equal(result.input[1],input[1]);
 assert(result.instructions.startsWith('Existing instructions'));assert(result.instructions.includes(JSON.stringify(path.join(core,'skills/toapiscli/SKILL.md'))));assert(result.instructions.includes('Preserve sandbox and network approval'));
 assert.equal(provider.apply(result,core).instructions,result.instructions);
});
test('actual HTTP bridge applies current provider policy before forwarding every model request',async t=>{
 const core=fixture(t);let forwarded;
 const server=await bridge.startServer({upstream:'https://fixture.invalid/v1',prepareBody:body=>provider.apply(body,core),fetch:async(_url,options)=>{forwarded=JSON.parse(options.body);return new Response('{"output":[]}',{headers:{'content-type':'application/json'}});}});t.after(()=>server.close());
 const result=await fetch(server.url+'/responses',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'fixture',input:[],tools:[{type:'image_generation'},{type:'function',name:'exec_command'}]})});
 assert.equal(result.status,200);assert(forwarded.instructions.includes('selected toapiscli'));assert.deepEqual(forwarded.tools,[{type:'function',name:'exec_command'}]);
});
test('profile settings open the native settings route and main-frame IPC stores the image preference',async t=>{
 const core=fixture(t),handlers=new Map(),windows=[];
 const previous=process.resourcesPath;process.resourcesPath=core;t.after(()=>{if(previous===undefined)delete process.resourcesPath;else process.resourcesPath=previous;});
 const {start,CHANNEL,DISPLAY}=require('../desktop/account.cjs');
 const app=new EventEmitter();app.whenReady=()=>Promise.resolve();
 class Window{constructor(options){this.options=options;windows.push(this);this.webContents=new EventEmitter();this.webContents.send=()=>{};this.webContents.setWindowOpenHandler=()=>{};}isDestroyed(){return false;}loadFile(file){this.file=file;}on(){}show(){}focus(){}}
 let opened=0;const Menu={setApplicationMenu(){},getApplicationMenu:()=>({items:[{label:'设置…',click:()=>{opened++;}}]})};
 Menu.getApplicationMenu=()=>({items:[{label:'设置…',click:()=>{opened++;}}],getMenuItemById:()=>true});
 start({app,BrowserWindow:Window,Menu,MenuItem:class{},ipcMain:{handle:(n,f)=>handlers.set(n,f)},shell:{}},core,{loadClient:async()=>({loginStatus:async()=>({authenticated:true,name:'Test'})})});t.after(()=>app.emit('before-quit'));
 await new Promise(r=>setImmediate(r));
 const web=new EventEmitter();web.mainFrame={url:'app://-/index.html'};web.getURL=()=>web.mainFrame.url;web.send=()=>{};web.isDestroyed=()=>false;app.emit('browser-window-created',{}, {webContents:web});
 const event={sender:web,senderFrame:web.mainFrame};await handlers.get(DISPLAY)(event,'settings');
 assert.equal(windows.length,0);assert.equal(opened,1);
 assert.equal((await handlers.get(DISPLAY)(event,'image-settings')).provider,'toapiscli');
 assert.equal((await handlers.get(DISPLAY)(event,'save-image-settings',{provider:'toapiscli'})).provider,'toapiscli');
 await assert.rejects(handlers.get(DISPLAY)(event,'save-image-settings',{provider:'invented'}),{code:'IMAGE_PROVIDER_INVALID'});
 await assert.rejects(handlers.get(DISPLAY)({...event,senderFrame:{url:'https://foreign.example'}},'save-image-settings',{provider:'toapiscli'}),/Invalid account display sender/);
});
