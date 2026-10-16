import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {TRANSPORT} from '../lib/content-blocks.mjs';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');

// The publisher runs on Ubuntu. This integration test supplies an isolated fake
// npm executable and intercepts every fetch; it cannot contact npm or an IdP.
test('publisher verifies both platforms, deduplicates content, reuses a second release and rejects OTP', {skip:process.platform==='win32'},t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'own-publisher-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const bin=path.join(dir,'bin'),store=path.join(dir,'registry');fs.mkdirSync(bin);fs.mkdirSync(store);
  const fake=path.join(bin,'npm');
  fs.writeFileSync(fake,`#!/usr/bin/env node
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const p=JSON.parse(fs.readFileSync('package.json')),f=path.join(process.cwd(),'fake.tgz'),args=process.argv.slice(2);
if(args[0]==='pack'){
 const b=Buffer.concat([Buffer.from(JSON.stringify(p)),fs.readFileSync('payload.bin')]);fs.writeFileSync(f,b,{flag:'wx'});
 const integrity='sha512-'+crypto.createHash('sha512').update(b).digest('base64');
 console.log(JSON.stringify([{name:p.name,filename:'fake.tgz',size:b.length,integrity}]));
}else if(args[0]==='publish'){
 if(!args.includes('--provenance')||args[args.indexOf('--tag')+1]!=='desktop-assets')throw Error('Unsafe publish flags');
 if(process.env.OWN_MOCK_AUTH_FAIL){console.error('npm error code EOTP');process.exit(1);}
 const b=fs.readFileSync(f),dist={integrity:'sha512-'+crypto.createHash('sha512').update(b).digest('base64'),tarball:'https://registry.npmjs.org/@petercjl/codex-own/-/codex-own-'+p.version+'.tgz'};
 fs.writeFileSync(path.join(process.env.OWN_PUBLISH_MOCK_DIR,p.version+'.json'),JSON.stringify({dist}),{flag:'wx'});
}else throw Error('Unexpected npm action');
`,{flag:'wx',mode:0o755});
  // Mark the fake command as ESM independently of any user's directory layout.
  fs.writeFileSync(path.join(bin,'package.json'),JSON.stringify({type:'module'}),{flag:'wx'});
  const preload=path.join(dir,'preload.mjs');
  fs.writeFileSync(preload,`import fs from 'node:fs';import path from 'node:path';
globalThis.fetch=async input=>{
 const url=String(input);if(!url.startsWith('https://registry.npmjs.org/@petercjl%2fcodex-own/'))throw Error('Unexpected network');
 const version=url.split('/').at(-1),file=path.join(process.env.OWN_PUBLISH_MOCK_DIR,version+'.json');
 return fs.existsSync(file)?new Response(fs.readFileSync(file),{status:200}):new Response('',{status:404});
};`,{flag:'wx'});
  const env={...process.env,PATH:bin+path.delimiter+process.env.PATH,NODE_OPTIONS:'--import='+preload,
    GITHUB_ACTIONS:'true',ACTIONS_ID_TOKEN_REQUEST_URL:'https://oidc.invalid',OWN_PUBLISH_MOCK_DIR:store,NODE_AUTH_TOKEN:'',GITHUB_TOKEN:''};
  const publisher=fileURLToPath(new URL('../ci/publish-npm-assets.mjs',import.meta.url));
  function fixture(name,version,edited=false,corrupt=false){
    const d=path.join(dir,name);fs.mkdirSync(d);const platforms={};
    for(const [platform,entry,value] of [['darwin-arm64','codex-own.app',65],['win32-x64','app',66]]){
      const chunks=[Buffer.from('shared verified bytes'),Buffer.alloc(1024,edited&&platform==='darwin-arm64'?67:value)],data=Buffer.concat(chunks);let offset=0;
      const blocks=chunks.map(b=>{const p={sha256:sha(b),size:b.length,offset};offset+=b.length;return p;});
      if(corrupt&&platform==='win32-x64')blocks.at(-1).sha256='0'.repeat(64);
      fs.writeFileSync(path.join(d,'codex-own-'+platform+'.tar'),data,{flag:'wx'});
      platforms[platform]={entry,incremental:{transport:TRANSPORT,size:data.length,sha256:sha(data),blocks}};
    }
    fs.writeFileSync(path.join(d,'manifest.json'),JSON.stringify({schema:1,repository:'petercjl/codex-own',version,platforms}),{flag:'wx'});return d;
  }
  const one=fixture('one','0.4.0');execFileSync(process.execPath,[publisher,one],{env,stdio:'pipe'});
  const first=JSON.parse(fs.readFileSync(path.join(one,'npm-manifest.json')));
  assert.equal(first.schema,2);assert.equal(fs.readdirSync(store).length,3,'shared bytes publish only once');
  const two=fixture('two','0.4.1');execFileSync(process.execPath,[publisher,two],{env,stdio:'pipe'});
  const second=JSON.parse(fs.readFileSync(path.join(two,'npm-manifest.json')));
  assert.deepEqual(second.platforms,first.platforms);
  const stats=JSON.parse(fs.readFileSync(path.join(two,'publication-stats.json')));
  assert.ok(stats.platforms.every(p=>p.publishedParts===0));assert.equal(fs.readdirSync(store).length,3);
  // A new identity makes the mock authentication failure reachable.
  const three=fixture('three','0.4.2',true);
  assert.throws(()=>execFileSync(process.execPath,[publisher,three],{env:{...env,OWN_MOCK_AUTH_FAIL:'1'},stdio:'pipe'}),e=>String(e.stderr).includes('NPM_PUBLISH_AUTH_FAILED'));
  assert.equal(fs.existsSync(path.join(three,'npm-manifest.json')),false);
  const four=fixture('four','0.4.3',true,true);
  assert.throws(()=>execFileSync(process.execPath,[publisher,four],{env,stdio:'pipe'}),e=>String(e.stderr).includes('Content block checksum mismatch'));
  assert.equal(fs.readdirSync(store).length,3,'a bad later platform must be rejected before any earlier upload');
  const five=fixture('runtime','0.5.0');const runtime={schema:1,version:'node24.22.0-python3.12.15-r1',platforms:{}};
  for(const platform of ['darwin-arm64','win32-x64']){
    runtime.platforms[platform]={};for(const name of ['node','python']){
      const bytes=Buffer.from('private-runtime-'+platform+'-'+name),digest=sha(bytes);fs.writeFileSync(path.join(five,`runtime-${platform}-${name}.bin`),bytes,{flag:'wx'});
      runtime.platforms[platform][name]={entry:name,format:'tar.gz',incremental:{size:bytes.length,sha256:digest,blocks:[{size:bytes.length,sha256:digest,offset:0}]}};
    }
  }
  fs.writeFileSync(path.join(five,'runtime-input.json'),JSON.stringify(runtime),{flag:'wx'});execFileSync(process.execPath,[publisher,five],{env,stdio:'pipe'});
  const published=JSON.parse(fs.readFileSync(path.join(five,'npm-manifest.json')));
  assert.equal(published.runtimes.version,runtime.version);assert.equal(fs.readdirSync(store).length,7);
  assert.equal(published.runtimes.platforms['win32-x64'].python.format,'tar.gz');
  assert.ok(published.runtimes.platforms['darwin-arm64'].node.parts[0].url.startsWith('https://registry.npmjs.org/'));
  assert.equal(JSON.stringify(published.runtimes).includes('incremental'),false);
  const six=path.join(dir,'partial-tools');fs.mkdirSync(six);const nextTools=structuredClone(published.runtimes);nextTools.version=nextTools.version.replace('-r1','-r2');const changed=Buffer.from('new mac Node only'),changedHash=sha(changed);fs.writeFileSync(path.join(six,'runtime-darwin-arm64-node.bin'),changed,{flag:'wx'});nextTools.platforms['darwin-arm64'].node={entry:'node',format:'tar.gz',incremental:{size:changed.length,sha256:changedHash,blocks:[{size:changed.length,sha256:changedHash,offset:0}]}};
  fs.writeFileSync(path.join(six,'manifest.json'),JSON.stringify({...published,runtimes:undefined}),{flag:'wx'});fs.writeFileSync(path.join(six,'runtime-input.json'),JSON.stringify(nextTools),{flag:'wx'});execFileSync(process.execPath,[publisher,six],{env,stdio:'pipe'});const partial=JSON.parse(fs.readFileSync(path.join(six,'npm-manifest.json')));assert.deepEqual(partial.platforms,published.platforms);assert.deepEqual(partial.runtimes.platforms['darwin-arm64'].python,published.runtimes.platforms['darwin-arm64'].python);assert.deepEqual(partial.runtimes.platforms['win32-x64'],published.runtimes.platforms['win32-x64']);assert.equal(fs.readdirSync(store).length,8,'publish only the changed Node block');const partialStats=JSON.parse(fs.readFileSync(path.join(six,'publication-stats.json')));assert.equal(partialStats.platforms.length,1);assert.equal(partialStats.platforms[0].platform,'darwin-arm64-node');
});
