import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {X509Certificate} from 'node:crypto';import {execFileSync} from 'node:child_process';
export const developmentSigningRoot=()=>path.join(os.userInfo().homedir,'Library/Application Support/codex-own-development-signing');
export const releaseSigningRoot=()=>path.join(os.userInfo().homedir,'Library/Application Support/codex-own-release-signing');
const failure=(code,message)=>Object.assign(Error(message),{code});
export function sealMacBundle(app,signing,{development=false,run=execFileSync}={}){
 run('codesign',['--force','--deep',...signing,app],{stdio:'pipe'});
 if(!development){
  // Deep signing derives auxiliary executable IDs from filenames. Pin the
  // actual process afterward, then reseal only the outer bundle.
  run('codesign',['--force',...signing,'--identifier','local.codex-own',path.join(app,'Contents/MacOS/ChatGPT')],{stdio:'pipe'});
  run('codesign',['--force',...signing,app],{stdio:'pipe'});
 }
}
export function verifyMacReleaseSignature(app,{run=execFileSync,policy=JSON.parse(fs.readFileSync(new URL('./release-signing.json',import.meta.url)))}={}){
 if(policy.schema!==1||policy.bundleIdentifier!=='local.codex-own'||!/^[0-9A-F]{40}$/.test(policy.sha1))throw failure('RELEASE_SIGNING_INVALID','Invalid pinned release signing identity.');
 const requirement=`=identifier "local.codex-own" and certificate leaf = H"${policy.sha1.toLowerCase()}"`;
 try{for(const target of [app,path.join(app,'Contents/MacOS/ChatGPT')])run('codesign',['--verify','--deep','--strict','--all-architectures','-R',requirement,target],{stdio:'pipe'});}catch{throw failure('RELEASE_SIGNING_MISMATCH','The formal app or native main executable differs from the pinned release identity.');}
 return {ok:true,sha1:policy.sha1,bundleIdentifier:policy.bundleIdentifier};
}
// Certificate trust and privacy grants remain explicit macOS user decisions.
// Builds only reuse a provisioned local identity; never rotate it or silently
// fall back to an ad-hoc signature, which would invalidate saved permissions.
export function macSigningArguments(development,{root=development?developmentSigningRoot():process.env.OWN_MAC_SIGNING_ROOT||releaseSigningRoot(),run=execFileSync,certificate=bytes=>new X509Certificate(bytes),policy}={}){
 const channel=development?'DEVELOPMENT':'RELEASE',keychainName=development?'development.keychain-db':'release.keychain-db';
 const code=suffix=>channel+'_SIGNING_'+suffix;
 const files=['identity.json','certificate.pem','keychain-password',keychainName];
 for(const name of ['',...files]){
  const file=path.join(root,name);let s;try{s=fs.lstatSync(file);}catch{throw failure(code('MISSING'),'Provision the dedicated signing identity before building.');}
  if(s.isSymbolicLink()||(name?!s.isFile():!s.isDirectory())||(s.mode&0o077))throw failure(code('UNSAFE'),'Signing files must be private regular files in a private directory.');
 }
 const identity=JSON.parse(fs.readFileSync(path.join(root,'identity.json'),'utf8'));
 if(identity.schema!==1||identity.bundleIdentifier!==(development?'local.codex-own.development':'local.codex-own')||!/^[0-9A-F]{40}$/.test(identity.sha1))throw failure(code('INVALID'),'Invalid signing manifest.');
 if(!development){const pinned=policy||JSON.parse(fs.readFileSync(new URL('./release-signing.json',import.meta.url)));if(pinned.schema!==1||pinned.bundleIdentifier!=='local.codex-own'||pinned.sha1!==identity.sha1)throw failure(code('INVALID'),'Release signer differs from the pinned public identity.');}
 const cert=certificate(fs.readFileSync(path.join(root,'certificate.pem')));
 if(cert.fingerprint.replaceAll(':','')!==identity.sha1||!Number.isFinite(Date.parse(cert.validTo))||Date.parse(cert.validTo)<Date.now()+86400000)throw failure(code('INVALID'),'Signing certificate differs from its manifest or is expiring. Preserve it for recovery.');
 const password=fs.readFileSync(path.join(root,'keychain-password'),'utf8').trim();if(!/^[a-f0-9]{64}$/.test(password))throw failure(code('INVALID'),'Invalid signing keychain credential.');
 const keychain=path.join(root,keychainName),quoted='"'+keychain.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"';
 // Feed the unlock command through stdin so its password is absent from argv.
 try{run('/usr/bin/security',['-i'],{input:`unlock-keychain -p ${password} ${quoted}\n`,stdio:['pipe','pipe','pipe']});}catch{throw failure(code('LOCKED'),'Unable to unlock the dedicated signing keychain.');}
 const valid=run('/usr/bin/security',['find-identity','-v','-p','codesigning',keychain],{encoding:'utf8',stdio:['pipe','pipe','pipe']});
 if(!valid.includes(identity.sha1))throw failure(code('TRUST_REQUIRED'),'macOS must trust this dedicated certificate for code signing before it can be used.');
 return ['--sign',identity.sha1,'--keychain',keychain,'--timestamp=none'];
}
export function withMacSigning(development,operation,options={}){
 const signing=macSigningArguments(development,options);
 const root=path.dirname(signing[3]),run=options.run||execFileSync,keychain=signing[3],lock=path.join(root,'signing.lock');
 if(fs.existsSync(lock))throw failure((development?'DEVELOPMENT':'RELEASE')+'_SIGNING_BUSY','Another signing operation holds the dedicated keychain.');
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
