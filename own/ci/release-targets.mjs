import fs from 'node:fs';
export const releaseTargets=Object.freeze(JSON.parse(fs.readFileSync(new URL('./lifecycle-policy.json',import.meta.url))).targets);
export function assertReleaseTargets(manifest,{runtime=true}={}){
 const expected=releaseTargets.join(',');
 if(Object.keys(manifest.platforms||{}).sort().join(',')!==expected)throw Error('Release desktop platforms must be '+expected);
 if(runtime&&Object.keys(manifest.runtimes?.platforms||{}).sort().join(',')!==expected)throw Error('Release runtime platforms must be '+expected);
 return true;
}
