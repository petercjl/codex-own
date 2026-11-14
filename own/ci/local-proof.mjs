import {identity} from '../lib/binding.mjs';
export const LOCAL_CHECKS=['source-tests','official-protocol','patch-protocol','history-resume','desktop-gui','canonical-install','tool-runtime'];
export function validateLocalProof(proof,{ref,platform='win32-x64'}={}){
 if(proof?.schema!==1||proof.execution!=='local'||proof.platform!==platform||!/^[a-f0-9]{40}$/.test(proof.sourceRef||'')||ref&&proof.sourceRef!==ref||!/^\d+$/.test(proof.run||'')||!['nativeFingerprint','runtimeFingerprint'].every(k=>/^[a-f0-9]{64}$/.test(proof[k]||'')))throw Error('LOCAL_PROOF_IDENTITY');
 if(!Array.isArray(proof.checks)||new Set(proof.checks.map(c=>c.name)).size!==proof.checks.length||LOCAL_CHECKS.some(name=>!proof.checks.some(c=>c.name===name&&c.ok===true&&/^[a-f0-9]{64}$/.test(c.logSha256||''))))throw Error('LOCAL_PROOF_CHECKS');
 const a=proof.artifact;if(!a||!/^[a-f0-9]{64}$/.test(a.sha256||'')||!Number.isSafeInteger(a.size)||a.size<1||!/^codex(?:-cli)?\s+/.test(a.cliVersion||''))throw Error('LOCAL_PROOF_ARTIFACT');
 return proof;
}
export function localSource(proof){validateLocalProof(proof);return {repository:'petercjl/codex-own',ref:proof.sourceRef,run:proof.run,workflow:'.github/workflows/own-release.yml',execution:'local',recipe:'own/ci/local-native-build.mjs',receiptSha256:identity(proof)};}
// workflow is the historical recipe reference consumed by installed managers;
// execution and recipe identify the actual executor. run is a local receipt ID.
export function verifyLocalPublication(pkg,source){
 const proof=validateLocalProof(pkg.ownLocalReleaseProof,{ref:source.ref});
 const sri=pkg.dist?.integrity?.match(/^sha512-([A-Za-z0-9+/=]+)$/);
 if(source.execution!=='local'||source.recipe!=='own/ci/local-native-build.mjs'||source.run!==proof.run||source.receiptSha256!==identity(proof)||!sri||Buffer.from(sri[1],'base64').length!==64)throw Error('LOCAL_PROOF_MISMATCH');
 const asset=pkg.ownDesktopManifest?.platforms?.[proof.platform];if(!asset||asset.sha256!==proof.artifact.sha256||asset.size!==proof.artifact.size)throw Error('LOCAL_PROOF_ARTIFACT_MISMATCH');
 return {ok:true,version:pkg.version,execution:'local',publicationRef:proof.sourceRef,receiptSha256:identity(proof)};
}
