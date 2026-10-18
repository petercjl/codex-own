import test from 'node:test';
import assert from 'node:assert/strict';
import {pendingShellSession} from '../ci/windows-shell-qa.mjs';
test('native shell fixture waits for an unfinished command before issuing another shell',()=>{
 assert.equal(pendingShellSession([{type:'function_call_output',output:'Wall time: 1 seconds\nProcess running with session ID 1234\nOutput:'}]),1234);
 assert.equal(pendingShellSession([{type:'function_call_output',output:'Process running with session ID 1234'},{type:'function_call_output',output:'Process exited with code 0\nOWN_POWERSHELL_OK:7.5'}]),null);
 assert.equal(pendingShellSession([{type:'message',content:'Process running with session ID 999'}]),null);
 assert.equal(pendingShellSession([]),null);
});
