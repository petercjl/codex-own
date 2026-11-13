import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const cli=path.resolve(import.meta.dirname,'../bin/codex-own.mjs');
test('prepare CLI requires explicit mutation authorization before contacting a registry',t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'own-prepare-cli-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const env={...process.env,HOME:home,CFFIXED_USER_HOME:home,USERPROFILE:home,LOCALAPPDATA:home,APPDATA:home};
 const run=args=>spawnSync(process.execPath,[cli,'update','prepare',...args],{env,encoding:'utf8',timeout:10000});
 const unconfirmed=run([]);assert.equal(unconfirmed.status,1);assert.equal(JSON.parse(unconfirmed.stderr).code,'CONFIRMATION_REQUIRED');
 const missing=run(['--yes']);assert.equal(missing.status,1);assert.equal(JSON.parse(missing.stderr).code,'UNMANAGED_TARGET');
 assert.deepEqual(fs.readdirSync(home),[]);
});
