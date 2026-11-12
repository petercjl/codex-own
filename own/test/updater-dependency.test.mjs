import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
import {dependencyRoot,probeApplicationNode} from '../builders/updater.mjs';
test('updater includes a dependency whose package exports only subpaths',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'own-subpath-dependency-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const packageRoot=path.join(root,'node_modules','@fixture','subpaths');fs.mkdirSync(packageRoot,{recursive:true});
 fs.writeFileSync(path.join(packageRoot,'package.json'),JSON.stringify({name:'@fixture/subpaths',version:'1.0.0',exports:{'./helper':'./helper.js'}}));
 fs.writeFileSync(path.join(packageRoot,'helper.js'),'module.exports=1;');const resolver=createRequire(path.join(root,'entry.cjs'));
 assert.equal(dependencyRoot('@fixture/subpaths',resolver),packageRoot);assert.throws(()=>dependencyRoot('@fixture/absent',resolver),/missing/);
});

test('application runtime probes execute a standalone copy before signing and clean it on success or failure',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'own-probe-fixture-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const app=path.join(root,'fixture.app'),node=path.join(app,'node');fs.mkdirSync(app);fs.writeFileSync(node,'runtime');let probePath;
 const probe=file=>{probePath=file;assert(!file.startsWith(app+path.sep));assert.equal(fs.readFileSync(file,'utf8'),'runtime');return 'verified';};
 assert.equal(probeApplicationNode(node,probe,{temporaryRoot:root}),'verified');assert(!fs.existsSync(probePath));
 assert.throws(()=>probeApplicationNode(node,file=>{probePath=file;throw Error('probe error')},{temporaryRoot:root}),/probe error/);assert(!fs.existsSync(probePath));assert.equal(fs.readFileSync(node,'utf8'),'runtime');
});
