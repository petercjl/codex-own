/** Preserve upstream attribution while applying the Rebuild about-panel label. */
const fs=require('node:fs');
const {locateBundles,relPath}=require('./patch-util');
const {copyrightPatches,NEW_COPYRIGHT}=require('./patch-copyright-rule');
function main(){
 const args=process.argv.slice(2),check=args.includes('--check'),platform=args.find(a=>['mac-arm64','mac-x64','win'].includes(a));
 const bundles=locateBundles({dir:'build',pattern:/^main(-[^.]+)?\.js$/,platform});
 if(!bundles.length)throw Error('No main bundle found');
 for(const bundle of bundles){
  const source=fs.readFileSync(bundle.path,'utf8'),patches=copyrightPatches(source);
  if(!patches.length){if(!source.includes(NEW_COPYRIGHT))throw Error('Unknown upstream copyright layout');console.log('[verified] '+relPath(bundle.path));continue;}
  if(check){console.log('[check] '+relPath(bundle.path)+': '+patches.length);continue;}
  let result=source;for(const p of patches)result=result.slice(0,p.start)+p.replacement+result.slice(p.end);
  fs.writeFileSync(bundle.path,result);console.log('[patched] '+relPath(bundle.path)+': '+patches.length);
 }
}
main();
