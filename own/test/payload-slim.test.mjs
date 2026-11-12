import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import vm from 'node:vm';
import {slimMacPayload,slimPresentationSource,planPresentationResources} from '../builders/payload-slim.mjs';
function macho(text='abcdefgh',signature='sign'){
 const b=Buffer.alloc(220);b.writeUInt32LE(0xfeedfacf,0);b.writeUInt32LE(0x100000c,4);b.writeUInt32LE(2,12);b.writeUInt32LE(2,16);b.writeUInt32LE(168,20);
 b.writeUInt32LE(0x19,32);b.writeUInt32LE(152,36);b.writeUInt32LE(1,96);b.write('__text',104);b.write('__TEXT',120);b.writeBigUInt64LE(8n,144);b.writeUInt32LE(200,152);
 b.writeUInt32LE(0x1d,184);b.writeUInt32LE(16,188);b.writeUInt32LE(208,192);b.writeUInt32LE(12,196);b.write(text,200);b.write(signature,208);return b;
}
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'own-payload-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const write=(p,b)=>{const f=path.join(root,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,b);};return {root,write};}
test('CLI signing differences permit one internal executable; changed machine code refuses mutation',t=>{
 const {root,write}=fixture(t);write('codex',macho());write('codex-cli/CodexCLI.app/Contents/MacOS/codex',macho('abcdefgh','other-sign'));
 const result=slimMacPayload(root);assert.equal(result.savedBytes,220);assert(fs.lstatSync(path.join(root,'codex')).isSymbolicLink());assert.equal(fs.readFileSync(path.join(root,'codex')).length,220);assert.equal(slimMacPayload(root).savedBytes,0);
 fs.unlinkSync(path.join(root,'codex'));write('codex',macho('changed!'));assert.throws(()=>slimMacPayload(root),/different runtime/);assert(fs.lstatSync(path.join(root,'codex')).isFile());
});
test('browser duplicates share only identical application-owned bytes and retain different resources',t=>{
 const {root,write}=fixture(t),base='cua_node/lib/node_modules/@oai/browser-desktop/scripts/browser-accessibility.wasm.br',copy='cua_node/lib/node_modules/@oai/cua/dist/lib/js/oai_js_browser/dist/skill/scripts/browser-accessibility.wasm.br',different='plugins/openai-bundled/plugins/chrome/scripts/browser-accessibility.wasm.br';write(base,'wasm');write(copy,'wasm');write(different,'wasm');
 assert.equal(slimMacPayload(root).savedBytes,4);assert(fs.lstatSync(path.join(root,copy)).isSymbolicLink());assert.equal(fs.readFileSync(path.join(root,copy),'utf8'),'wasm');assert(fs.lstatSync(path.join(root,different)).isFile());
});
test('payment animation no longer initializes media, while demo removal preserves surrounding controls across bundlers',()=>{
 const source='const url="assets/payment-success-celebration.x.webm";function animation(){throw Error("media requested")}const exports={PaymentCelebrationAnimation:()=>animation};';
 const result=slimPresentationSource(source),context={};vm.runInNewContext(result.source+';this.result=animation()',context);assert.equal(context.result,null);assert.equal(slimPresentationSource(result.source).source,result.source);
 for(const source of ['const demo=r.p+"assets/appshot-demo.x.mp4";const result=jsx("video",{src:demo});const control="keep";', 'let demo;demo=``+new URL(`appshot-demo.x.mp4`,import.meta.url).href;const result=jsx(`video`,{src:demo});const control="keep";']){const x=slimPresentationSource(source);assert.match(x.source,/result=null/);assert.match(x.source,/control="keep"/);}
 assert.throws(()=>slimPresentationSource('const demo="appshot-demo.x.mp4";changedRenderer(demo)'),/contract changed/);
});
test('presentation inventory removes only explicitly disabled assets and keeps feature media',()=>{
 const files={'webview/assets/demo.js':'const demo="assets/appshot-demo.x.mp4";const result=jsx("video",{src:demo});','webview/assets/appshot-demo.x.mp4':'video','webview/assets/feature.mp4':'feature'};
 const asar={listPackage:()=>Object.keys(files),extractFile:(_a,n)=>Buffer.from(files[n.replaceAll('\\','/')]),statFile:(_a,n)=>({size:files[n.replaceAll('\\','/')].length})};
 const plan=planPresentationResources(asar,'fixture');assert.deepEqual([...plan.removed],['webview/assets/appshot-demo.x.mp4']);assert.equal(plan.report.removedBytes,5);assert.equal(plan.changes.size,1);
});
