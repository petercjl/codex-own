// Windows-owned build and QA. No registry mutation or live profile writes.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {snapshot} from './artifact-inputs.mjs';import {validateLocalProof} from './local-proof.mjs';
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
export function publicGitEnvironment(original){const env={...original},n=Number(env.GIT_CONFIG_COUNT||0);if(!Number.isSafeInteger(n)||n<0||n>30)throw Error('INVALID_GIT_ENVIRONMENT');env.GIT_CONFIG_COUNT=String(n+2);env['GIT_CONFIG_KEY_'+n]='url.https://github.com/.insteadOf';env['GIT_CONFIG_VALUE_'+n]='ssh://git@github.com/';env['GIT_CONFIG_KEY_'+(n+1)]='url.https://github.com/.insteadOf';env['GIT_CONFIG_VALUE_'+(n+1)]='git@github.com:';return env;}
export function nativeSteps(app,gui){return [['official-protocol',['own/ci/test-official-compat.mjs',app]],['patch-protocol',['own/ci/test-patch-compat.mjs',app]],['history-resume',['own/ci/test-history-resume.mjs',app]],['desktop-gui',['own/ci/test-desktop-startup.mjs',app,gui]],['canonical-install',['own/ci/test-incremental.mjs']]];}
export function buildLocal({version,output,installDependencies=false}){
 if(process.platform!=='win32'||process.arch!=='x64')throw Error('WINDOWS_X64_REQUIRED');if(!/^\d+\.\d+\.\d+$/.test(version||''))throw Error('EXACT_VERSION_REQUIRED');
 const root=process.cwd(),dir=path.resolve(output);if(fs.existsSync(dir))throw Error('FRESH_OUTPUT_REQUIRED');fs.mkdirSync(dir,{recursive:true});
 const ref=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),inputs=snapshot(root,{ref});
 if(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim())throw Error('COMMITTED_SOURCE_REQUIRED');
 const env={...publicGitEnvironment(process.env),OWN_VERSION:version,OWN_PLATFORM:'win32-x64'},checks=[];
 function run(name,args,cwd=root){const file=path.join(dir,name+'.log'),fd=fs.openSync(file,'wx');let ok=false;try{execFileSync(process.execPath,args,{cwd,env,stdio:['ignore',fd,fd],windowsHide:true});ok=true;}finally{fs.closeSync(fd);checks.push({name,ok,logSha256:hash(file)});fs.writeFileSync(path.join(dir,name+'.json'),JSON.stringify(checks.at(-1)),{flag:'wx'});}if(!ok)throw Error('LOCAL_CHECK_FAILED: '+name);console.log(name+' passed');}
 if(installDependencies){const npm=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');if(!fs.existsSync(npm))throw Error('BUILD_NPM_REQUIRED');for(const [name,cwd]of [['root-dependencies',root],['manager-dependencies',path.join(root,'own')]])run(name,[npm,'ci','--ignore-scripts','--no-audit','--no-fund'],cwd);}
 const tests=fs.readdirSync('own/test').filter(n=>n.endsWith('.test.mjs')).sort().map(n=>'test/'+n);run('source-tests',['--test','--test-concurrency=2',...tests],path.join(root,'own'));
 const build=path.join(root,'out','own-release-'+version+'-win32-x64.noindex');if(fs.existsSync(build))throw Error('BUILD_OUTPUT_EXISTS');run('build',['own/build.mjs']);
 const app=path.join(build,'built/app');env.OWN_GUI_MANIFEST=path.join(build,'manifest-win32-x64.json');
 for(const [name,args]of nativeSteps(app,path.join(dir,'gui')))run(name,args);
 const tools=path.join(dir,'tools');fs.mkdirSync(tools);run('prepare-tools',['own/ci/prepare-runtimes.mjs',tools,'win32-x64','own/artifacts/current.json']);run('tool-runtime',['own/ci/test-runtimes.mjs',tools]);
 if(snapshot(root).native!==inputs.native)throw Error('SOURCE_CHANGED');
 const m=JSON.parse(fs.readFileSync(env.OWN_GUI_MANIFEST)),a=m.platforms['win32-x64'];
 const proof=validateLocalProof({schema:1,execution:'local',platform:'win32-x64',sourceRef:ref,run:String(Date.now()),nativeFingerprint:inputs.native,runtimeFingerprint:inputs.runtime,checks,artifact:{sha256:a.incremental.sha256,size:a.incremental.size,cliVersion:a.probe.version}});
 fs.writeFileSync(path.join(dir,'local-proof.json'),JSON.stringify(proof,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({ok:true,build,proof:path.join(dir,'local-proof.json')}));return proof;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){if(process.argv.includes('--help'))console.log('node own/ci/local-native-build.mjs VERSION NEW_EVIDENCE_DIR [--install-dependencies]');else buildLocal({version:process.argv[2],output:process.argv[3],installDependencies:process.argv.includes('--install-dependencies')});}
