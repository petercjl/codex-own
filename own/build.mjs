// Compose the pinned upstream pipeline with the independent own overlay.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire, Module} from 'node:module';
import {pathToFileURL} from 'node:url';
import {digestFile,tarExecutable} from './lib/manager.mjs';
import {canonicalize} from './ci/canonicalize.mjs';
import {sourceTree} from './ci/source-tree.mjs';
import {exposeVendorResolver,withSystemTar} from './builders/upstream-resolver.mjs';
import {nativeVersion} from './builders/native-version.mjs';
const require=createRequire(import.meta.url),asar=require('@electron/asar');
const {missingUnpacked}=require('../scripts/upstream-compat.js');
const {Pickle}=await import(pathToFileURL(path.join(path.dirname(require.resolve('@electron/asar')),'pickle.js')));
const root=path.resolve(import.meta.dirname,'..'),key=`${process.platform}-${process.arch}`,mac=key==='darwin-arm64';
if(!mac&&key!=='win32-x64')throw Error('Unsupported build platform '+key);
const platform=mac?'mac-arm64':'win',version=process.env.OWN_VERSION||JSON.parse(fs.readFileSync(path.join(root,'own/package.json'))).version;
if(!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version))throw Error('Invalid version');
const local=process.argv.includes('--local-only'),development=process.argv.includes('--development');
if(development&&(!local||!mac))throw Error('Development builds require macOS and --local-only');
if(development)process.env.OWN_DEVELOPMENT='1';
if(process.env.OWN_DEVELOPMENT&&!local)throw Error('Development identity cannot enter the release pipeline');
const argument=name=>{const i=process.argv.indexOf(name);if(i<0)return null;const value=process.argv[i+1];if(!value||value.startsWith('--'))throw Error('Missing '+name);return path.resolve(value);};
const output=argument('--output')||path.join(root,'out','own-release-'+version+'-'+key+'.noindex');if(fs.existsSync(output))throw Error('Build output exists');fs.mkdirSync(output,{recursive:true});
const run=(cmd,args,options={})=>execFileSync(cmd,args,{cwd:root,stdio:'inherit',...options});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
let source,provenance={upstreamCommit:process.env.OWN_UPSTREAM_SHA||null,ownSourceRef:run('git',['rev-parse','HEAD'],{encoding:'utf8',stdio:'pipe'}).trim(),updaterNodeSha256:await digestFile(process.execPath),toolchain:{node:process.version,platform:key,image:process.env.ImageVersion||null}};
const existingIndex=process.argv.indexOf('--existing-app');
const prepared=argument('--prepared-app');
if(existingIndex>=0){
 source=path.resolve(process.argv[existingIndex+1]);provenance={...provenance,kind:'adopted-verified-local-build'};
 if(process.argv.includes('--refresh-overlay')){
  if(!local||!development||!mac)throw Error('Overlay refresh requires a local Mac development build');
  run('codesign',['--verify','--deep','--strict',source]);
  const copy=path.join(output,'codex-own 开发版.app');run('ditto',[source,copy]);source=copy;
  await(await import('./builders/refresh-development.mjs')).refreshDevelopment(source,output);
 }
}
else if(prepared){
 if(!local||!mac)throw Error('Prepared local input requires macOS --local-only');
 run('codesign',['--verify','--deep','--strict',prepared]);
 provenance={...provenance,kind:'verified-local-upstream-input',originalAsarSha256:await digestFile(path.join(prepared,'Contents/Resources/app.asar'))};
 const built=path.join(output,'built');run(process.execPath,['own/builders/mac.mjs',built],{env:{...process.env,OWN_PREPARED_APP:prepared}});
 source=path.join(built,development?'codex-own 开发版.app':'codex-own.app');
}
else{
 run(process.execPath,['scripts/sync-upstream.js','--force','--platform',platform]);
 const cache=path.join(os.tmpdir(),'codex-sync',mac?'arm64-extract':'win-extract');
 function findApp(dir,depth=0){if(depth>4)return null;for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory()&&e.name.endsWith('.app'))return p;if(e.isDirectory()){const found=findApp(p,depth+1);if(found)return found;}}return null;}
 const original=mac?findApp(cache):path.join(cache,'app');if(!original)throw Error('Missing source application');
 if(mac)run('codesign',['--verify','--deep','--strict',original]);
 provenance.originalProgramTree=await sourceTree(original);
 const sourceResources=path.join(original,mac?'Contents/Resources':'resources'),archive=path.join(sourceResources,'app.asar');
 provenance.originalAsarSha256=await digestFile(archive);
 const header=asar.getRawHeader(archive).header;
 const extract=path.join(root,'src',platform,'_asar');
 // Every unpacked entry must exist after verified MSIX path restoration.
 const missing=missingUnpacked(header,archive);
 function entries(d,prefix=''){const out=[];for(const [name,e]of Object.entries(d.files)){const n=prefix+name;if(e.files)out.push(...entries(e,n+'/'));else out.push([n,e]);}return out;}
 const files=entries(header);
 for(const [n,e]of files){if(e.link||e.unpacked)continue;const f=path.join(extract,n);fs.mkdirSync(path.dirname(f),{recursive:true});const b=asar.extractFile(archive,n.replaceAll('/',path.sep));if(e.integrity?.hash&&sha(b)!==e.integrity.hash)throw Error('Source integrity mismatch '+n);fs.writeFileSync(f,b);}
 run(process.execPath,['scripts/patch-all.js',platform]);
 source=path.join(output,'prepared');fs.cpSync(original,source,{recursive:true,verbatimSymlinks:true,errorOnExist:true,force:false});
 const resources=path.join(source,mac?'Contents/Resources':'resources'),dest=path.join(resources,'app.asar');
 let offset=0;const buffers=[];
 for(const [n,e]of files){if(e.link||e.unpacked)continue;const b=fs.readFileSync(path.join(extract,n));e.offset=String(offset);e.size=b.length;offset+=b.length;const size=4194304,blocks=[];for(let i=0;i<b.length;i+=size)blocks.push(sha(b.subarray(i,i+size)));e.integrity={algorithm:'SHA256',hash:sha(b),blockSize:size,blocks};buffers.push(b);}
 const hp=new Pickle();hp.writeString(JSON.stringify(header));const hb=hp.toBuffer(),sp=new Pickle();sp.writeUInt32(hb.length);fs.writeFileSync(dest,Buffer.concat([sp.toBuffer(),hb,...buffers]));
 // Run the upstream's exact CLI resolution function, never select a different provider here.
 const resolverPath=path.join(root,'scripts/build-from-upstream.js'),code=exposeVendorResolver(fs.readFileSync(resolverPath,'utf8'));
 const mod=new Module(resolverPath);mod.filename=resolverPath;mod.paths=Module._nodeModulePaths(path.dirname(resolverPath));mod._compile(code,resolverPath);
 const cliSource=process.env.OWN_CLI_SOURCE||'bundled';if(!['bundled','rebuild'].includes(cliSource))throw Error('Unknown OWN_CLI_SOURCE');
 const vendor=cliSource==='rebuild'?withSystemTar(()=>mod.exports.resolveCodexVendor(platform),tarExecutable()):null,cli=path.join(resources,mac?'codex':'codex.exe');
 if(cliSource==='rebuild'&&!vendor)throw Error('Selected Rebuild CLI unavailable');
 if(vendor)fs.copyFileSync(vendor,cli);else if(mac&&!fs.existsSync(cli))fs.copyFileSync(path.join(resources,'codex-cli/CodexCLI.app/Contents/MacOS/codex'),cli);
 if(mac)fs.chmodSync(cli,0o755);provenance.cliSource=vendor?'upstream-resolved-vendor':'upstream-bundled';provenance.cliSha256=await digestFile(cli);provenance.missingUnpackedBindings=missing;
 if(!mac)provenance.msixPathRestorations=JSON.parse(fs.readFileSync(path.join(root,'src',platform,'msix-path-restorations.json')));
 const built=path.join(output,'built');run(process.execPath,[`own/builders/${mac?'mac':'windows'}.mjs`,built],{env:{...process.env,OWN_PREPARED_APP:source}});source=path.join(built,mac?(development?'codex-own 开发版.app':'codex-own.app'):'app');
}
const resources=path.join(source,mac?'Contents/Resources':'resources');
const cli=path.join(resources,mac?'codex-own-cli':'codex.exe');
// Probe the completed product: on macOS the builder signs the copied binaries
// and their containing app before they can be launched from their new location.
provenance.cliVersion=await nativeVersion(path.join(resources,mac?'codex':'codex.exe'));
run(cli,['--version']);
run(process.execPath,['own/test-app.mjs',source]);
if(mac)run('codesign',['--verify','--deep','--strict',source]);
if(local){const result={ok:true,localOnly:true,development,app:source,provenance};fs.writeFileSync(path.join(output,'local-build.json'),JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result));process.exit(0);}
const filename=`codex-own-${key}.tar.gz`,target=path.join(output,filename);
run(tarExecutable(),['-czf',target,'-C',path.dirname(source),path.basename(source)]);
const manifest={schema:1,repository:'petercjl/codex-own',version,provenance,platforms:{[key]:{entry:path.basename(source),url:`https://github.com/petercjl/codex-own/releases/download/own-v${version}/${filename}`,sha256:await digestFile(target),size:fs.statSync(target).size}}};
manifest.platforms[key]=await canonicalize(source,manifest.platforms[key],target);
fs.writeFileSync(path.join(output,`manifest-${key}.json`),JSON.stringify(manifest,null,2),{flag:'wx'});console.log(JSON.stringify({ok:true,output,artifact:target}));
