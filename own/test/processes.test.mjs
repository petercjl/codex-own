import test from 'node:test';
import assert from 'node:assert/strict';
import {macOwnProcessIds,unregisterStagedMacApp} from '../lib/manager.mjs';
test('Mac updater ignores Windows coherence bridges and keeps native app/engine guards',()=>{
 const lines=[
  '100 /Applications/codex-own.app/Contents/MacOS/ChatGPT',
  '101 /Applications/codex-own.app/Contents/Resources/codex app-server --stdio',
  '102 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT',
  '103 /Applications/codex-own.app/Contents/Resources/cua_node/bin/node',
  '104 /Users/test/Applications (Parallels)/VM Applications.localized/codex-own.app/Contents/MacOS/WinAppHelper --ivmid 2',
 ];
 assert.deepEqual(macOwnProcessIds(lines),['100','101']);
});
test('Mac update exit gate ignores crash reporters while guarding app, renderer and backend',()=>{
 const base='/Applications/codex-own.app/Contents/';
 const lines=[
  `200 ${base}Frameworks/Codex Framework.framework/Versions/155/Helpers/browser_crashpad_handler --monitor-self`,
  `201 ${base}Frameworks/Codex Framework.framework/Versions/155/Helpers/browser_crashpad_handler --no-periodic-tasks`,
  `202 ${base}MacOS/ChatGPT`,
  `203 ${base}Frameworks/Codex Framework.framework/Helpers/Codex (Renderer).app/Contents/MacOS/Codex (Renderer) --type=renderer`,
  `204 ${base}Resources/codex app-server`,
  `205 /Applications/codex-own 开发版.app/Contents/MacOS/ChatGPT`,
  `206 /bin/bash -c inspect '${base}MacOS/ChatGPT'`,
 ];
 assert.deepEqual(macOwnProcessIds(lines),['202','203','204']);
 assert.deepEqual(macOwnProcessIds(lines.slice(0,2)),[]);
});
test('Mac process guards use the selected installation path',()=>{
 const target='/Users/test/Applications/正式 App.app';
 assert.deepEqual(macOwnProcessIds([
  `300 ${target}/Contents/MacOS/ChatGPT`,
  '301 /Applications/codex-own.app/Contents/MacOS/ChatGPT',
 ],target),['300']);
});
test('stage registration cleanup targets only the discarded temporary app, even after deletion',()=>{
 const calls=[],stage='/private/tmp/manager/stage-abc123';
 unregisterStagedMacApp(stage,{platform:'darwin',run:(...args)=>calls.push(args)});
 assert.equal(calls.length,1);assert.deepEqual(calls[0][1],['-u',stage+'/unpacked/codex-own.app']);
 assert.equal(calls[0][2].timeout,10000);
 unregisterStagedMacApp(stage,{platform:'win32',run:()=>assert.fail('Windows must not call LaunchServices')});
 assert.throws(()=>unregisterStagedMacApp('/Applications/codex-own.app',{platform:'darwin',run:()=>assert.fail('Installed app must stay registered')}),{code:'UNSAFE_PATH'});
});
test('a LaunchServices cleanup error does not turn a completed install into a failed update',()=>{
 const messages=[];unregisterStagedMacApp('/private/tmp/manager/stage-abc123',{platform:'darwin',run:()=>{throw Error('Unavailable')},report:m=>messages.push(m)});
 assert.equal(messages.length,1);
});
