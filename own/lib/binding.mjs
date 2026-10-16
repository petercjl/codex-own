// Release bindings select immutable components; npm versions identify managers.
import crypto from 'node:crypto';
export const MANAGER_CONTRACT=2, UPDATER_CONTRACT=2, RUNTIME_CONTRACT=1;
export const canonical=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export const identity=value=>crypto.createHash('sha256').update(canonical(value===undefined?null:value)).digest('hex');
const hash=v=>/^[a-f0-9]{64}$/.test(v||'');
const semver=v=>/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(v||'');
const bad=message=>{throw Object.assign(Error(message),{code:'INCOMPATIBLE_BINDING'});};
export function validateBinding(m,{managerVersion,requireProof=false}={}){
 const b=m.binding;if(!b){if(requireProof)bad('Missing component binding');return null;}
 if(b.schema!==1||b.managerContract!==MANAGER_CONTRACT||!semver(b.managerVersion)||(managerVersion&&b.managerVersion!==managerVersion))bad('Unsupported manager binding');
 if(b.desktop?.artifactVersion!==m.version||b.desktop.identity!==identity(m.platforms)||!hash(b.desktop.inputFingerprint)||![1,UPDATER_CONTRACT].includes(b.desktop.updaterContract))bad('Desktop identity or contract mismatch');
 if(!m.runtimes||b.runtimes?.artifactVersion!==m.runtimes.version||b.runtimes.identity!==identity(m.runtimes)||!hash(b.runtimes.inputFingerprint)||b.runtimes.contract!==RUNTIME_CONTRACT)bad('Runtime identity or contract mismatch');
 for(const component of [b.desktop,b.runtimes]){
  const s=component.source;if(!s||s.repository!=='petercjl/codex-own'||!/^[a-f0-9]{40}$/.test(s.ref||'')||!/^\d+$/.test(String(s.run||''))||!s.workflow?.startsWith('.github/workflows/'))bad('Missing original build provenance');
 }
 if(requireProof&&(b.desktop.updaterContract!==UPDATER_CONTRACT||b.desktop.verifiedPlatforms?.join(',')!=='darwin-arm64,win32-x64'||b.runtimes.verifiedPlatforms?.join(',')!=='darwin-arm64,win32-x64'))bad('A verified bridge desktop and both runtime platforms are required for ordinary reuse');
 if(requireProof)for(const platform of ['darwin-arm64','win32-x64']){const a=m.platforms[platform],probe=a?.probe;if(!probe||!hash(probe.sha256)||!Number.isSafeInteger(probe.offset)||!Number.isSafeInteger(probe.size)||probe.offset<0||probe.size<1||probe.offset+probe.size>a.size)bad('Missing pinned native invocation proof');}
 return b;
}
export function packageManifest(p,version){
 const m=p.ownDesktopManifest;
 if(p.name!=='@petercjl/codex-own'||p.version!==version||m?.schema!==2)bad('Unexpected npm package identity');
 if(m.binding)validateBinding(m,{managerVersion:version});else if(m.version!==version)bad('Legacy manager/desktop version mismatch');
 return m;
}
export function desktopIdentity(m,platform){return m.binding?m.platforms[platform].sha256:null;}
export function sameDesktop(s,m,platform){
 if(!s)return false;const id=desktopIdentity(m,platform);
 return id?(s.desktop?s.desktop.identity===id:s.version===m.version):s.version===m.version;
}
export function components(s,m,platform,runtimeVersion){
 if(s?.desktop&&s.version===m.version&&s.desktop.identity!==m.platforms[platform].sha256)bad('Published desktop version cannot change identity');
 const parse=v=>/^\d+\.\d+\.\d+$/.test(v||'')?v.split('.').map(Number):null,a=parse(s?.version),b=parse(m.version);
 const newerInstalled=!!a&&!!b&&a.some((n,i)=>a.slice(0,i).every((x,j)=>x===b[j])&&n>b[i]);
 return {managerVersion:m.binding?.managerVersion||m.version,desktopVersion:m.version,runtimeVersion:m.runtimes?.version||null,newerInstalled,desktopUpdate:!newerInstalled&&!sameDesktop(s,m,platform),runtimeUpdate:!newerInstalled&&!!m.runtimes&&runtimeVersion!==m.runtimes.version};
}
