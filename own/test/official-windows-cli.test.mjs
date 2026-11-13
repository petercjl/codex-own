import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {officialLayout} from '../builders/official-cli.mjs';
import {installOfficialWindowsCli} from '../builders/official-windows-cli.mjs';
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'own-official-win-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const prepared = path.join(root, 'prepared'), vendor = path.join(prepared, 'package/vendor/x86_64-pc-windows-msvc');
  const names = ['bin/codex.exe', 'bin/codex-code-mode-host.exe', 'codex-path/rg.exe', 'codex-resources/codex-command-runner.exe', 'codex-resources/codex-windows-sandbox-setup.exe', 'codex-resources/voice/bin/voice.dll'];
  for (const name of names) {const p = path.join(vendor, name); fs.mkdirSync(path.dirname(p), {recursive: true}); fs.writeFileSync(p, 'MZfixture:' + name, {flag: 'wx'});}
  const manifest = {layoutVersion: 1, version: '0.167.2', target: 'x86_64-pc-windows-msvc', variant: 'codex', entrypoint: 'bin/codex.exe', resourcesDir: 'codex-resources', pathDir: 'codex-path'};
  fs.writeFileSync(path.join(vendor, 'codex-package.json'), JSON.stringify(manifest), {flag: 'wx'});
  const pin = {version: '0.167.2', integrity: 'sha512-fixture', archiveSha256: 'a'.repeat(64)};
  const receipt = {...pin, provider: 'openai', packageVersion: '0.167.2-win32-x64', binarySha256: digest(fs.readFileSync(path.join(vendor, 'bin/codex.exe')))};
  fs.writeFileSync(path.join(prepared, 'receipt.json'), JSON.stringify(receipt), {flag: 'wx'});
  const resources = path.join(root, 'resources'), backup = path.join(root, 'before-cli'); fs.mkdirSync(resources);
  for (const name of ['codex.exe', 'codex-code-mode-host.exe', 'rg.exe']) fs.writeFileSync(path.join(resources, name), 'previous:' + name, {flag: 'wx'});
  return {root, prepared, vendor, pin, receipt, resources, backup};
}
test('Windows official CLI retains resources in the upstream-supported root package layout', t => {
  const f = fixture(t), result = installOfficialWindowsCli(f.resources, f.prepared, f.backup, f.pin);
  assert.equal(result.relocation, 'windows-root-layout-v1');
  const metadata = JSON.parse(fs.readFileSync(path.join(f.resources, 'codex-package.json')));
  assert.equal(metadata.entrypoint, 'codex.exe'); assert.equal(metadata.version, '0.167.2');
  assert.equal(digest(fs.readFileSync(path.join(f.resources, 'codex.exe'))), f.receipt.binarySha256);
  for (const name of ['codex-code-mode-host.exe', 'codex-resources/codex-command-runner.exe', 'codex-resources/codex-windows-sandbox-setup.exe', 'codex-resources/voice/bin/voice.dll', 'codex-path/rg.exe', 'rg.exe']) assert.ok(fs.statSync(path.join(f.resources, name)).isFile());
  assert.equal(fs.readFileSync(path.join(f.backup, 'codex.exe'), 'utf8'), 'previous:codex.exe');
  assert.ok(!fs.existsSync(path.join(f.resources, 'bin')), 'The main executable is not duplicated');
  assert.ok(!fs.existsSync(path.join(f.resources, 'before-cli')), 'Recovery bytes stay outside the shipped application');
});
test('Windows and Mac package identities cannot be interchanged', t => {
  const f = fixture(t);
  assert.equal(officialLayout(f.vendor, '0.167.2', 'win32-x64'), path.join(f.vendor, 'bin/codex.exe'));
  assert.throws(() => officialLayout(f.vendor, '0.167.2'), /Unsupported/);
  assert.throws(() => officialLayout(f.vendor, '0.167.1', 'win32-x64'), /Unsupported/);
});
test('a changed official pin or executable refuses before mutating the candidate', t => {
  const f = fixture(t);
  for (const pin of [{...f.pin, integrity: 'different'}, {...f.pin, archiveSha256: 'b'.repeat(64)}, {...f.pin, version: '0.167.1'}]) assert.throws(() => installOfficialWindowsCli(f.resources, f.prepared, f.backup, pin));
  fs.appendFileSync(path.join(f.vendor, 'bin/codex.exe'), 'changed');
  assert.throws(() => installOfficialWindowsCli(f.resources, f.prepared, f.backup, f.pin), /receipt mismatch/);
  assert.equal(fs.readFileSync(path.join(f.resources, 'codex.exe'), 'utf8'), 'previous:codex.exe'); assert.ok(!fs.existsSync(f.backup));
});
test('missing Windows sandbox resources fail preflight while preserving the original candidate', t => {
  const f = fixture(t); fs.unlinkSync(path.join(f.vendor, 'codex-resources/codex-command-runner.exe'));
  assert.throws(() => installOfficialWindowsCli(f.resources, f.prepared, f.backup, f.pin));
  assert.equal(fs.readFileSync(path.join(f.resources, 'codex.exe'), 'utf8'), 'previous:codex.exe'); assert.ok(!fs.existsSync(f.backup));
});
