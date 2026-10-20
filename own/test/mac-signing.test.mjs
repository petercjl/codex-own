import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {macSigningArguments,withMacSigning,verifyMacReleaseSignature,sealMacBundle} from '../builders/mac-signing.mjs';
const sha1='AB'.repeat(20),secret='cd'.repeat(32);
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'own-signing-'));fs.chmodSync(root,0o700);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const [name,body]of Object.entries({'identity.json':JSON.stringify({schema:1,bundleIdentifier:'local.codex-own.development',sha1}),'certificate.pem':'fixture certificate','keychain-password':secret,'development.keychain-db':'fixture keychain'}))fs.writeFileSync(path.join(root,name),body,{flag:'wx',mode:0o600});
 const commands=[],run=(file,args,options)=>{commands.push({file,args,options});return args[0]==='find-identity'?`1) ${sha1} Local development certificate`:'';};
 return {root,commands,run,certificate:()=>({fingerprint:sha1,validTo:'Oct 19 12:00:00 2036 GMT'})};
}
test('release builds require a provisioned signer and never fall back to ad-hoc signing',t=>{
 const root=path.join(os.tmpdir(),'absent-release-signer-'+Date.now());assert.throws(()=>macSigningArguments(false,{root}),{code:'RELEASE_SIGNING_MISSING'});
});
test('release sealing pins the native identity after deep signing and reseals the outer bundle',()=>{
 const calls=[],run=(_file,args)=>calls.push(args);sealMacBundle('/fixture/app',['--sign','fixture'],{run});
 assert.equal(calls.length,3);assert.ok(calls[0].includes('--deep'));assert.ok(calls[1].includes('--identifier'));assert.equal(calls[1].at(-1),path.join('/fixture/app','Contents/MacOS/ChatGPT'));assert.ok(!calls[2].includes('--deep'));
 const development=[];sealMacBundle('/fixture/dev',['--sign','fixture'],{development:true,run:(_f,args)=>development.push(args)});assert.equal(development.length,1);
});
test('final release gate rejects ad-hoc or wrong-certificate apps on every architecture',()=>{
 const policy={schema:1,bundleIdentifier:'local.codex-own',sha1},calls=[];
 const r=verifyMacReleaseSignature('/fixture/formal.app',{policy,run:(...args)=>calls.push(args)});assert.equal(r.sha1,sha1);
 assert.equal(calls.length,2);assert.equal(calls[1][1].at(-1),path.join('/fixture/formal.app','Contents/MacOS/ChatGPT'));
 assert.ok(calls[0][1].includes('--all-architectures'));assert.ok(calls[0][1].includes(`=identifier "local.codex-own" and certificate leaf = H"${sha1.toLowerCase()}"`));
 assert.throws(()=>verifyMacReleaseSignature('/fixture/formal.app',{policy,run:()=>{throw Error('Signature mismatch')}}),{code:'RELEASE_SIGNING_MISMATCH'});
});
test('release builds pin a separate certificate and reject a development identity', {skip:process.platform==='win32'},t=>{
 const f=fixture(t),policy={schema:1,bundleIdentifier:'local.codex-own',sha1};
 fs.renameSync(path.join(f.root,'development.keychain-db'),path.join(f.root,'release.keychain-db'));
 assert.throws(()=>macSigningArguments(false,{...f,policy}),{code:'RELEASE_SIGNING_INVALID'});
 fs.writeFileSync(path.join(f.root,'identity.json'),JSON.stringify(policy));
 assert.equal(macSigningArguments(false,{...f,policy})[1],sha1);
 assert.throws(()=>macSigningArguments(false,{...f,policy:{...policy,sha1:'00'.repeat(20)}}),{code:'RELEASE_SIGNING_INVALID'});
 assert.throws(()=>macSigningArguments(false,{...f,policy,run:()=>''}),{code:'RELEASE_SIGNING_TRUST_REQUIRED'});
 assert.ok(f.commands.every(c=>!JSON.stringify(c.args).includes(secret)));
});
test('development builds reuse one certificate and keep secrets out of command arguments', {skip:process.platform==='win32'},t=>{
 const f=fixture(t),first=macSigningArguments(true,f),second=macSigningArguments(true,f);assert.deepEqual(first,second);assert.equal(first[1],sha1);
 assert.ok(f.commands.every(c=>!JSON.stringify(c.args).includes(secret)));assert.ok(f.commands.every(c=>!c.args.includes('create-keychain')&&!c.args.includes('add-trusted-cert')&&!c.args.includes('list-keychains')));
 assert.ok(f.commands[0].options.input.includes(secret));assert.ok(first.includes('--timestamp=none'));
});
test('missing, untrusted, mismatched and exposed identities fail without an ad-hoc fallback', {skip:process.platform==='win32'},t=>{
 const f=fixture(t);assert.throws(()=>macSigningArguments(true,{...f,run:()=>''}),{code:'DEVELOPMENT_SIGNING_TRUST_REQUIRED'});
 assert.throws(()=>macSigningArguments(true,{...f,certificate:()=>({fingerprint:'00'.repeat(20),validTo:'Oct 19 2036'})}),{code:'DEVELOPMENT_SIGNING_INVALID'});
 fs.chmodSync(path.join(f.root,'keychain-password'),0o644);assert.throws(()=>macSigningArguments(true,f),{code:'DEVELOPMENT_SIGNING_UNSAFE'});
 fs.unlinkSync(path.join(f.root,'keychain-password'));assert.throws(()=>macSigningArguments(true,f),{code:'DEVELOPMENT_SIGNING_MISSING'});
});
test('signing temporarily adds only its own keychain and restores the list on failure', {skip:process.platform==='win32'},t=>{
 const f=fixture(t);let keychains=['/fixture/login.keychain-db'];
 const run=(file,args,options)=>{if(args[0]!=='list-keychains')return f.run(file,args,options);if(args.includes('-s')){keychains=args.slice(4);return '';}return keychains.map(x=>'"'+x+'"').join('\n');};
 assert.throws(()=>withMacSigning(true,()=>{assert.deepEqual(keychains,['/fixture/login.keychain-db',path.join(f.root,'development.keychain-db')]);keychains.push('/fixture/added-by-user');throw Error('fixture signing failed');},{...f,run}),/fixture signing failed/);
 assert.deepEqual(keychains,['/fixture/login.keychain-db','/fixture/added-by-user']);assert.ok(!fs.existsSync(path.join(f.root,'signing.lock')));
});
