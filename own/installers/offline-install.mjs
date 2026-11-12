// Shared by the native first-install GUIs. All installation inputs are local;
// subsequent desktop updates continue using the published npm binding.
import {localInstallerVersion} from './local-input.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {createGunzip} from 'node:zlib';
import {fileURLToPath,pathToFileURL} from 'node:url';

const error=(code,message)=>Object.assign(Error(message),{code});
export async function hashFile(file){const h=crypto.createHash('sha256');for await(const b of fs.createReadStream(file))h.update(b);return h.digest('hex');}
export function compareVersions(a,b){
 const parse=v=>{if(!/^\d+\.\d+\.\d+$/.test(v||''))throw error('INVALID_VERSION','安装包版本格式无效');return v.split('.').map(Number);};
 const x=parse(a),y=parse(b);for(let i=0;i<3;i++)if(x[i]!==y[i])return Math.sign(x[i]-y[i]);return 0;
}
export function validateInfo(info,manifest,platform){
 const local=info?.channel==='local-candidate',managerVersion=local?localInstallerVersion(manifest):manifest?.binding?.managerVersion;
 if(!!manifest?.localCandidate!==local)throw error('INVALID_INSTALLER','候选版标识不匹配');
 if(![1,2].includes(info?.schema)||info.package!=='@petercjl/codex-own'||info.platform!==platform||info.managerVersion!==managerVersion||manifest.repository!=='petercjl/codex-own'||info.desktopVersion!==manifest.version)throw error('INVALID_INSTALLER','安装包身份或平台不匹配');
 const online=info.schema===2&&info.mode==='online';
 if(local&&(online||!info.files?.some(f=>f.path==='local-input.mjs')))throw error('INVALID_INSTALLER','本地候选版必须包含完整离线资源');
 if(info.schema===2&&!['offline','online'].includes(info.mode))throw error('INVALID_INSTALLER','安装方式无效');
 compareVersions(info.managerVersion,info.managerVersion);
 if(!['darwin-arm64','win32-x64'].includes(platform)||!manifest.platforms?.[platform]||!manifest.runtimes?.platforms?.[platform])throw error('UNSUPPORTED_PLATFORM','此安装包不支持当前系统或架构');
 const runtime=manifest.runtimes.platforms[platform];
 for(const name of ['node','python'])if(info.runtimeFiles?.[name]!==name+'.'+runtime[name].format)throw error('INVALID_INSTALLER','运行时归档名称无效');
 if(!Array.isArray(info.files)||!info.files.length||new Set(info.files.map(x=>x.path)).size!==info.files.length)throw error('INVALID_INSTALLER','安装包文件清单无效');
 for(const f of info.files)if(!/^[a-zA-Z0-9._@+/-]+$/.test(f.path)||f.path.startsWith('/')||f.path.split('/').some(p=>p==='..'||p==='')||!Number.isSafeInteger(f.size)||f.size<0||!/^[a-f0-9]{64}$/.test(f.sha256))throw error('INVALID_INSTALLER','安装包文件路径或校验值无效');
 for(const required of ['release.json',...(!online?['desktop.tar.gz']:[]),...Object.values(info.runtimeFiles),platform==='win32-x64'?'engine/node.exe':'engine/node','engine/lib/manager.mjs','engine/lib/tool-runtime.mjs'])if(!info.files.some(f=>f.path===required))throw error('INVALID_INSTALLER','安装包缺少必要资源');
 if(info.schema===2){
  if(platform!=='win32-x64'||runtime.node.format!=='zip'||info.bootstrap?.nodeEntry!==runtime.node.entry+'/node.exe'||!/^node-v[0-9.]+-win-x64\/node\.exe$/.test(info.bootstrap.nodeEntry))throw error('INVALID_INSTALLER','Node 引导路径无效');
  if(!info.files.some(f=>f.path==='bootstrap-node.ps1'))throw error('INVALID_INSTALLER','缺少 Node 引导程序');
 }
 return info;
}
export async function validateBundle(root,platform,{report=()=>{},bulk='all'}={}){
 if(!['all','metadata','payload'].includes(bulk))throw error('INVALID_ARGUMENT','无效校验范围');
 const info=JSON.parse(fs.readFileSync(path.join(root,'installer.json'))),manifest=JSON.parse(fs.readFileSync(path.join(root,'release.json')));validateInfo(info,manifest,platform);
 const payload=new Set(['desktop.tar.gz',...Object.values(info.runtimeFiles)]);
 for(const f of info.files){if(bulk==='metadata'&&payload.has(f.path)||bulk==='payload'&&!payload.has(f.path))continue;let current=root;for(const segment of f.path.split('/')){current=path.join(current,segment);if(fs.lstatSync(current).isSymbolicLink())throw error('UNSAFE_PATH','安装资源包含意外链接');}const p=path.join(root,f.path),s=fs.lstatSync(p);if(!s.isFile()||s.size!==f.size||await hashFile(p)!==f.sha256)throw error('CHECKSUM_MISMATCH','安装资源校验失败，请重新下载完整安装包');}
 report('安装资源校验完成');return {info,manifest};
}
export function checkExisting(prior,manifest){
 if(!prior)return;
 if(prior.identity!=='local.codex-own')throw error('UNMANAGED_TARGET','已有安装的应用身份不匹配，未修改现有文件');
 const previous=prior.releaseManifest?.binding?.managerVersion||prior.version;
 const incoming=manifest.localCandidate?localInstallerVersion(manifest):manifest.binding?.managerVersion||manifest.version;
 if(compareVersions(previous,incoming)>0||compareVersions(prior.version,manifest.version)>0)throw error('INSTALLER_OLDER','当前应用版本更新，请使用应用内更新或下载最新安装包');
}
export async function runOfflineInstall(root,{keyFile,verifyOnly=false,report=message=>process.stderr.write(message+'\n')}={}){
 const platform=process.platform+'-'+process.arch;
 const {info,manifest}=await validateBundle(root,platform,{report,bulk:verifyOnly?'all':'metadata'});
 if(verifyOnly)return {ok:true,verified:true,version:info.managerVersion,platform};
 const manager=await import(pathToFileURL(path.join(root,'engine/lib/manager.mjs'))),tools=await import(pathToFileURL(path.join(root,'engine/lib/tool-runtime.mjs')));
 const p=manager.paths();manager.rejectLinks(p.root);manager.rejectLinks(p.target);const prior=manager.state(p);checkExisting(prior,manifest);
 if(manager.running(p).length)throw error('APP_RUNNING','请先完全退出 codex-own，再重新安装；当前任务和安装保持不变');
 if(fs.existsSync(p.target)&&!prior)throw error('UNMANAGED_TARGET','发现未登记的 codex-own，已保留原目录；请先使用已有修复入口处理');
 if(keyFile&&(!fs.statSync(keyFile).isFile()||fs.statSync(keyFile).size>65536||!/^sk-[A-Za-z0-9_-]{10,}$/.test(fs.readFileSync(keyFile,'utf8').trim())))throw error('INVALID_KEY_FILE','请选择只包含 API 密钥的有效 txt 文件');
 const same=prior?.desktop?.identity===manifest.platforms[platform].sha256&&fs.existsSync(p.target)&&manager.appIdentity(p.target)==='local.codex-own';
 const online=info.mode==='online',localAssets=Object.fromEntries(Object.entries(info.runtimeFiles).map(([k,v])=>[k,path.join(root,v)]));
 const runtimeInstaller=(runtime,options)=>tools.ensureRuntime(runtime,{...options,localAssets});
 if(same){
  const health=tools.runtimeDoctor(path.join(p.root,'runtimes'));
  if(!health.ok||health.version!==manifest.runtimes.version)await validateBundle(root,platform,{bulk:'payload',report});
  report('当前桌面版本已安装，跳过完整桌面归档解压');
  const result=await manager.install({p,version:info.managerVersion,manifest,runtimeInstaller});
  if(keyFile)await manager.configure(keyFile);
  return {...result,offline:!online,configured:!!keyFile,desktopArchiveExpanded:false};
 }
 await validateBundle(root,platform,{bulk:'payload',report});
 for(const destination of [p.root,p.target,os.tmpdir()]){let existing=destination;while(!fs.existsSync(existing))existing=path.dirname(existing);const disk=fs.statfsSync(existing);if(disk.bavail*disk.bsize<10*1024**3)throw error('INSUFFICIENT_SPACE','安装需要至少 10 GB 可用磁盘空间，请清理空间后重试');}
 // Complete all checks before activation. The ordinary manager performs the
 // same backup, transaction, runtime probe and binding registration as npm.
 // The existing extractor computes relative paths from the archive directory.
 // Resolve macOS /var -> /private/var before passing a cross-directory archive.
 const scratch=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'codex-own-first-install-'));
 try{
  if(online){report('正在下载所选版本的桌面和运行环境');const result=await manager.install({p,version:info.managerVersion,manifest,runtimeInstaller});if(keyFile)await manager.configure(keyFile);return {...result,offline:false,configured:!!keyFile};}
  const archive=path.join(scratch,'desktop.tar'),asset=manifest.platforms[platform];let bytes=0;
  const gunzip=createGunzip();gunzip.on('data',b=>{bytes+=b.length;if(bytes>asset.size)gunzip.destroy(error('CHECKSUM_MISMATCH','桌面归档超过预期大小'));});
  report('正在解压完整桌面资源，请稍候');
  await pipeline(fs.createReadStream(path.join(root,'desktop.tar.gz')),gunzip,fs.createWriteStream(archive,{flags:'wx',mode:0o600}));
  if(bytes!==asset.size||await hashFile(archive)!==asset.sha256)throw error('CHECKSUM_MISMATCH','桌面归档校验失败');
  const result=await manager.install({p,version:info.managerVersion,manifest,archive,runtimeInstaller});
  if(keyFile){report('正在导入本地 API 配置');await manager.configure(keyFile);}
  return {...result,offline:true,configured:!!keyFile};
 }finally{fs.rmSync(scratch,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2);if(args.some((s,i)=>s.startsWith('--')&&!['--verify-only','--api-key-file'].includes(s))||args.filter(s=>s==='--api-key-file').length>1)throw error('INVALID_ARGUMENT','安装参数无效');
  const i=args.indexOf('--api-key-file');if(i>=0&&!args[i+1])throw error('INVALID_ARGUMENT','缺少 API 文件路径');
  console.log(JSON.stringify(await runOfflineInstall(path.dirname(fileURLToPath(import.meta.url)),{keyFile:i>=0?args[i+1]:undefined,verifyOnly:args.includes('--verify-only')})));
 }catch(e){console.error(JSON.stringify({ok:false,code:e.code||'INSTALL_FAILED',message:e.message}));process.exitCode=({APP_RUNNING:2,UNMANAGED_TARGET:3,INSTALLER_OLDER:4,CHECKSUM_MISMATCH:5,INVALID_KEY_FILE:6})[e.code]||1;}
}
