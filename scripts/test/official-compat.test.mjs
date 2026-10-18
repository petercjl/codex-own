import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {findMacApplication,missingUnpacked,restoreMsixUnpackedPaths,patchWindowsIntegrity,repackAsar,extractAsar,selectPlatforms}=require('../upstream-compat.js');
const {hasNativeArchiveDelete}=require('../patch-archive-native.js');
const {copyrightPatches}=require('../patch-copyright-rule.js');
const asar=require('@electron/asar');
const fixture=()=>fs.mkdtempSync(path.join(os.tmpdir(),'own-official-contract-'));
test('Mac locator supports either official bundle name and refuses ambiguous applications',()=>{
 const root=fixture();for(const name of ['Codex.app','ChatGPT.app']){const app=path.join(root,name);fs.mkdirSync(path.join(app,'Contents/Resources'),{recursive:true});fs.writeFileSync(path.join(app,'Contents/Resources/app.asar'),'');assert.equal(findMacApplication(root),app);fs.rmSync(app,{recursive:true});}
 for(const name of ['One.app','Two.app']){fs.mkdirSync(path.join(root,name,'Contents/Resources'),{recursive:true});fs.writeFileSync(path.join(root,name,'Contents/Resources/app.asar'),'');}assert.throws(()=>findMacApplication(root),/ambiguous/i);
});
test('missing unpacked files stop extraction unless a caller explicitly supplies an allowance',()=>{
 const root=fixture(),archive=path.join(root,'app.asar');
 assert.deepEqual(missingUnpacked({files:{'critical.node':{unpacked:true}}},archive,{allowed:new Set(['critical.node'])}),['critical.node']);
 assert.throws(()=>missingUnpacked({files:{'critical.node':{unpacked:true}}},archive),/critical.node/);
});
test('MSIX scoped native paths restore exact package bytes, reject collisions and remain idempotent',async()=>{
 const root=fixture(),input=path.join(root,'input'),name='node_modules/@worklouder/device-kit-oai/node_modules/@serialport/bindings-cpp/build/Release/bindings.node';
 const file=path.join(input,name),bytes=Buffer.alloc(256);bytes.write('MZ');bytes.writeUInt32LE(128,0x3c);bytes.write('PE\0\0',128);bytes.writeUInt16LE(0x8664,132);
 fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);const archive=path.join(root,'app.asar');await asar.createPackageWithOptions(input,archive,{unpack:'*.node'});
 const normal=path.join(archive+'.unpacked',name),encoded=path.join(archive+'.unpacked',name.replaceAll('@','%40'));
 fs.mkdirSync(path.dirname(encoded),{recursive:true});fs.renameSync(normal,encoded);
 assert.throws(()=>extractAsar(archive,path.join(root,'missing')),/missing/i);
 const records=restoreMsixUnpackedPaths(archive);assert.equal(records.length,1);assert.equal(records[0].sha256,crypto.createHash('sha256').update(bytes).digest('hex'));assert.deepEqual(fs.readFileSync(normal),bytes);
 assert.deepEqual(restoreMsixUnpackedPaths(archive),[]);assert.deepEqual(missingUnpacked(asar.getRawHeader(archive).header,archive),[]);
 fs.writeFileSync(normal,'collision');assert.throws(()=>restoreMsixUnpackedPaths(archive),/collision/);fs.unlinkSync(normal);
 const wrong=Buffer.from(bytes);wrong.writeUInt16LE(0x14c,132);fs.writeFileSync(encoded,wrong);assert.throws(()=>restoreMsixUnpackedPaths(archive),/Windows x64 PE/);assert.ok(!fs.existsSync(normal));
});
test('Windows integrity targets the executable carrying the resource and rejects absent or duplicate matches',()=>{
 const root=fixture(),before='a'.repeat(64),after='b'.repeat(64);fs.writeFileSync(path.join(root,'Codex.exe'),'launcher');fs.writeFileSync(path.join(root,'ChatGPT.exe'),'resource:'+before);
 assert.equal(path.basename(patchWindowsIntegrity(root,before,after)),'ChatGPT.exe');assert.match(fs.readFileSync(path.join(root,'ChatGPT.exe'),'utf8'),new RegExp(after));assert.throws(()=>patchWindowsIntegrity(root,before,after),/integrity/i);
 fs.writeFileSync(path.join(root,'Codex.exe'),before+before);assert.throws(()=>patchWindowsIntegrity(root,before,after),/integrity/i);
});
test('ASAR extraction and repack preserve unpacked natives, links and packed-file integrity',async()=>{
 const root=fixture(),input=path.join(root,'input');fs.mkdirSync(input);fs.writeFileSync(path.join(input,'main.js'),'original');fs.writeFileSync(path.join(input,'native.node'),'native');if(process.platform!=='win32')fs.symlinkSync('main.js',path.join(input,'link.js'));
 const source=path.join(root,'app.asar');await asar.createPackageWithOptions(input,source,{unpack:'*.node'});
 fs.writeFileSync(path.join(source+'.unpacked','native.node'),'signed-native');
 const extracted=path.join(root,'extracted');extractAsar(source,extracted);assert.equal(fs.readFileSync(path.join(extracted,'native.node'),'utf8'),'signed-native');
 fs.writeFileSync(path.join(extracted,'main.js'),'updated');const target=path.join(root,'out.asar');await repackAsar(source,extracted,target);
 assert.equal(asar.extractFile(target,'main.js').toString(),'updated');assert.equal(asar.extractFile(target,'native.node').toString(),'signed-native');const h=asar.getRawHeader(target).header;assert.equal(h.files['native.node'].unpacked,true);if(process.platform!=='win32')assert.equal(h.files['link.js'].link,'main.js');assert.equal(h.files['main.js'].integrity.hash,crypto.createHash('sha256').update('updated').digest('hex'));
});
test('native archived deletion requires executable UI and RPC call structure, not token comments',()=>{
 const source='function row({archivedThread,showDeleteButton,onDelete}){return {onDelete}}; function remove(client,id){return client.deleteArchivedConversation(id)}';
 assert.equal(hasNativeArchiveDelete(source),true);assert.equal(hasNativeArchiveDelete('// archivedThread showDeleteButton onDelete deleteArchivedConversation'),false);assert.equal(hasNativeArchiveDelete(source.replace('client.deleteArchivedConversation(id)','client.archiveConversation(id)')),false);
});
test('copyright recognizes the native about HTML template and remains idempotent',()=>{
 const source='const html=`<div class="copyright">© OpenAI</div>`;';const patches=copyrightPatches(source);assert.equal(patches.length,1);let result=source;for(const p of patches)result=result.slice(0,p.start)+p.replacement+result.slice(p.end);assert.match(result,/© OpenAI · Cometix Space/);assert.deepEqual(copyrightPatches(result),[]);
});
test('platform selection rejects contradictory or unknown arguments',()=>{
 assert.deepEqual(selectPlatforms(['--platform','mac-arm64']),['mac-arm64']);assert.deepEqual(selectPlatforms(['--skip-mac']),['win']);assert.throws(()=>selectPlatforms(['--platform','win','--skip-win']));assert.throws(()=>selectPlatforms(['--platform','wrong']));
});
