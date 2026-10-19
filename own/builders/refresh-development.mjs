import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';import {bundleUpdater} from './updater.mjs';import {launcherScript} from './mac-launcher.mjs';
import {updateMacRuntime} from './mac-runtime-overlay.mjs';
const require=createRequire(import.meta.url),{identity}=require('../lib/instance.cjs'),plist=require('plist'),asar=require('@electron/asar');
// Only a copied local candidate is refreshed. Upstream frontend/native assets
// stay byte-identical; the owned runtime is repacked with both integrity gates.
export function refreshDevelopment(app,output){
 if(!app.startsWith(output+path.sep)||app.startsWith('/Applications/'))throw Error('Overlay refresh requires a fresh local candidate');
 const resources=path.join(app,'Contents/Resources');if(identity(resources).channel!=='development')throw Error('Expected development candidate');
 const info=plist.parse(fs.readFileSync(path.join(app,'Contents/Info.plist'),'utf8'));if(info.CFBundleIdentifier!=='local.codex-own.development')throw Error('Development identity mismatch');
 const archive=path.join(resources,'app.asar'),runtime=asar.extractFile(archive,'.vite/build/own-runtime.cjs');
 const sourceRuntime=fs.readFileSync(new URL('../runtime/mac.cjs',import.meta.url));
 if(!runtime.equals(sourceRuntime))updateMacRuntime(app,output,sourceRuntime);
 const prior=path.join(output,'previous-updater');if(fs.existsSync(prior))throw Error('Updater backup exists');fs.renameSync(path.join(resources,'own-updater'),prior);bundleUpdater(resources);
 const launcher=path.join(app,'Contents/MacOS/codex-own-launch'),backup=path.join(output,'previous-launcher');fs.statSync(launcher);fs.copyFileSync(launcher,backup,fs.constants.COPYFILE_EXCL);fs.writeFileSync(launcher,launcherScript(true),{mode:0o755});
 execFileSync('codesign',['--force','--deep','--sign','-',app],{stdio:'inherit'});execFileSync('codesign',['--verify','--deep','--strict',app],{stdio:'inherit'});
}
