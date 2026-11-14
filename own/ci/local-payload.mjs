import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {execFileSync} from 'node:child_process';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
// Stable local package roots retain npm-release-kit receipts across auth retries.
export function localPayload(directory,bytes,packageJson){
 const expected=packageJson.version.match(/^0\.0\.0-payload\.h([a-f0-9]{64})$/)?.[1];if(!expected||sha(bytes)!==expected)throw Error('LOCAL_PAYLOAD_CHECKSUM');
 const root=path.join(directory,'local-payload-'+expected),exists=fs.existsSync(root);if(exists&&(fs.lstatSync(root).isSymbolicLink()||!fs.statSync(root).isDirectory()))throw Error('UNSAFE_LOCAL_PAYLOAD');
 const source=Buffer.from(JSON.stringify(packageJson)),check=Buffer.from("const f=require('fs'),c=require('crypto'),a=require('assert/strict'),b=f.readFileSync('payload.bin');a.equal(b.length,"+bytes.length+");a.equal(c.createHash('sha256').update(b).digest('hex'),'"+expected+"');\n");
 const policy=Buffer.from(JSON.stringify({schemaVersion:1,mode:'local',checks:[['exec','--offline','--call','node .local-check.cjs']]}));
 if(!exists)fs.mkdirSync(root,{mode:0o700});
 for(const [name,data]of [['package.json',source],['payload.bin',bytes],['.local-check.cjs',check],['.npm-release-kit.json',policy]]){const p=path.join(root,name);if(fs.existsSync(p)){if(fs.lstatSync(p).isSymbolicLink()||!fs.readFileSync(p).equals(data))throw Error('LOCAL_PAYLOAD_CHANGED');}else{if(exists)throw Error('LOCAL_PAYLOAD_INCOMPLETE');fs.writeFileSync(p,data,{flag:'wx',mode:0o644});}}
 if(!exists){execFileSync('git',['init','-q',root],{stdio:'pipe'});execFileSync('git',['-C',root,'add','--','package.json','payload.bin','.local-check.cjs','.npm-release-kit.json'],{stdio:'pipe'});}
 if(!fs.existsSync(path.join(root,'.git')))throw Error('LOCAL_PAYLOAD_GIT_REQUIRED');return root;
}
