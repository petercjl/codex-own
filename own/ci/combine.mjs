import fs from 'node:fs';
import path from 'node:path';
import {validateManifest} from '../lib/manager.mjs';
const dir=process.argv[2],version=process.argv[3];let result={schema:1,repository:'petercjl/codex-own',version,platforms:{},provenance:{}};
function walk(d){return fs.readdirSync(d,{withFileTypes:true}).flatMap(x=>x.isDirectory()?walk(path.join(d,x.name)):[path.join(d,x.name)]);}
for(const file of walk(dir).filter(f=>/manifest-(darwin-arm64|win32-x64)\.json$/.test(f))){const m=JSON.parse(fs.readFileSync(file));if(m.version!==version)throw Error('Version mismatch');for(const [k,v]of Object.entries(m.platforms)){validateManifest(m,k);if(result.platforms[k])throw Error('Duplicate platform');result.platforms[k]=v;result.provenance[k]=m.provenance;}}
if(!result.platforms['darwin-arm64'])throw Error('macOS build missing');
fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(result,null,2),{flag:'wx'});
