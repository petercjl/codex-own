import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {X509Certificate} from 'node:crypto';import {execFileSync} from 'node:child_process';
export const developmentSigningRoot=()=>path.join(os.userInfo().homedir,'Library/Application Support/codex-own-development-signing');
const failure=(code,message)=>Object.assign(Error(message),{code});
// Certificate trust and privacy grants remain explicit macOS user decisions.
// Builds only reuse a provisioned local identity; never rotate it or silently
// fall back to an ad-hoc signature, which would invalidate saved permissions.
export function macSigningArguments(development,{root=developmentSigningRoot(),run=execFileSync,certificate=bytes=>new X509Certificate(bytes)}={}){
 if(!development)return ['--sign','-'];
 const files=['identity.json','certificate.pem','keychain-password','development.keychain-db'];
 for(const name of ['',...files]){
  const file=path.join(root,name);let s;try{s=fs.lstatSync(file);}catch{throw failure('DEVELOPMENT_SIGNING_MISSING','Provision the dedicated local development signing identity before building.');}
  if(s.isSymbolicLink()||(name?!s.isFile():!s.isDirectory())||(s.mode&0o077))throw failure('DEVELOPMENT_SIGNING_UNSAFE','Development signing files must be private regular files in a private directory.');
 }
 const identity=JSON.parse(fs.readFileSync(path.join(root,'identity.json'),'utf8'));
 if(identity.schema!==1||identity.bundleIdentifier!=='local.codex-own.development'||!/^[0-9A-F]{40}$/.test(identity.sha1))throw failure('DEVELOPMENT_SIGNING_INVALID','Invalid development signing manifest.');
 const cert=certificate(fs.readFileSync(path.join(root,'certificate.pem')));
 if(cert.fingerprint.replaceAll(':','')!==identity.sha1||Date.parse(cert.validTo)<Date.now()+86400000)throw failure('DEVELOPMENT_SIGNING_INVALID','Development certificate differs from the recorded identity or is expiring. Preserve it for recovery.');
 const password=fs.readFileSync(path.join(root,'keychain-password'),'utf8').trim();if(!/^[a-f0-9]{64}$/.test(password))throw failure('DEVELOPMENT_SIGNING_INVALID','Invalid development keychain credential.');
 const keychain=path.join(root,'development.keychain-db'),quoted='"'+keychain.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"';
 // Feed the unlock command through stdin so its password is absent from argv.
 try{run('/usr/bin/security',['-i'],{input:`unlock-keychain -p ${password} ${quoted}\n`,stdio:['pipe','pipe','pipe']});}catch{throw failure('DEVELOPMENT_SIGNING_LOCKED','Unable to unlock the dedicated development signing keychain.');}
 const valid=run('/usr/bin/security',['find-identity','-v','-p','codesigning',keychain],{encoding:'utf8',stdio:['pipe','pipe','pipe']});
 if(!valid.includes(identity.sha1))throw failure('DEVELOPMENT_SIGNING_TRUST_REQUIRED','macOS must trust the dedicated development certificate for code signing before it can be used.');
 return ['--sign',identity.sha1,'--keychain',keychain,'--timestamp=none'];
}
export function withMacSigning(development,operation,options={}){
 const signing=macSigningArguments(development,options);if(!development)return operation(signing);
 const root=options.root||developmentSigningRoot(),run=options.run||execFileSync,keychain=signing[3],lock=path.join(root,'signing.lock');
 if(fs.existsSync(lock))throw failure('DEVELOPMENT_SIGNING_BUSY','Another development signing operation holds the local keychain.');
 fs.mkdirSync(lock,{mode:0o700});
 const security=args=>run('/usr/bin/security',args,{encoding:'utf8',stdio:['pipe','pipe','pipe']});
 const list=()=>[...security(['list-keychains','-d','user']).matchAll(/"([^"]+)"/g)].map(x=>x[1]);let added=false;
 try{
  const before=list();
  // codesign requires the keychain in the search list even with --keychain.
  // Expose it only during signing; retain every existing user keychain.
  if(!before.includes(keychain)){security(['list-keychains','-d','user','-s',...before,keychain]);added=true;}
  return operation(signing);
 }finally{
  try{if(added)security(['list-keychains','-d','user','-s',...list().filter(x=>x!==keychain)]);}finally{fs.rmdirSync(lock);}
 }
}
