import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
import {dependencyRoot} from '../builders/updater.mjs';
test('updater includes a dependency whose package exports only subpaths',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'own-subpath-dependency-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const packageRoot=path.join(root,'node_modules','@fixture','subpaths');fs.mkdirSync(packageRoot,{recursive:true});
 fs.writeFileSync(path.join(packageRoot,'package.json'),JSON.stringify({name:'@fixture/subpaths',version:'1.0.0',exports:{'./helper':'./helper.js'}}));
 fs.writeFileSync(path.join(packageRoot,'helper.js'),'module.exports=1;');const resolver=createRequire(path.join(root,'entry.cjs'));
 assert.equal(dependencyRoot('@fixture/subpaths',resolver),packageRoot);assert.throws(()=>dependencyRoot('@fixture/absent',resolver),/missing/);
});
