// Windows-only private packaging from a verified, published native baseline.
// No registry mutation, publication, or fabricated public provenance.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';import {createRequire} from 'node:module';
import {pipeline} from 'node:stream/promises';import {createGunzip,createGzip} from 'node:zlib';
import {unpack} from '../lib/manager.mjs';import {hashFile} from './offline-install.mjs';
import {writeCanonicalArchive} from '../lib/content-blocks.mjs';import {upgradeUpdater} from '../builders/upgrade-updater.mjs';
import {localInstallerVersion} from './local-input.mjs';
const root=path.resolve(import.meta.dirname,'../..'),require=createRequire(import.meta.url),asar=require('@electron/asar');
const [baselineArg,outArg,version,inventoryArg,...options]=process.argv.slice(2);
const builtApp=options.length===2&&options[0]==='--built-app'?path.resolve(options[1]):null;
if(process.platform!=='win32'||process.arch!=='x64'||!baselineArg||!outArg||!inventoryArg||!/^\d+\.\d+\.\d+$/.test(version||'')||options.length&&!builtApp)throw Error('Usage: candidate.mjs <verified-baseline-directory> <new-output-directory> <private-version> <source-inventory.json> [--built-app <fresh-verified-Windows-app>] on Windows x64');
const baseline=path.resolve(baselineArg),out=path.resolve(outArg),inventory=JSON.parse(fs.readFileSync(inventoryArg));
for(const f of inventory.files){if(f.missing)continue;const expected=f.link?inventory.files.find(x=>x.name===path.posix.normalize(path.posix.join(path.posix.dirname(f.name),f.link)))?.sha256:f.sha256;if(f.link&&!/^own\/\.github\/workflows\//.test(f.name))throw Error('Unexpected source link');const file=path.join(root,f.name);if(!expected||await hashFile(file)!==expected)throw Error('Frozen source mismatch: '+f.name);}
if(fs.existsSync(out))throw Error('Candidate output exists');fs.mkdirSync(out,{recursive:true});
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
write(path.join(out,'source-inventory.json'),inventory);
const original=JSON.parse(fs.readFileSync(path.join(baseline,'release.json'))),asset=original.platforms['win32-x64'];
const hash=crypto.createHash('sha256');let bytes=0;
for await(const b of fs.createReadStream(path.join(baseline,'desktop.tar.gz')).pipe(createGunzip())){bytes+=b.length;if(bytes>asset.size)throw Error('Baseline exceeds expected size');hash.update(b);}
if(bytes!==asset.size||hash.digest('hex')!==asset.sha256)throw Error('Baseline differs from immutable published desktop');
for(const name of ['node','python'])if(await hashFile(path.join(baseline,name+'.'+original.runtimes.platforms['win32-x64'][name].format))!==original.runtimes.platforms['win32-x64'][name].sha256)throw Error('Runtime baseline mismatch: '+name);
console.log('Verified published baseline and Node/Python archives');
const runtimeCache=path.join(out,'runtime-cache');fs.mkdirSync(runtimeCache);for(const name of ['node','python']){const a=original.runtimes.platforms['win32-x64'][name],fd=fs.openSync(path.join(baseline,name+'.'+a.format),'r');try{let offset=0;for(const part of a.parts){const b=Buffer.alloc(part.size);if(fs.readSync(fd,b,0,b.length,offset)!==b.length||crypto.createHash('sha256').update(b).digest('hex')!==part.sha256)throw Error('Runtime part identity mismatch');offset+=b.length;fs.writeFileSync(path.join(runtimeCache,part.sha256+'.bin'),b,{flag:'wx'});}}finally{fs.closeSync(fd);}}
const extracted=path.join(out,'native');let app,optimization;
process.env.OWN_VERSION=version;
if(builtApp){
 const identity=JSON.parse(fs.readFileSync(path.join(builtApp,'codex-own-build.json')));
 if(identity.identity!=='local.codex-own')throw Error('Fresh Windows build identity mismatch');
 fs.mkdirSync(extracted);app=path.join(extracted,'app');fs.cpSync(builtApp,app,{recursive:true,force:false,errorOnExist:true});
 optimization={freshWindowsBuild:true,publishedRuntimeBaseline:original.version};
}else{unpack(path.join(baseline,'desktop.tar.gz'),extracted);app=path.join(extracted,'app');optimization=await upgradeUpdater(app,{version,node:process.execPath});}
const metadata=path.join(app,'codex-own-build.json'),info=JSON.parse(fs.readFileSync(metadata));
write(path.join(out,'native-metadata-before.json'),info);info.version=version;info.channel='local-candidate';info.sourceFingerprint=inventory.sha256;fs.writeFileSync(metadata,JSON.stringify(info,null,2));
execFileSync(process.execPath,['own/test-app.mjs',app],{cwd:root,stdio:'inherit',timeout:180000});
execFileSync(process.execPath,['own/ci/test-official-compat.mjs',app],{cwd:root,stdio:'inherit',timeout:120000});
const inputs=path.join(out,'installer-input');fs.mkdirSync(inputs);
const raw=path.join(out,'desktop.tar'),canonical=await writeCanonicalArchive(app,'app',raw);
await pipeline(fs.createReadStream(raw),createGzip({level:6}),fs.createWriteStream(path.join(inputs,'desktop.tar.gz'),{flags:'wx'}));
const manifest={schema:1,repository:'petercjl/codex-own',version,localCandidate:{schema:1,private:true,sourceFingerprint:inventory.sha256,baseVersion:original.version,baseDesktopSha256:asset.sha256},platforms:{'win32-x64':{entry:'app',url:`https://github.com/petercjl/codex-own/releases/download/own-v${version}/codex-own-win32-x64.tar.gz`,size:canonical.size,sha256:canonical.sha256}},runtimes:original.runtimes};
localInstallerVersion(manifest);write(path.join(inputs,'release.json'),manifest);
for(const name of ['node','python'])fs.copyFileSync(path.join(baseline,name+'.'+original.runtimes.platforms['win32-x64'][name].format),path.join(inputs,name+'.'+original.runtimes.platforms['win32-x64'][name].format),fs.constants.COPYFILE_EXCL);
const manager=path.join(inputs,'manager');fs.mkdirSync(manager);const own=path.join(root,'own'),pkg=JSON.parse(fs.readFileSync(path.join(own,'package.json')));
for(const name of [...pkg.files,'LICENSE']){const p=path.join(own,name);if(name==='release.json')continue;if(fs.existsSync(p))fs.cpSync(p,path.join(manager,name),{recursive:true,force:false,errorOnExist:true});}
// Dependency resolution uses the frozen source's pinned installation; the
// installer builder copies only runtime dependencies into its private engine.
fs.cpSync(path.join(own,'node_modules'),path.join(manager,'node_modules'),{recursive:true,force:false,errorOnExist:true});
pkg.version=version;pkg.private=true;delete pkg.ownDesktopManifest;write(path.join(manager,'package.json'),pkg);write(path.join(manager,'release.json'),manifest);
const output=path.join(out,'installer');execFileSync(process.execPath,['own/installers/build.mjs',version,output,'--local-input',inputs,'--keep-payload'],{cwd:root,stdio:'inherit',timeout:1200000});
write(path.join(out,'candidate-result.json'),{schema:1,version,channel:'local-candidate',published:false,sourceFingerprint:inventory.sha256,baselineVersion:original.version,baselineDesktopBytes:asset.size,desktopBytes:canonical.size,installer:JSON.parse(fs.readFileSync(path.join(output,'installer-win32-x64.json'))),optimization});
console.log(JSON.stringify({ok:true,version,channel:'local-candidate',output}));
