import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {employeeImage} from '../image.ts';
test('image credentials require exact verified enterprise identity and return only the current employee key',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'own-image-registry-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file=path.join(root,'bindings.json');
 const bindings=['alice','bob'].map(unionId=>({corpId:'corp',unionId,verified:true,enabled:true,credential:{schemaVersion:1,site:'cn',apiKey:'sk-fixture-key-for-'+unionId},models:['doubao-seedream-5-5']}));
 await fs.writeFile(file,JSON.stringify({schemaVersion:1,bindings}),{flag:'wx',mode:0o600});
 const alice=await employeeImage(file,'corp','alice');assert.equal(alice.enabled,true);assert(!JSON.stringify(alice).includes('bob'));
 assert.equal((await employeeImage(file,'other','alice')).enabled,false);assert.equal((await employeeImage(file,'corp','unknown')).reason,'KEY_BINDING_UNVERIFIED');assert.equal((await employeeImage(undefined,'corp','alice')).enabled,false);
});
