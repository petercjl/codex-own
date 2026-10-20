import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';import {hashFile} from './offline-install.mjs';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REF!=='refs/heads/own-main'||process.env.GITHUB_REPOSITORY!=='petercjl/codex-own')throw Error('Installer publication requires the trusted own-main workflow');
const root=path.resolve(process.argv[2]),version=process.env.OWN_INSTALLER_VERSION,repo='petercjl/codex-own';if(!/^\d+\.\d+\.\d+$/.test(version||''))throw Error('Exact version required');
const files=[];for(const platform of ['darwin-arm64','win32-x64']){
 const dir=path.join(root,'first-installer-'+platform),recordFile=path.join(dir,'installer-'+platform+'.json'),qaFile=path.join(dir,'installer-qa-'+platform+'.json'),record=JSON.parse(fs.readFileSync(recordFile)),qa=JSON.parse(fs.readFileSync(qaFile));
 if(record.version!==version||record.platform!==platform||record.sourceRun!==process.env.GITHUB_RUN_ID||record.sourceRef!==process.env.GITHUB_SHA||qa.version!==version||qa.platform!==platform||!qa.offline||!qa.repeatInstallPreservesData||!qa.existingUpdaterRecognizesInstallation)throw Error('Installer QA/provenance mismatch');
 const file=path.join(dir,record.artifact);if(path.dirname(file)!==dir||fs.statSync(file).size!==record.size||await hashFile(file)!==record.sha256)throw Error('Installer checksum mismatch');
 files.push(file,recordFile,qaFile,path.join(dir,'SHA256-'+platform+'.txt'));
}
const notes=path.join(root,'INSTALLATION.md');if(fs.existsSync(notes))throw Error('Notes output exists');fs.copyFileSync(new URL('./FIRST-INSTALL.md',import.meta.url),notes,fs.constants.COPYFILE_EXCL);files.push(notes);
const tag='installers-v'+version;let release;
try{release=JSON.parse(execFileSync('gh',['release','view',tag,'--repo',repo,'--json','assets,isDraft'],{encoding:'utf8'}));}catch{execFileSync('gh',['release','create',tag,'--repo',repo,'--target',process.env.GITHUB_SHA,'--draft','--title',`codex-own ${version} 完整安装包`,'--notes-file',notes],{stdio:'inherit'});release={assets:[],isDraft:true};}
for(const file of files){const existing=release.assets.find(a=>a.name===path.basename(file));if(existing){if(existing.size!==fs.statSync(file).size||existing.digest!=='sha256:'+await hashFile(file))throw Error('Immutable installer exists with another checksum');}else{if(!release.isDraft)throw Error('Published installer release is immutable');execFileSync('gh',['release','upload',tag,'--repo',repo,file],{stdio:'inherit'});}}
const latest=await fetch('https://registry.npmjs.org/@petercjl%2fcodex-own/latest');if(!latest.ok)throw Error('Cannot confirm stable release');const current=await latest.json();
execFileSync('gh',['release','edit',tag,'--repo',repo,'--draft=false','--latest='+String(current.version===version),'--notes-file',notes],{stdio:'inherit'});
console.log(JSON.stringify({ok:true,version,tag,url:`https://github.com/${repo}/releases/tag/${tag}`,platforms:['darwin-arm64','win32-x64'],offline:true,npmChanged:false,immutable:true}));
