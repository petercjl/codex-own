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
    const deadline=Date.now()+15*60*1000;
    for(;;){
      try{await assembleNpmAsset(asset,path.join(dir,'verified.tar.gz'),path.join(dir,'cache'),tarExecutable());break;}
      catch(e){
        if(e.code!=='DOWNLOAD_FAILED'||Date.now()>=deadline)throw e;
        console.log(`Waiting for npm tarball availability (${platform}): ${e.message}`);
        await new Promise(r=>setTimeout(r,30000));
      }
    }
    console.log(JSON.stringify({ok:true,platform,version:manifest.version,downloadSource:'registry.npmjs.org',sha256:asset.sha256}));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
for(const [platform,assets]of Object.entries(manifest.runtimes?.platforms||{}))for(const [name,asset]of Object.entries(assets)){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'own-runtime-registry-'));
 try{await assembleNpmAsset(asset,path.join(dir,'verified.bin'),path.join(dir,'cache'),tarExecutable());console.log(JSON.stringify({ok:true,platform,tool:name,version:manifest.runtimes.version,sha256:asset.sha256}));}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
}
