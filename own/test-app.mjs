import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {verifyTranslations} from './builders/i18n.mjs';
import {verifyUpdater} from './builders/updater.mjs';
import {createRequire} from 'node:module';
import {updateMenuChanges} from './builders/update-menu.mjs';
import {verifyWindowsIcon} from './builders/windows-icon.mjs';
import {verifyWindowsAgentShell} from './ci/windows-shell-qa.mjs';
const app=path.resolve(process.argv[2]),mac=process.platform==='darwin';
console.log(JSON.stringify({i18n:verifyTranslations(app)}));
console.log(JSON.stringify({updater:verifyUpdater(path.join(app,mac?'Contents/Resources':'resources'))}));
if(!mac){assert.equal(updateMenuChanges(createRequire(import.meta.url)('@electron/asar'),path.join(app,'resources','app.asar')).size,0,'Windows standalone update menu missing');console.log(JSON.stringify({standaloneUpdateMenu:true,icon:verifyWindowsIcon(app)}));}
const home=fs.mkdtempSync(path.join(os.tmpdir(),'own-isolation-'));
fs.writeFileSync(path.join(home,'config.toml'),'cli_auth_credentials_store = "file"\nforced_login_method = "api"\n',{flag:'wx',mode:0o600});
const env={...process.env};for(const k of Object.keys(env))if(/^(CODEX_|OPENAI_|CHATGPT_|ELECTRON_|NODE_REPL_)/.test(k))delete env[k];env.CODEX_HOME=home;
const cli=path.join(app,mac?'Contents/Resources/codex-own-cli':'resources/codex.exe');
if(!mac)console.log(JSON.stringify({agentShell:await verifyWindowsAgentShell({cli,adapterPath:path.join(app,'resources','own-updater','lib','windows-agent-shell.cjs'),catalog:path.join(import.meta.dirname,'defaults','models.json')})}));
const child=spawn(cli,['app-server','--stdio'],{env,stdio:['pipe','pipe','pipe']});let buffer='',id=0;const pending=new Map();
child.stdout.on('data',b=>{buffer+=b;for(;;){const i=buffer.indexOf('\n');if(i<0)break;const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{const m=JSON.parse(line),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}}catch{}}});
child.stderr.on('data',()=>{});child.on('error',e=>{for(const p of pending.values())p.reject(e)});child.on('exit',()=>{for(const p of pending.values())p.reject(Error('CLI exited'))});
const timer=setTimeout(()=>{for(const p of pending.values())p.reject(Error('CLI timeout'));child.kill();},30000);
const call=(method,params)=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
try{await call('initialize',{clientInfo:{name:'own-release-test',title:'own release test',version:'1.0.0'},capabilities:{experimentalApi:true}});child.stdin.write('{"method":"initialized"}\n');const threads=await call('thread/list',{limit:10});assert.deepEqual(threads.data,[]);const account=await call('account/read',{refreshToken:false});assert.equal(account.account,null);console.log(JSON.stringify({ok:true,isolatedThreads:0,account:null}));}finally{clearTimeout(timer);child.kill();}
