// Exercise real macOS signatures without opening a user's profile or granting privacy access.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {execFileSync,spawnSync} from 'node:child_process';
import {withMacSigning,verifyMacReleaseSignature,sealMacBundle} from '../builders/mac-signing.mjs';
if(process.platform!=='darwin')throw Error('Native release signing verification requires macOS');
const out=path.resolve(process.argv[2]);if(fs.existsSync(out))throw Error('Choose a fresh signing verification directory');fs.mkdirSync(out,{recursive:true,mode:0o700});
const apps=[],evidence=[];
const info='<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>local.codex-own</string><key>CFBundleName</key><string>codex-own signing verification</string><key>CFBundleExecutable</key><string>codex-own-launch</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>';
const describe=(target)=>{const p=spawnSync('codesign',['-d','-r-','-vvvv',target],{encoding:'utf8'});assert.equal(p.status,0);const text=p.stdout+p.stderr;const requirement=text.match(/^designated => (.+)$/m)?.[1],cdhash=text.match(/^CDHash=(.+)$/m)?.[1];assert.ok(requirement);assert.ok(cdhash);return {requirement,cdhash};};
try{
 for(const [index,name]of ['first','second'].entries()){
  const app=path.join(out,name+'.app'),contents=path.join(app,'Contents'),macos=path.join(contents,'MacOS');fs.mkdirSync(macos,{recursive:true});apps.push(app);
  fs.writeFileSync(path.join(contents,'Info.plist'),info,{flag:'wx',mode:0o600});
  fs.writeFileSync(path.join(macos,'codex-own-launch'),'#!/bin/sh\nexec "$(dirname "$0")/ChatGPT"\n',{flag:'wx',mode:0o700});
  const source=path.join(out,name+'.c'),binary=path.join(macos,'ChatGPT');fs.writeFileSync(source,`#include <stdio.h>\nint main(void){puts("release signing build ${index}");return ${index};}\n`,{flag:'wx',mode:0o600});
  execFileSync('xcrun',['clang',source,'-o',binary],{stdio:'pipe'});
  withMacSigning(false,signing=>sealMacBundle(app,signing));
  verifyMacReleaseSignature(app);evidence.push({name,app:describe(app),native:describe(binary)});
 }
 assert.notEqual(evidence[0].native.cdhash,evidence[1].native.cdhash,'Fixture native builds must have different code hashes');
 for(const kind of ['app','native'])assert.equal(evidence[0][kind].requirement,evidence[1][kind].requirement,'Release identity must survive changed native bytes');
 for(let i=0;i<2;i++)for(const suffix of ['', '/Contents/MacOS/ChatGPT'])execFileSync('codesign',['--verify','--strict','--all-architectures','-R','='+evidence[1-i][suffix?'native':'app'].requirement,apps[i]+suffix],{stdio:'pipe'});
 const result={ok:true,differentNativeBuilds:true,mutuallyCompatibleDesignatedRequirements:true,appAndNativeExecutableVerified:true,privacyAuthorizationTested:false,evidence};
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(result));
}finally{
 for(const app of apps){spawnSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',['-u',app],{stdio:'pipe'});fs.rmSync(app,{recursive:true});}
}
