import fs from 'node:fs';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
// Windows may briefly deny CreateProcess while a newly copied executable is scanned.
// Retry only launch failures, never a program error or changed executable bytes.
export async function nativeVersion(file,{platform=process.platform,spawn=spawnSync,wait=ms=>new Promise(r=>setTimeout(r,ms)),attempts=11,delay=1000,log=console.warn}={}) {
  const hash=digest(file);
  for(let n=0;n<attempts;n++){
    if(digest(file)!==hash)throw Error('Native CLI changed during launch verification');
    const r=spawn(file,['--version'],{encoding:'utf8',timeout:30000,windowsHide:true});
    if(!r.error&&r.status===0&&r.stdout?.trim())return r.stdout.trim();
    if(platform==='win32'&&['UNKNOWN','EBUSY','ETXTBSY'].includes(r.error?.code)&&n+1<attempts){log(`[codex-own] Native CLI launch retry ${n+1}/${attempts-1}: ${r.error.code}; sha256=${hash}`);await wait(delay);continue;}
    throw Error(`Native CLI version check failed: ${r.error?.code||r.status}; sha256=${hash}; ${r.error?.message||r.stderr||'empty version output'}`);
  }
}
