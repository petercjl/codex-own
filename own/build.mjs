// Compose the pinned upstream pipeline with the independent own overlay.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire, Module} from 'node:module';
import {pathToFileURL} from 'node:url';
import {digestFile,tarExecutable} from './lib/manager.mjs';
const require=createRequire(import.meta.url),asar=require('@electron/asar');
const {Pickle}=await import(pathToFileURL(path.join(path.dirname(require.resolve('@electron/asar')),'pickle.js')));
const root=path.resolve(import.meta.dirname,'..'),key=`${process.platform}-${process.arch}`,mac=key==='darwin-arm64';
if(!mac&&key!=='win32-x64')throw Error('Unsupported build platform '+key);
const platform=mac?'mac-arm64':'win',version=process.env.OWN_VERSION||JSON.parse(fs.readFileSync(path.join(root,'own/package.json'))).version;
if(!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version))throw Error('Invalid version');
const output=path.join(root,'out','own-release-'+version+'-'+key);if(fs.existsSync(output))throw Error('Build output exists');fs.mkdirSync(output,{recursive:true});
const run=(cmd,args,options={})=>execFileSync(cmd,args,{cwd:root,stdio:'inherit',...options});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
let source,provenance={upstreamCommit:process.env.OWN_UPSTREAM_SHA||run('git',['rev-parse','upstream/master'],{encoding:'utf8',stdio:'pipe'}).trim()};
const existingIndex=process.argv.indexOf('--existing-app');
if(existingIndex>=0){source=path.resolve(process.argv[existingIndex+1]);provenance={...provenance,kind:'adopted-verified-local-build'};}
else{
 let syncError;try{run(process.execPath,['scripts/sync-upstream.js','--force',mac?'--skip-win':'--skip-mac']);}catch(e){syncError=e;}
 const cache=path.join(os.tmpdir(),'codex-sync',mac?'arm64-extract':'win-extract');
 function findApp(dir,depth=0){if(depth>4)return null;for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory()&&e.name.endsWith('.app'))return p;if(e.isDirectory()){const found=findApp(p,depth+1);if(found)return found;}}return null;}
 const original=mac?findApp(cache):path.join(cache,'app');if(!original)throw syncError||Error('Missing source application');
 const sourceResources=path.join(original,mac?'Contents/Resources':'resources'),archive=path.join(sourceResources,'app.asar');
 provenance.originalAsarSha256=await digestFile(archive);
 const header=asar.getRawHeader(archive).header;
 const extract=path.join(root,'src',platform,'_asar');
 // A narrowly checked fallback for optional absent upstream device bindings.
 const missing=[];
 function entries(d,prefix=''){const out=[];for(const [name,e]of Object.entries(d.files)){const n=prefix+name;if(e.files)out.push(...entries(e,n+'/'));else out.push([n,e]);}return out;}
 const files=entries(header);
 if(syncError){
  for(const [n,e]of files)if(e.unpacked&&!fs.existsSync(archive+'.unpacked/'+n))missing.push(n);
  const allowed=['node_modules/@worklouder/device-kit-oai/node_modules/@serialport/bindings-cpp/build/Release/bindings.node','node_modules/@worklouder/device-kit-oai/node_modules/node-hid/build/Release/HID.node'];
  if(!missing.length||missing.some(n=>!allowed.includes(n)))throw syncError;
 }
 for(const [n,e]of files){if(e.link||e.unpacked)continue;const f=path.join(extract,n);fs.mkdirSync(path.dirname(f),{recursive:true});const b=asar.extractFile(archive,n.replaceAll('/',path.sep));if(e.integrity?.hash&&sha(b)!==e.integrity.hash)throw Error('Source integrity mismatch '+n);fs.writeFileSync(f,b);}
 run(process.execPath,['scripts/patch-all.js',platform]);
 source=path.join(output,'prepared');fs.cpSync(original,source,{recursive:true,verbatimSymlinks:true,errorOnExist:true,force:false});
 const resources=path.join(source,mac?'Contents/Resources':'resources'),dest=path.join(resources,'app.asar');
 let offset=0;const buffers=[];
 for(const [n,e]of files){if(e.link||e.unpacked)continue;const b=fs.readFileSync(path.join(extract,n));e.offset=String(offset);e.size=b.length;offset+=b.length;const size=4194304,blocks=[];for(let i=0;i<b.length;i+=size)blocks.push(sha(b.subarray(i,i+size)));e.integrity={algorithm:'SHA256',hash:sha(b),blockSize:size,blocks};buffers.push(b);}
 const hp=new Pickle();hp.writeString(JSON.stringify(header));const hb=hp.toBuffer(),sp=new Pickle();sp.writeUInt32(hb.length);fs.writeFileSync(dest,Buffer.concat([sp.toBuffer(),hb,...buffers]));
 // Run the upstream's exact CLI resolution function, never select a different provider here.
 const resolverPath=path.join(root,'scripts/build-from-upstream.js');let code=fs.readFileSync(resolverPath,'utf8');if(!code.endsWith('main();\n'))throw Error('Upstream resolver contract changed');code=code.slice(0,-8)+'module.exports={resolveCodexVendor};\n';
 const mod=new Module(resolverPath);mod.filename=resolverPath;mod.paths=Module._nodeModulePaths(path.dirname(resolverPath));mod._compile(code,resolverPath);
 const vendor=mod.exports.resolveCodexVendor(platform),cli=path.join(resources,mac?'codex':'codex.exe');
 if(vendor)fs.copyFileSync(vendor,cli);else if(mac&&!fs.existsSync(cli))fs.copyFileSync(path.join(resources,'codex-cli/CodexCLI.app/Contents/MacOS/codex'),cli);
 if(mac)fs.chmodSync(cli,0o755);provenance.cliSource=vendor?'upstream-resolved-vendor':'upstream-bundled';provenance.cliSha256=await digestFile(cli);provenance.cliVersion=run(cli,['--version'],{stdio:'pipe',encoding:'utf8'}).trim();provenance.optionalMissingBindings=missing;
 const built=path.join(output,'built');run(process.execPath,[`own/builders/${mac?'mac':'windows'}.mjs`,built],{env:{...process.env,OWN_PREPARED_APP:source}});source=path.join(built,mac?'codex-own.app':'app');
}
const resources=path.join(source,mac?'Contents/Resources':'resources');
const cli=path.join(resources,mac?'codex-own-cli':'codex.exe');
run(cli,['--version']);
run(process.execPath,['own/test-app.mjs',source]);
if(mac)run('codesign',['--verify','--deep','--strict',source]);
const filename=`codex-own-${key}.tar.gz`,target=path.join(output,filename);
run(tarExecutable(),['-czf',target,'-C',path.dirname(source),path.basename(source)]);
const manifest={schema:1,repository:'petercjl/codex-own',version,provenance,platforms:{[key]:{entry:path.basename(source),url:`https://github.com/petercjl/codex-own/releases/download/own-v${version}/${filename}`,sha256:await digestFile(target),size:fs.statSync(target).size}}};
fs.writeFileSync(path.join(output,`manifest-${key}.json`),JSON.stringify(manifest,null,2),{flag:'wx'});console.log(JSON.stringify({ok:true,output,artifact:target}));
