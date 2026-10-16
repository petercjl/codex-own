import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {assembleNpmAsset,validateParts} from './npm-assets.mjs';
import {paths,locked,rejectLinks,exclusive,unpack,fail,tarExecutable,digestFile} from './manager.mjs';
const require=createRequire(import.meta.url);
export const toolEnv=require('./tool-env.cjs');
export function validateRuntime(m,platform){
 if(m?.schema!==1||!/^node\d+\.\d+\.\d+-python\d+\.\d+\.\d+-r\d+$/.test(m.version))fail('INVALID_RUNTIME_MANIFEST','Invalid runtime identity');
 const a=m.platforms?.[platform];if(!a)fail('RUNTIME_UNAVAILABLE',platform);
 for(const name of ['node','python']){const s=a[name];if(!s||!/^[a-f0-9]{64}$/.test(s.sha256)||!Number.isSafeInteger(s.size)||s.size<1||s.size>128*1048576||!['zip','tar.gz'].includes(s.format)||!(/^[a-zA-Z0-9.+_-]+$/).test(s.entry))fail('INVALID_RUNTIME_MANIFEST','Invalid runtime asset');validateParts(s);}
 return a;
}
function writeActive(base,r){
 const f=path.join(base,'active.json');rejectLinks(f);
 if(fs.existsSync(f))fs.copyFileSync(f,f+'.backup-'+crypto.randomUUID(),fs.constants.COPYFILE_EXCL);
 const tmp=f+'.new-'+crypto.randomUUID();exclusive(tmp,r);fs.renameSync(tmp,f);
}
export function runtimeDoctor(base=toolEnv.runtimeRoot(),{version}={}){
 try{const r=toolEnv.active(base,process.platform,version);if(!r)return {ok:false,code:'RUNTIME_NOT_INSTALLED',root:base};
  const env=toolEnv.environment(base,process.env,process.platform,version),run=(file,args)=>execFileSync(file,args,{encoding:'utf8',env,windowsHide:true,timeout:30000}).trim();
  return {ok:true,contract:1,version:r.version,root:base,node:{path:r.node,version:run(r.node,['--version'])},npm:{path:r.npm,version:run(r.node,[r.npm,'--version'])},python:{path:r.python,version:run(r.python,['--version']),pip:run(r.python,['-m','pip','--version'])}};
 }catch(e){return {ok:false,code:'RUNTIME_INVALID',root:base,message:e.message};}
}
// Lock is shared with app installation. Updates keep immutable versions, so an
// already running app continues using its old tools until it restarts.
export async function ensureRuntime(m,{p=paths(),assemble=assembleNpmAsset,report=()=>{},localAssets,signal}={}){
 const assets=validateRuntime(m,p.platform),base=path.join(p.root,'runtimes');rejectLinks(base);fs.mkdirSync(base,{recursive:true,mode:0o700});
 const previous=toolEnv.active(base),target=path.join(base,'versions',m.version);rejectLinks(target);
 if(previous?.version===m.version){const d=runtimeDoctor(base);if(!d.ok)fail(d.code,d.message||'Invalid private runtime');return {...d,unchanged:true};}
 if(fs.existsSync(target))fail('RUNTIME_VERSION_EXISTS','Existing runtime version preserved; inspect runtime doctor and receipt before recovery');
 fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
 const stage=fs.mkdtempSync(path.join(base,'stage-')),candidate=path.join(stage,'candidate');fs.mkdirSync(candidate);let created=false,committed=false;
 try{
  for(const name of ['node','python']){
   const a=assets[name],archive=path.join(stage,name+'.'+a.format);report(`安装独立 ${name} 运行时`);
   if(localAssets?.[name]){if(fs.statSync(localAssets[name]).size!==a.size||await digestFile(localAssets[name])!==a.sha256)fail('CHECKSUM_MISMATCH','Local runtime checksum mismatch');fs.copyFileSync(localAssets[name],archive,fs.constants.COPYFILE_EXCL);}
   else await assemble(a,archive,path.join(base,'npm-assets'),tarExecutable(),{report,signal});
   const extracted=path.join(stage,name+'-unpacked');unpack(archive,extracted);
   if(fs.readdirSync(extracted).some(n=>n!==a.entry))fail('UNSAFE_ARCHIVE','Unexpected runtime archive root');
   fs.renameSync(path.join(extracted,a.entry),path.join(candidate,name));
  }
  const shims=path.join(candidate,'shims');fs.mkdirSync(shims);
  if(process.platform==='win32'){
   for(const name of ['python','python3','pip','pip3'])fs.writeFileSync(path.join(shims,name+'.cmd'),`@echo off\r\n"%~dp0..\\python\\python.exe" ${name.startsWith('pip')?'-m pip ':''}%*\r\n`,{flag:'wx'});
   for(const name of ['npm','npx'])fs.writeFileSync(path.join(shims,name+'.cmd'),`@echo off\r\n"%~dp0..\\node\\node.exe" "%~dp0..\\node\\node_modules\\npm\\bin\\${name}-cli.js" %*\r\n`,{flag:'wx'});
  }else{
   fs.symlinkSync('../python/bin/python3',path.join(shims,'python'));fs.symlinkSync('../python/bin/python3',path.join(shims,'python3'));
   for(const name of ['pip','pip3'])fs.writeFileSync(path.join(shims,name),'#!/bin/sh\nexec "$(dirname "$0")/../python/bin/python3" -m pip "$@"\n',{flag:'wx',mode:0o755});
  }
  for(const name of ['npmrc','global-npmrc']){const f=path.join(base,name);rejectLinks(f);if(!fs.existsSync(f))fs.writeFileSync(f,'# codex-own isolated npm configuration\n',{flag:'wx',mode:0o600});}
  for(const name of ['npm-global','npm-cache','pip-cache','python-user']){rejectLinks(path.join(base,name));fs.mkdirSync(path.join(base,name),{recursive:true,mode:0o700});}
  // Windows scanners may hold executables after execution. Never rename an
  // executed tool directory: copy to a fresh immutable final path, probe there,
  // and only then atomically switch the small active receipt.
  fs.mkdirSync(target);created=true;fs.cpSync(candidate,target,{recursive:true,force:false,errorOnExist:true,verbatimSymlinks:true});
  if(process.platform==='darwin'){const shell=path.join(target,'shell');fs.mkdirSync(shell);for(const [name,body]of Object.entries(toolEnv.shellFiles(base,m.version)))fs.writeFileSync(path.join(shell,name),body,{flag:'wx',mode:0o600});}
  const tested=runtimeDoctor(base,{version:m.version});if(!tested.ok)fail('RUNTIME_PROBE_FAILED',tested.message||'Tool verification failed');
  const expected=m.version.match(/^node([0-9.]+)-python([0-9.]+)-/);
  if(tested.node.version!=='v'+expected[1]||tested.python.version!=='Python '+expected[2])fail('RUNTIME_VERSION_MISMATCH','Runtime executable versions do not match manifest');
  if(signal?.aborted)fail('CANCELLED','Runtime installation cancelled');
  exclusive(path.join(target,'codex-own-runtime.json'),{schema:1,version:m.version,platform:p.platform,assets:{node:assets.node.sha256,python:assets.python.sha256},verified:tested});
  writeActive(base,{schema:1,version:m.version,platform:p.platform,previous:previous?.version||null,installedAt:new Date().toISOString()});
  committed=true;
  return runtimeDoctor(base);
 }finally{for(const f of [stage,...(created&&!committed?[target]:[])])try{fs.rmSync(f,{recursive:true,force:true,maxRetries:10,retryDelay:200});}catch{report(`临时目录被系统占用，已保留：${f}`);}}
}
export async function installRuntime(m,options={}){const p=options.p||paths();return locked(p,()=>ensureRuntime(m,{...options,p}));}
export async function rollbackRuntime({p=paths()}={}){return locked(p,async()=>{
 const base=path.join(p.root,'runtimes'),r=toolEnv.active(base);if(!r?.previous)fail('NO_RUNTIME_ROLLBACK','No previous runtime');
 const f=path.join(base,'versions',r.previous,'codex-own-runtime.json');rejectLinks(f);const old=JSON.parse(fs.readFileSync(f));
 if(old.version!==r.previous||old.platform!==p.platform)fail('INVALID_RUNTIME_RECEIPT','Previous runtime does not match');
 const checked=runtimeDoctor(base,{version:r.previous});if(!checked.ok)fail('RUNTIME_INVALID','Previous runtime verification failed; active tools preserved');
 writeActive(base,{schema:1,version:r.previous,platform:p.platform,previous:r.version,installedAt:new Date().toISOString()});return runtimeDoctor(base);
 });}
export function runRuntime(args){if(!args.length)fail('COMMAND_REQUIRED','runtime run -- <node|npm|npx|python|python3|pip> [args]');const base=toolEnv.runtimeRoot(),r=toolEnv.active(base);if(!r)fail('RUNTIME_NOT_INSTALLED','Install codex-own runtime first');
 const [name,...rest]=args;const command=name==='node'?{file:r.node,args:rest}:['npm','npx'].includes(name)?{file:r.node,args:[name==='npm'?r.npm:path.join(path.dirname(r.npm),'npx-cli.js'),...rest]}:['python','python3','pip'].includes(name)?{file:r.python,args:[...(name==='pip'?['-m','pip']:[]),...rest]}:null;
 if(!command)fail('INVALID_COMMAND','Supported tools: node, npm, npx, python, python3, pip');
 const out=spawnSync(command.file,command.args,{env:toolEnv.environment(base),stdio:'inherit',windowsHide:true});if(out.error)throw out.error;return out.status??1;
}
