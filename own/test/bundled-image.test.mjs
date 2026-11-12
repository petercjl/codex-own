import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url),image=require('../lib/bundled-image.cjs');
function fixture(t){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'own-image-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
const expiresAt=new Date(Date.now()+3600000).toISOString();
const bootstrap=member=>({organization:{id:'organization'},member:{id:member},image:{enabled:true,adapter:'toapiscli',package:'@petercjl/toapiscli',credential:{schemaVersion:1,site:'cn',apiKey:'sk-fixture-not-a-real-key'}}});
function runner(seen){return async(_node,args,options)=>{
 seen.push({args,env:options.env});
 if(args[1]==='auth'){assert.equal(fs.statSync(args[args.indexOf('--file')+1]).isFile(),true);return JSON.stringify({configured:true,models:['doubao-seedream-5-5']});}
 if(args[2]==='status')return JSON.stringify({installed:false,current:false});
 return JSON.stringify({current:true});
};}
test('employee import uses bundled CLI, separate accounts, sanitized environment and private receipts',async t=>{
 const root=fixture(t),seen=[];
 // Test runner bypasses the runtime only; application still resolves its bundled Node.
 const bundle=path.join(root,'bundle');fs.mkdirSync(bundle);fs.writeFileSync(path.join(bundle,'node'),'',{mode:0o700});
 const options={expiresAt,bundle,run:runner(seen)};
 const result=await image.configure(root,bootstrap('alice'),options);assert.equal(result.enabled,true);
 const alice=image.environment(root,{TOAPISCLI_API_KEY:'inherited-key',TOAPISCLI_SITE:'com',OTHER:'kept'});
 assert.equal(alice.TOAPISCLI_API_KEY,undefined);assert.equal(alice.TOAPISCLI_SITE,undefined);assert.equal(alice.OTHER,'kept');assert.equal(alice.TOAPISCLI_AUTO_UPDATE,'0');
 assert(!fs.readFileSync(path.join(root,'core','managed-image.json'),'utf8').includes('sk-'));
 assert.equal(fs.readdirSync(alice.TOAPISCLI_CONFIG_DIR).filter(f=>f.startsWith('import-')).length,0);
 await image.configure(root,bootstrap('bob'),options);const bob=image.environment(root,{});assert.notEqual(alice.TOAPISCLI_CONFIG_DIR,bob.TOAPISCLI_CONFIG_DIR);
 image.deactivate(root);assert.match(image.environment(root,{}).TOAPISCLI_CONFIG_DIR,/signed-out/);
 assert(seen.every(s=>s.env.TOAPISCLI_UPDATE_CHECK==='0'));
});
test('failed or disabled employee setup cannot retain previous active image account or expose errors',async t=>{
 const root=fixture(t),bundle=path.join(root,'bundle');fs.mkdirSync(bundle);fs.writeFileSync(path.join(bundle,'node'),'');
 await image.configure(root,bootstrap('alice'),{bundle,expiresAt,run:runner([])});
 await assert.rejects(image.configure(root,bootstrap('bob'),{bundle,expiresAt,run:async()=>{throw Error('sk-secret-output');}}),e=>e.code==='IMAGE_CLI_FAILED'&&!e.message.includes('sk-secret'));
 assert.match(image.environment(root,{}).TOAPISCLI_CONFIG_DIR,/signed-out/);
 assert.deepEqual(await image.configure(root,{image:{enabled:false,reason:'KEY_BINDING_UNVERIFIED'}}),{enabled:false,reason:'KEY_BINDING_UNVERIFIED'});
});
test('actual packaged CLI installs and verifies its canonical Skill into the isolated application directory',async t=>{
 const root=fixture(t),bundle=path.resolve(import.meta.dirname,'..');
 const run=async(_file,args,options)=>execFileSync(process.execPath,args,{...options,encoding:'utf8'});
 // Source checkout has no desktop Node yet. Resolve an isolated fixture bundle to the actual entry.
 const tempBundle=path.join(root,'bundle');fs.mkdirSync(tempBundle);fs.writeFileSync(path.join(tempBundle,'node'),'');
 const redirect=async(_file,args,options)=>run(null,[path.join(bundle,'node_modules/@petercjl/toapiscli/bin/toapiscli.mjs'),...args.slice(1)],options);
 await image.ensureSkill(root,{bundle:tempBundle,run:redirect});
 const skill=path.join(root,'core/skills/toapiscli');assert(fs.existsSync(path.join(skill,'SKILL.md')));assert(fs.existsSync(path.join(skill,'.runtime/dist/cli.mjs')));
 const result=JSON.parse(execFileSync(process.execPath,[path.join(skill,'.runtime/dist/cli.mjs'),'auth','status','--json'],{env:image.environment(root,process.env),encoding:'utf8'}));assert.equal(result.configured,false);
});
