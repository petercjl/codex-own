import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import net from 'node:net';
import {replaceDevelopment, sourceInventory, assertDevelopment, matchesOfficialInput, backupProfile} from '../dev.mjs';

test('daily upstream synchronization dispatches verification without automatic publication', () => {
  const workflow = fs.readFileSync(new URL('../../.github/workflows/own-sync.yml', import.meta.url), 'utf8');
  const dispatches = workflow.split('\n').filter(line => /gh workflow run own-release\.yml/.test(line));
  assert.equal(dispatches.length, 1);
  assert.match(dispatches[0], /-f verify_only=true(?:\s|$)/);
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'own-dev-test-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const target = path.join(root, '开发版.app'), candidate = path.join(root, 'candidate.app');
  for (const [dir, text] of [[target, 'old'], [candidate, 'new']]) {
    fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'content'), text);
  }
  return {root, target, candidate, backup: path.join(root, 'old.bundle'), failed: path.join(root, 'failed.bundle')};
}
test('development replacement retains the original and installs the verified candidate', t => {
  const paths = fixture(t);
  replaceDevelopment({...paths, verify: app => assert.equal(fs.readFileSync(path.join(app, 'content'), 'utf8'), 'new')});
  assert.equal(fs.readFileSync(path.join(paths.backup, 'content'), 'utf8'), 'old');
  assert.equal(fs.existsSync(paths.candidate), false);
});
test('failed validation restores the original and retains failed candidate evidence', t => {
  const paths = fixture(t);
  assert.throws(() => replaceDevelopment({...paths, verify: () => {throw Error('signature mismatch');}}), /signature mismatch/);
  assert.equal(fs.readFileSync(path.join(paths.target, 'content'), 'utf8'), 'old');
  assert.equal(fs.readFileSync(path.join(paths.failed, 'content'), 'utf8'), 'new');
});
test('failure to move candidate restores original; existing backups are refused', t => {
  const paths = fixture(t); fs.renameSync(paths.candidate, paths.candidate + '.elsewhere');
  assert.throws(() => replaceDevelopment({...paths, verify: () => {}}));
  assert.equal(fs.readFileSync(path.join(paths.target, 'content'), 'utf8'), 'old');
  fs.mkdirSync(paths.backup);
  assert.throws(() => replaceDevelopment({...paths, verify: () => {}}), /already exists/);
});
test('source fingerprint detects edits, deletions and executable mode changes', t => {
  const {root} = fixture(t);
  execFileSync('git', ['init', '-q', root]);
  const source = path.join(root, 'source.mjs'); fs.writeFileSync(source, 'first');
  execFileSync('git', ['-C', root, 'add', 'source.mjs']);
  const initial = sourceInventory(root).sha256;
  fs.chmodSync(source, 0o755); assert.notEqual(sourceInventory(root).sha256, initial);
  const mode = sourceInventory(root).sha256;
  fs.writeFileSync(source, 'second'); assert.notEqual(sourceInventory(root).sha256, mode);
  fs.unlinkSync(source); assert.equal(sourceInventory(root).files[0].missing, true);
});
test('formal app identity is refused before replacement', t => {
  const {candidate} = fixture(t), resources = path.join(candidate, 'Contents/Resources');
  fs.mkdirSync(resources, {recursive: true});
  fs.writeFileSync(path.join(resources, 'own-development.json'), JSON.stringify({schema: 1, channel: 'development', automaticUpdates: false}));
  fs.writeFileSync(path.join(candidate, 'Contents/Info.plist'), 'fixture');
  assert.throws(() => assertDevelopment(candidate, {plist: {parse: () => ({CFBundleIdentifier: 'local.codex-own'})}}), /non-development/);
});
test('local official input must match both current official version and build', () => {
  const info = {CFBundleIdentifier: 'com.openai.codex', CFBundleShortVersionString: '26.1013.40934', CFBundleVersion: '20770'};
  const check = '   mac-arm64: 26.1013.40934 (build 20770)\n';
  assert.equal(matchesOfficialInput(info, check), true);
  assert.equal(matchesOfficialInput({...info, CFBundleVersion: '20769'}, check), false);
  assert.equal(matchesOfficialInput({...info, CFBundleIdentifier: 'local.codex-own'}, check), false);
  assert.equal(matchesOfficialInput(info, 'unrecognized output'), false);
});
test('profile backup preserves private files and links, and records transient sockets', {skip: process.platform === 'win32'}, async t => {
  // Short paths are required for Darwin Unix sockets.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odb-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const source = path.join(root, 'src'); fs.mkdirSync(source, {mode: 0o700});
  fs.writeFileSync(path.join(source, 'private.json'), 'private fixture', {mode: 0o600});
  fs.symlinkSync('private.json', path.join(source, 'link'));
  const server = net.createServer();
  await new Promise(resolve => server.listen(path.join(source, 'ipc.sock'), resolve));
  try {
    const dest = path.join(root, 'backup'), result = backupProfile(source, dest);
    assert.deepEqual(result.skippedSockets, ['ipc.sock']);
    assert.equal(fs.readFileSync(path.join(dest, 'private.json'), 'utf8'), 'private fixture');
    assert.equal(fs.statSync(path.join(dest, 'private.json')).mode & 0o777, 0o600);
    assert.equal(fs.readlinkSync(path.join(dest, 'link')), 'private.json');
    assert.equal(fs.existsSync(path.join(dest, 'ipc.sock')), false);
    assert.throws(() => backupProfile(source, dest), /already exists/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
