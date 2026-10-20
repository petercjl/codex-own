// Dedicated production signing material stays outside source and application bundles.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import {execFileSync} from 'node:child_process';
if(process.platform!=='darwin')throw Error('macOS signing only');
const ci=process.argv.includes('--ci-import')||process.argv.includes('--ci-cleanup');
if(ci&&(process.env.GITHUB_ACTIONS!=='true'||!path.isAbsolute(process.env.RUNNER_TEMP||'')))throw Error('CI signing requires a GitHub runner temporary directory.');
const root=ci?path.join(process.env.RUNNER_TEMP,'codex-own-release-signing'):path.join(os.userInfo().homedir,'Library/Application Support/codex-own-release-signing');
const chain=path.join(root,'release.keychain-db'),cert=path.join(root,'certificate.pem'),manifest=path.join(root,'identity.json'),p12=path.join(root,'signing.p12');
const security=(args,options={})=>{try{return execFileSync('/usr/bin/security',args,{encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:60000,...options});}catch{throw Error('Keychain operation failed; signing material preserved for inspection.');}},quote=s=>'"'+s.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"';
// Hosted runners have no user available for macOS trust dialogs. Scope this
// noninteractive admin-domain operation to the ephemeral CI host only.
const ciTrust=args=>execFileSync('/usr/bin/sudo',['-n','/usr/bin/security',...args],{stdio:'pipe',timeout:30000});
if(process.argv.includes('--ci-cleanup')){
 if(fs.existsSync(root)){if(fs.lstatSync(root).isSymbolicLink())throw Error('Unsafe CI signing directory.');if(fs.existsSync(cert))try{ciTrust(['remove-trusted-cert','-d',cert]);}catch{}if(fs.existsSync(chain))security(['delete-keychain',chain]);fs.rmSync(root,{recursive:true});}
 console.log(JSON.stringify({ok:true,ephemeralSigningRemoved:true}));process.exit(0);
}
const write=(name,content)=>fs.writeFileSync(path.join(root,name),content,{flag:'wx',mode:0o600});
if(process.argv.includes('--create')||ci){
 if(fs.existsSync(root))throw Error('Signing directory already exists; preserve and inspect it before any recovery.');
 fs.mkdirSync(root,{mode:0o700});
 const password=ci?process.env.OWN_MAC_RELEASE_PASSWORD:crypto.randomBytes(32).toString('hex');
 if(!/^[a-f0-9]{64}$/.test(password||''))throw Error('Invalid signing credential.');
 write('keychain-password',password);
 const key=path.join(root,'private-key.pem');
 if(ci){
  const encoded=process.env.OWN_MAC_RELEASE_P12_BASE64;if(!encoded||!/^[A-Za-z0-9+/=\s]+$/.test(encoded))throw Error('Release signing archive missing.');
  write('signing.p12',Buffer.from(encoded,'base64'));
  const pem=execFileSync('/usr/bin/openssl',['pkcs12','-in',p12,'-nokeys','-passin','stdin'],{input:password,stdio:'pipe'});write('certificate.pem',pem);
 }else{
  write('certificate.cnf','[req]\nprompt=no\ndistinguished_name=name\nx509_extensions=extensions\n[name]\nCN=codex-own Release Signing\n[extensions]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyCertSign\nextendedKeyUsage=codeSigning\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid:always\n');
  execFileSync('/usr/bin/openssl',['req','-new','-newkey','rsa:3072','-x509','-sha256','-days','3650','-nodes','-config',path.join(root,'certificate.cnf'),'-keyout',key,'-out',cert],{stdio:'pipe'});
  for(const f of [key,cert])fs.chmodSync(f,0o600);
  execFileSync('/usr/bin/openssl',['pkcs12','-export','-inkey',key,'-in',cert,'-out',p12,'-passout','stdin'],{input:password,stdio:'pipe'});fs.chmodSync(p12,0o600);
 }
 const certificate=new crypto.X509Certificate(fs.readFileSync(cert)),sha1=certificate.fingerprint.replaceAll(':','');
 if(ci){const policy=JSON.parse(fs.readFileSync(new URL('../builders/release-signing.json',import.meta.url)));if(sha1!==policy.sha1)throw Error('Release certificate does not match the pinned public identity.');}
 const before=security(['list-keychains','-d','user']),defaultBefore=security(['default-keychain','-d','user']);let imported=false;
 try{
  if(ci)console.error('Importing the pinned signer into the ephemeral private keychain');
  security(['-i'],{input:`create-keychain -p ${password} ${quote(chain)}\nunlock-keychain -p ${password} ${quote(chain)}\nimport ${quote(p12)} -k ${quote(chain)} -P ${password} -x -T /usr/bin/codesign\nset-key-partition-list -S apple-tool:,apple:,codesign: -s -k ${password} ${quote(chain)}\n`});fs.chmodSync(chain,0o600);
  if(!security(['find-identity','-p','codesigning',chain]).includes(sha1))throw Error('Signing identity import failed; preserve partial setup.');
  write('identity.json',JSON.stringify({schema:1,bundleIdentifier:'local.codex-own',sha1},null,2)+'\n');imported=true;
 }finally{
  const current=[...security(['list-keychains','-d','user']).matchAll(/"([^"]+)"/g)].map(m=>m[1]),prior=[...before.matchAll(/"([^"]+)"/g)].map(m=>m[1]);
  if(JSON.stringify(current.filter(p=>p!==chain))!==JSON.stringify(prior))throw Error('Keychain list changed concurrently; inspect before restoring.');
  if(JSON.stringify(current)!==JSON.stringify(prior))security(['list-keychains','-d','user','-s',...prior]);
  if(security(['default-keychain','-d','user'])!==defaultBefore)throw Error('Default keychain changed; inspect before continuing.');
  if(imported&&fs.existsSync(key))fs.unlinkSync(key);
 }
 if(ci){console.error('Applying code-signing-only trust on the ephemeral GitHub runner');ciTrust(['add-trusted-cert','-d','-r','trustRoot','-p','codeSign','-k','/Library/Keychains/System.keychain',cert]);fs.unlinkSync(p12);}
}
const identity=JSON.parse(fs.readFileSync(manifest,'utf8')),certificate=new crypto.X509Certificate(fs.readFileSync(cert));
if(identity.bundleIdentifier!=='local.codex-own'||identity.sha1!==certificate.fingerprint.replaceAll(':',''))throw Error('Release signing identity mismatch.');
if(process.argv.includes('--trust'))security(['add-trusted-cert','-r','trustRoot','-p','codeSign','-k',chain,cert]);
console.log(JSON.stringify({root,sha1:identity.sha1,validTo:certificate.validTo,codeSigningTrusted:security(['find-identity','-v','-p','codesigning',chain]).includes(identity.sha1),secretsUploaded:false,appChanged:false}));
