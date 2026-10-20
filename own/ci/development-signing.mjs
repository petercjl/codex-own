// Local macOS development provisioning. Never used by release CI; no signing
// material enters the repository or app. Trust is a separate explicit action.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {execFileSync} from 'node:child_process';
import {developmentSigningRoot} from '../builders/mac-signing.mjs';
if(process.platform!=='darwin')throw Error('Development signing is local macOS only.');
const root=developmentSigningRoot(),args=process.argv.slice(2),chain=path.join(root,'development.keychain-db'),cert=path.join(root,'certificate.pem'),manifest=path.join(root,'identity.json');
const security=(argv,options={})=>execFileSync('/usr/bin/security',argv,{encoding:'utf8',stdio:['pipe','pipe','pipe'],...options});
const quoted=s=>'"'+s.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"';
if(args.includes('--create')&&!fs.existsSync(root)){
 fs.mkdirSync(root,{mode:0o700});const password=crypto.randomBytes(32).toString('hex'),key=path.join(root,'private-key.pem'),p12=path.join(root,'identity.p12'),config=path.join(root,'certificate.cnf');
 fs.writeFileSync(path.join(root,'keychain-password'),password,{flag:'wx',mode:0o600});
 fs.writeFileSync(config,'[req]\nprompt=no\ndistinguished_name=name\nx509_extensions=extensions\n[name]\nCN=codex-own Development Local Signing\n[extensions]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyCertSign\nextendedKeyUsage=codeSigning\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid:always\n',{flag:'wx',mode:0o600});
 const before=security(['list-keychains','-d','user']),defaultBefore=security(['default-keychain','-d','user']);let imported=false;
 try{
  execFileSync('/usr/bin/openssl',['req','-new','-newkey','rsa:2048','-x509','-sha256','-days','3650','-nodes','-config',config,'-keyout',key,'-out',cert],{stdio:'pipe'});for(const f of [key,cert])fs.chmodSync(f,0o600);
  execFileSync('/usr/bin/openssl',['pkcs12','-export','-inkey',key,'-in',cert,'-out',p12,'-passout','stdin'],{input:password,stdio:'pipe'});fs.chmodSync(p12,0o600);
  security(['-i'],{input:`create-keychain -p ${password} ${quoted(chain)}\nunlock-keychain -p ${password} ${quoted(chain)}\nimport ${quoted(p12)} -k ${quoted(chain)} -P ${password} -x -T /usr/bin/codesign\nset-key-partition-list -S apple-tool:,apple:,codesign: -s -k ${password} ${quoted(chain)}\n`});fs.chmodSync(chain,0o600);
  const sha1=new crypto.X509Certificate(fs.readFileSync(cert)).fingerprint.replaceAll(':','');
  if(!security(['find-identity','-p','codesigning',chain]).includes(sha1))throw Error('Imported identity not found; preserve partial setup.');
  fs.writeFileSync(manifest,JSON.stringify({schema:1,bundleIdentifier:'local.codex-own.development',sha1},null,2)+'\n',{flag:'wx',mode:0o600});imported=true;
 }finally{
  const current=security(['list-keychains','-d','user']);if(current!==before){const prior=[...before.matchAll(/"([^"]+)"/g)].map(x=>x[1]);const now=[...current.matchAll(/"([^"]+)"/g)].map(x=>x[1]);if(JSON.stringify(now.filter(x=>x!==chain))!==JSON.stringify(prior))throw Error('Keychain list changed concurrently; inspect before restoring.');security(['list-keychains','-d','user','-s',...prior]);}
  if(security(['default-keychain','-d','user'])!==defaultBefore)throw Error('Default keychain changed concurrently; inspect before continuing.');
  if(imported)for(const f of [key,p12])fs.unlinkSync(f);
 }
}
if(!fs.existsSync(manifest))throw Error('Signing identity absent or setup incomplete; inspect retained files before provisioning.');
const identity=JSON.parse(fs.readFileSync(manifest,'utf8')),actual=new crypto.X509Certificate(fs.readFileSync(cert));
if(identity.schema!==1||identity.bundleIdentifier!=='local.codex-own.development'||identity.sha1!==actual.fingerprint.replaceAll(':',''))throw Error('Signing certificate does not match its manifest.');
if(args.includes('--trust'))security(['add-trusted-cert','-r','trustRoot','-p','codeSign','-k',chain,cert]);
const trusted=security(['find-identity','-v','-p','codesigning',chain]).includes(identity.sha1);
console.log(JSON.stringify({root,certificate:cert,sha1:identity.sha1,codeSigningTrusted:trusted,privacyAuthorization:'managed by macOS user consent',validTo:actual.validTo}));
