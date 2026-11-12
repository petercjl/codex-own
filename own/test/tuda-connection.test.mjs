import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {connectionOptions,verifyIndependentReady,connectionError} from '../lib/tuda-connection.mjs';
const caps=JSON.parse(fs.readFileSync(new URL('./fixtures/tuda-capabilities.json',import.meta.url)));
function fixture(t){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'own-connection-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('independent connection resolves standard or explicit existing Dev data without creating an App',t=>{
 const root=fixture(t),before=fs.readdirSync(root);assert.equal(connectionOptions(root,{platform:'darwin',home:root}).userDataPath,path.join(root,'Library/Application Support/Tuda'));assert.deepEqual(fs.readdirSync(root),before);
 const file=path.join(root,'tuda-connection.json');fs.writeFileSync(file,JSON.stringify({contract:1,userDataPath:root+'/dev-data'}),{flag:'wx',mode:0o600});assert.equal(connectionOptions(root).userDataPath,root+'/dev-data');assert(!fs.existsSync(root+'/dev-data'));
 fs.chmodSync(file,0o644);assert.throws(()=>connectionOptions(root),/INVALID/);
 fs.chmodSync(file,0o600);fs.writeFileSync(file,JSON.stringify({contract:1,userDataPath:root,appPath:'/unexpected.app'}));assert.throws(()=>connectionOptions(root),/INVALID/);
});
test('legacy shared authorization is rejected before credentials can be handed off; live versions are checked',t=>{
 const root=fixture(t);fs.mkdirSync(path.join(root,'dist'));for(const n of ['main.js','board-plugin.js','board-plugin.LICENSES.txt'])fs.writeFileSync(path.join(root,'dist',n),'fixture');for(const n of ['LICENSE','THIRD_PARTY_NOTICES.md'])fs.writeFileSync(path.join(root,n),'fixture');
 const file=path.join(root,'capabilities.json'),save=()=>fs.writeFileSync(file,JSON.stringify(caps));save();
 const value={schemaVersion:1,ok:true,data:{ready:true,protocolVersion:1,instanceId:'a'.repeat(64)}};
 assert.throws(()=>verifyIndependentReady(value,root),/SHARED_AUTH_UNSUPPORTED/);
 const isolation={contract:1,authScope:'connection',preservesDesktopSession:true};caps.nativePlugin.sharedDesktopSession=isolation;save();value.data.boardPlugin=isolation;value.data.desktopVersion='0.1.0';assert.equal(verifyIndependentReady(value,root),'a'.repeat(64));
 value.data.desktopVersion='0.0.1';assert.throws(()=>verifyIndependentReady(value,root),/INCOMPATIBLE/);value.data.desktopVersion='unknown';assert.throws(()=>verifyIndependentReady(value,root),/INCOMPATIBLE/);
 value.data.protocolVersion=2;assert.throws(()=>verifyIndependentReady(value,root),/INCOMPATIBLE/);
 assert.match(connectionError(Error('TUDA_INDEPENDENT_UNAVAILABLE')),/安装或打开独立 Tuda/);assert(!connectionError(Error('secret-bearer')).includes('secret-bearer'));
});
