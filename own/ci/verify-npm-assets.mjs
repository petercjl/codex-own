import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {assembleNpmAsset} from '../lib/npm-assets.mjs';
import {validateManifest,tarExecutable} from '../lib/manager.mjs';
const manifest=JSON.parse(fs.readFileSync(process.argv[2]));
if(manifest.schema!==2)throw Error('npm asset manifest required');
for(const platform of ['darwin-arm64','win32-x64']){
  const asset=validateManifest(manifest,platform),dir=fs.mkdtempSync(path.join(os.tmpdir(),'own-registry-'));
  try{
    await assembleNpmAsset(asset,path.join(dir,'verified.tar.gz'),path.join(dir,'cache'),tarExecutable());
    console.log(JSON.stringify({ok:true,platform,version:manifest.version,downloadSource:'registry.npmjs.org',sha256:asset.sha256}));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
