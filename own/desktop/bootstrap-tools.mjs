// Runs with the independent updater's Node, including migration from 0.4.x.
import fs from 'node:fs';
import {manifestFor} from '../lib/manager.mjs';
import {installRuntime} from '../lib/tool-runtime.mjs';
import {paths,installedBinding} from '../lib/manager.mjs';
import {validateBinding} from '../lib/binding.mjs';
const meta=JSON.parse(fs.readFileSync(new URL('../desktop-version.json',import.meta.url)));
const cancellation=new AbortController();
process.on('message',message=>{if(message?.cancel)cancellation.abort();});
process.on('disconnect',()=>cancellation.abort());
try{
 const embedded=JSON.parse(fs.readFileSync(new URL('../release.json',import.meta.url)));
 const selected=installedBinding(paths());if(selected)validateBinding(selected);
 const manifest=selected?.binding?.desktop.artifactVersion===meta.version?selected:embedded.runtimes?.version===meta.toolRuntimeVersion?embedded:await manifestFor(meta.version);
 if(!manifest.runtimes||(manifest!==selected&&manifest.runtimes.version!==meta.toolRuntimeVersion))throw Error('Desktop runtime pin does not match npm release');
 const result=await installRuntime(manifest.runtimes,{signal:cancellation.signal,report:message=>process.stderr.write(message+'\n')});
 if(!result.ok)throw Error('Private tool verification failed');
 process.stdout.write(JSON.stringify(result)+'\n');
}catch(e){process.stderr.write(`运行时准备失败：${e.code||'RUNTIME_INSTALL_FAILED'} ${e.message}\n`);process.exitCode=1;}
finally{if(process.connected)process.disconnect();}
