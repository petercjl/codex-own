import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {createRequire} from 'node:module';
if(process.env.GITHUB_ACTIONS!=='true')throw Error('Real installation smoke is restricted to an ephemeral GitHub runner');
const [directory,version]=process.argv.slice(2),output=path.resolve(directory),platform=process.platform+'-'+process.arch;
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'own-native-first-')),env={...process.env,HTTP_PROXY:'http://127.0.0.1:9',HTTPS_PROXY:'http://127.0.0.1:9',ALL_PROXY:'http://127.0.0.1:9',NO_PROXY:''};
const key=path.join(fixture,'api.txt');fs.writeFileSync(key,'sk-fixture-no-service-access',{flag:'wx',mode:0o600});
let volume,payload,run;
if(process.platform==='win32'){
 env.LOCALAPPDATA=path.join(fixture,'Local');env.APPDATA=path.join(fixture,'Roaming');env.PATH=process.env.SystemRoot+'\\System32;'+process.env.SystemRoot;
 const original=path.join(env.LOCALAPPDATA,'Programs','Codex','sentinel.txt');fs.mkdirSync(path.dirname(original),{recursive:true});fs.writeFileSync(original,'original-preserved',{flag:'wx'});
 const setup=path.join(output,`codex-own-${version}-windows-x64-setup.exe`);
 run=()=>execFileSync(setup,['/S','/APIKEYFILE='+key],{env,stdio:'inherit',windowsHide:true,timeout:600000});run();
 assert.equal(fs.readFileSync(original,'utf8'),'original-preserved');
 payload=path.join(env.LOCALAPPDATA,'Programs','codex-own','current','resources','own-updater');
 assert.ok(fs.existsSync(path.join(env.APPDATA,'Microsoft','Windows','Start Menu','Programs','codex-own','codex-own.lnk')));
}else{
 assert.equal(fs.existsSync('/Applications/codex-own.app'),false,'Ephemeral runner must start without codex-own');env.PATH='/usr/bin:/bin:/usr/sbin:/sbin';
 const require=createRequire(new URL('../package.json',import.meta.url)),mounted=require('plist').parse(execFileSync('hdiutil',['attach','-readonly','-nobrowse','-plist',path.join(output,`codex-own-${version}-mac-arm64.dmg`)],{encoding:'utf8'}));
 volume=mounted['system-entities'].find(e=>e['mount-point'])?.['mount-point'];assert.ok(volume);
 payload=path.join(volume,'codex-own 安装器.app','Contents','Resources');execFileSync('codesign',['--verify','--deep','--strict',path.dirname(path.dirname(payload))],{stdio:'inherit'});
 run=()=>execFileSync(path.join(payload,'engine','node'),[path.join(payload,'offline-install.mjs'),'--api-key-file',key],{env,stdio:'inherit',timeout:600000});run();
}
try{
 const lib=path.join(payload,process.platform==='win32'?'lib':'engine/lib'),node=path.join(payload,process.platform==='win32'?'node.exe':'engine/node');
 const inspect=`import fs from 'node:fs';import path from 'node:path';import{pathToFileURL}from'node:url';const base=process.argv[1],m=await import(pathToFileURL(path.join(base,'manager.mjs'))),tools=await import(pathToFileURL(path.join(base,'tool-runtime.mjs')));const p=m.paths(),s=m.state(p);if(!s||s.identity!=='local.codex-own'||s.releaseManifest?.binding?.managerVersion!==${JSON.stringify(version)})throw Error('Managed installation binding missing');if(!tools.runtimeDoctor().ok)throw Error('Private runtimes unavailable');if(JSON.parse(fs.readFileSync(path.join(p.core,'auth.json'))).auth_mode!=='apikey')throw Error('API configuration missing');console.log(JSON.stringify({root:p.root,core:p.core,target:p.target,desktop:s.version,manager:s.releaseManifest.binding.managerVersion}));`;
 const snapshot=()=>JSON.parse(execFileSync(node,['--input-type=module','-e',inspect,lib],{env,encoding:'utf8'}));const first=snapshot();
 const sentinel=path.join(first.core,'installer-preservation-sentinel.txt');fs.writeFileSync(sentinel,'configuration-and-chat-preserved',{flag:'wx',mode:0o600});
 run();const second=snapshot();assert.equal(second.target,first.target);assert.equal(fs.readFileSync(sentinel,'utf8'),'configuration-and-chat-preserved');
 const smoke=`import fs from 'node:fs';import path from'node:path';import{pathToFileURL}from'node:url';const base=process.argv[1],m=await import(pathToFileURL(path.join(base,'manager.mjs'))),u=await import(pathToFileURL(path.join(base,'app-update.mjs')));const s=m.state(),manifest=s.releaseManifest;const r=await u.prepareUpdate(s.version,{resolve:async()=>manifest.binding.managerVersion,manifest:async()=>manifest});if(!r.unchanged)throw Error('Native first install not adopted by existing updater');console.log(JSON.stringify({ok:true,updaterRecognizesInstallation:true,zeroNetwork:true}));`;
 execFileSync(node,['--input-type=module','-e',smoke,lib],{env,stdio:'inherit'});
 fs.writeFileSync(path.join(output,`installer-qa-${platform}.json`),JSON.stringify({schema:1,version,platform,offline:true,noSystemNodeNpmPython:true,repeatInstallPreservesData:true,apiFileConfigured:true,existingUpdaterRecognizesInstallation:true,nativeWindowsSetupExecuted:process.platform==='win32',macDmgWorkerExecuted:process.platform==='darwin',interactiveGuiTested:false},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({ok:true,platform,version,offline:true,repeatInstall:true}));
}finally{if(volume)execFileSync('hdiutil',['detach',volume],{stdio:'inherit'});}
