// Called only after exact registry visibility; source records remain immutable.
import fs from'node:fs';import path from'node:path';import crypto from'node:crypto';import{identity,validateBinding}from'../lib/binding.mjs';
const [planFile]=process.argv.slice(2),plan=JSON.parse(fs.readFileSync(planFile)),manifest=JSON.parse(fs.readFileSync('own/release.json'));validateBinding(manifest,{managerVersion:plan.managerVersion,requireProof:true});
const response=await fetch('https://registry.npmjs.org/@petercjl%2fcodex-own/'+plan.managerVersion+'?verify='+Date.now());if(!response.ok)throw Error('Manager release unavailable');const p=await response.json();
if(p.version!==plan.managerVersion||identity(p.ownDesktopManifest)!==identity(manifest)||!p.dist?.integrity)throw Error('Published binding differs from verified plan');
const file='own/artifacts/current.json';fs.mkdirSync(path.dirname(file),{recursive:true});if(fs.existsSync(file))fs.copyFileSync(file,file+'.backup-'+crypto.randomUUID(),fs.constants.COPYFILE_EXCL);
const next=file+'.new-'+crypto.randomUUID();fs.writeFileSync(next,JSON.stringify({schema:1,manifest,inputs:plan.inputs,registry:{version:p.version,integrity:p.dist.integrity,tarball:p.dist.tarball}},null,2)+'\n',{flag:'wx'});fs.renameSync(next,file);
