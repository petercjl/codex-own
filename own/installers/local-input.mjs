// Private offline candidates carry source evidence, never public build claims.
export function localInstallerVersion(manifest){
 const c=manifest?.localCandidate;
 if(manifest?.schema!==1||manifest.binding||manifest.repository!=='petercjl/codex-own'||!/^\d+\.\d+\.\d+$/.test(manifest.version||'')||c?.schema!==1||c.private!==true||!/^[a-f0-9]{64}$/.test(c.sourceFingerprint||'')||!/^[a-f0-9]{64}$/.test(c.baseDesktopSha256||'')||!/^\d+\.\d+\.\d+$/.test(c.baseVersion||'')||Object.keys(manifest.platforms||{}).join(',')!=='win32-x64')throw Object.assign(Error('Invalid private Windows candidate identity'),{code:'INVALID_INSTALLER'});
 return manifest.version;
}
