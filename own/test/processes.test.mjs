import test from 'node:test';
import assert from 'node:assert/strict';
import {macOwnProcessIds} from '../lib/manager.mjs';
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
