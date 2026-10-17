import fs from'node:fs';import path from'node:path';import os from'node:os';import assert from'node:assert/strict';import{execFileSync}from'node:child_process';
import{packResult}from'./npm-pack-result.mjs';import{invokeProbe}from'./native-probe.mjs';import{validateBinding}from'../lib/binding.mjs';
const [planFile,catalogFile]=process.argv.slice(2),plan=JSON.parse(fs.readFileSync(planFile)),previous=fs.existsSync(catalogFile)?JSON.parse(fs.readFileSync(catalogFile)):null;
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'own-manager-qa-中文-'))),packDir=path.join(root,'pack');fs.mkdirSync(packDir);
const source=path.resolve('own'),nodeDir=path.dirname(process.execPath),npm=process.env.npm_execpath||[path.join(nodeDir,'node_modules/npm/bin/npm-cli.js'),path.resolve(nodeDir,'../lib/node_modules/npm/bin/npm-cli.js')].find(p=>fs.existsSync(p));
if(!npm)throw Error('Managed npm CLI not found beside QA Node');
const run=(args,cwd=source)=>execFileSync(process.execPath,[npm,...args],{cwd,encoding:'utf8',timeout:120000,windowsHide:true});
// npm pack contains the real CLI and canonical Skill, not a reduced fixture.
const packed=packResult(run(['pack','--json','--pack-destination',packDir]),'@petercjl/codex-own');const archive=path.join(packDir,packed.filename);
const prefix=path.join(root,'installed');run(['install','--prefix',prefix,archive,'--ignore-scripts','--no-audit','--no-fund'],root);
const cli=path.join(prefix,'node_modules','@petercjl','codex-own','bin','codex-own.mjs');
// The installer must repair an app-created GPT config using its packed entry,
// not a source import or a manually edited VM configuration.
execFileSync(process.execPath,['--test',path.join(source,'test/model-configuration.test.mjs')],{stdio:'inherit',windowsHide:true,timeout:120000,env:{...process.env,OWN_MODEL_CONFIG_CLI:cli}});
execFileSync(process.execPath,['--test',path.join(source,'test/windows-agent-shell.test.mjs')],{stdio:'inherit',windowsHide:true,timeout:120000,env:{...process.env,OWN_AGENT_SHELL_MODULE:path.join(prefix,'node_modules','@petercjl','codex-own','lib','windows-agent-shell.cjs')}});
execFileSync(process.execPath,['--test',path.join(source,'test/cleanup.test.mjs')],{stdio:'inherit',windowsHide:true,timeout:120000,env:{...process.env,OWN_CLEANUP_MODULE:path.join(prefix,'node_modules','@petercjl','codex-own','lib','cleanup.mjs'),OWN_CLEANUP_CLI:cli}});
const call=args=>JSON.parse(execFileSync(process.execPath,[cli,...args],{encoding:'utf8',windowsHide:true,timeout:60000}));
assert.equal(call(['version']).manager,JSON.parse(fs.readFileSync('own/package.json')).version);
const skillRoot=path.join(root,'skills');const first=call(['skill','install','--target-root',skillRoot,'--yes']);
assert.equal(call(['skill','status','--target-root',skillRoot]).current,true);
const next=call(['skill','update','--target-root',skillRoot,'--yes']);assert.ok(fs.existsSync(next.backup));assert.ok(fs.readFileSync(path.join(first.destination,'SKILL.md')).equals(fs.readFileSync(path.join(next.backup,'SKILL.md'))));
let native;if(plan.components.desktop==='reuse'){
 validateBinding(previous.manifest,{requireProof:true});const key=process.platform+'-'+process.arch,asset=previous.manifest.platforms[key];
 native=await invokeProbe(asset,asset.probe,root);
}else native={deferredTo:'full native platform QA',reason:'program inputs changed or legacy bridge required'};
console.log(JSON.stringify({ok:true,platform:process.platform+'-'+process.arch,managerVersion:call(['version']).manager,packedInstall:true,managedSkillInstallUpdateBackup:true,desktopVersion:previous?.manifest?.version||null,native,planIdentity:plan.planIdentity,root}));
