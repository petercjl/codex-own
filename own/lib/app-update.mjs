import fs from 'node:fs';
import path from 'node:path';
import {latest,manifestFor,validateManifest,paths,state,locked,rejectLinks,exclusive,digestFile,tarExecutable,install,fail,running,launch} from './manager.mjs';
import {assembleNpmAsset} from './npm-assets.mjs';
import {reuseInstalledBlocks} from './content-blocks.mjs';
import {ensureRuntime,toolEnv} from './tool-runtime.mjs';
import {components} from './binding.mjs';

// Desktop release versions use the stable npm channel, independently of upstream's app version.
export function isNewer(candidate,current) {
  const parse=v=>/^\d+\.\d+\.\d+$/.test(v||'')?v.split('.').map(Number):null;
  const a=parse(candidate),b=parse(current);
  if(!a||!b)fail('INVALID_VERSION','Expected stable desktop release versions');
  for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}return false;
}
export async function checkUpdate(current,{resolve=latest,manifest=manifestFor,p=paths()}={}) {
  const available=await resolve();
  const m=await manifest(available);
  if(m.binding){
    validateManifest(m,p.platform);
    if(m.binding.managerVersion!==available)fail('INVALID_MANIFEST','Manager binding differs from npm');
    const s=state(p)||{version:current},c=components(s,m,p.platform,toolEnv.active(path.join(p.root,'runtimes'))?.version);
    return {ok:true,current,available:m.version,managerAvailable:available,...c,updateAvailable:c.desktopUpdate||c.runtimeUpdate};
  }
  const updateAvailable=isNewer(available,current);
  if(updateAvailable){if(m.schema!==2)fail('NPM_ASSETS_REQUIRED','This update is not distributed through npm');if(m.version!==available)fail('INVALID_MANIFEST','Manifest version does not match npm');validateManifest(m,p.platform);}
  return {ok:true,current,available,updateAvailable};
}
export async function prepareUpdate(current,{p=paths(),resolve=latest,manifest=manifestFor,assemble=assembleNpmAsset,report=()=>{},signal}={}) {
  return locked(p,async()=>{
    if(state(p)?.version!==current)fail('UNMANAGED_TARGET','The running desktop must match its managed installation');
    const checked=await checkUpdate(current,{resolve,manifest,p});
    if(!checked.updateAvailable)return {...checked,unchanged:true};
    const m=await manifest(checked.managerAvailable||checked.available),asset=validateManifest(m,p.platform);
    if(m.schema!==2||m.version!==checked.available)fail('INVALID_MANIFEST','Unexpected desktop manifest');
    const base=path.join(p.manager,'prepared');rejectLinks(base);fs.mkdirSync(base,{recursive:true,mode:0o700});
    const dir=fs.mkdtempSync(path.join(base,'update-')),archive=path.join(dir,'desktop.tar.gz');
    const cache=path.join(p.manager,'npm-assets');rejectLinks(cache);
    try{
      // The app may stay open: only read program resources, never user data.
      const native=checked.desktopUpdate!==false;
      if(native&&p.target){rejectLinks(p.target);await reuseInstalledBlocks(asset,p.target,cache,{report,signal});}
      const transfer=native?await assemble(asset,archive,cache,tarExecutable(),{report,signal}):{downloadBytes:0,downloadBlocks:0};
      if(m.runtimes)await ensureRuntime(m.runtimes,{p,report,signal});
      // Verify even when a download adapter is supplied.
      if(native&&(fs.statSync(archive).size!==asset.size||await digestFile(archive)!==asset.sha256))fail('CHECKSUM_MISMATCH','Prepared update checksum mismatch');
      const receipt=path.join(dir,'receipt.json');
      exclusive(receipt,{schema:m.binding?2:1,current,version:m.version,platform:p.platform,manifest:m,...(m.binding?{desktopUpdate:native,runtimeVersion:m.runtimes.version}:{}),...(transfer?{transfer}:{})});
      return {...checked,receipt,...(transfer?{transfer}:{})};
    }catch(e){fs.rmSync(dir,{recursive:true,force:true});throw e;}
  });
}
export function readPrepared(receipt,p=paths()) {
  const base=path.join(p.manager,'prepared');rejectLinks(receipt);
  if(path.basename(receipt)!=='receipt.json'||path.dirname(path.dirname(path.resolve(receipt)))!==path.resolve(base))fail('UNSAFE_PATH','Unexpected update receipt');
  const r=JSON.parse(fs.readFileSync(receipt,'utf8'));
  if(![1,2].includes(r.schema)||r.platform!==p.platform||r.version!==r.manifest?.version||r.manifest?.schema!==2||(r.schema===1&&!isNewer(r.version,r.current))||(r.schema===2&&(!r.manifest.binding||r.runtimeVersion!==r.manifest.runtimes?.version)))fail('INVALID_MANIFEST','Invalid prepared update');
  validateManifest(r.manifest,p.platform);
  return {...r,archive:r.schema===2&&r.desktopUpdate===false?undefined:path.join(path.dirname(receipt),'desktop.tar.gz')};
}
export async function applyPrepared(receipt,{p=paths(),apply=install}={}) {
  const r=readPrepared(receipt,p);
  return apply({version:r.manifest.binding?.managerVersion||r.version,manifest:r.manifest,archive:r.archive,expectedCurrent:r.current});
}
export async function restorePrepared(current,p=paths()) {
  const base=path.join(p.manager,'prepared');rejectLinks(base);
  if(!fs.existsSync(base))return null;
  const candidates=[];
  for(const name of fs.readdirSync(base).filter(n=>/^update-[a-zA-Z0-9]+$/.test(n))){
    const receipt=path.join(base,name,'receipt.json');
    try{const r=readPrepared(receipt,p);if(r.current===current&&(!r.archive||(fs.statSync(r.archive).size===validateManifest(r.manifest,p.platform).size&&await digestFile(r.archive)===validateManifest(r.manifest,p.platform).sha256)))candidates.push({ok:true,current,available:r.version,managerAvailable:r.manifest.binding?.managerVersion,runtimeVersion:r.runtimeVersion,updateAvailable:true,receipt});}catch{}
  }
  return candidates.sort((a,b)=>isNewer(a.available,b.available)?-1:isNewer(b.available,a.available)?1:0)[0]||null;
}
export async function waitForExit({isRunning=running,timeoutMs=120000,intervalMs=500,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  const end=Date.now()+timeoutMs;
  while(isRunning().length){if(Date.now()>=end)fail('APP_RUNNING','The app did not quit; the current installation was preserved');await sleep(intervalMs);}
}
export async function finishUpdate(receipt,{wait=waitForExit,apply=applyPrepared,restart=launch}={}) {
  await wait(); // Never force-kill a user task or the original Codex.
  let result;
  try{result=await apply(receipt);}catch(e){try{restart();}catch{}throw e;}
  // Installation success and launch success are separate outcomes.
  try{return {...result,restarted:true,launch:restart()};}catch{return {...result,restarted:false};}
}
