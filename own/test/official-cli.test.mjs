import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {validateCliVersion, verifyIntegrity, officialLayout, prepareOfficialCli} from '../builders/official-cli.mjs';
test('official CLI pin refuses tags, prereleases and shell/path input', () => {
  assert.equal(validateCliVersion('0.167.1'), '0.167.1');
  for (const version of ['latest', '0.167.1-alpha.1', '../0.167.1', '0.167.1;id', ''])
    assert.throws(() => validateCliVersion(version));
});
test('official CLI archive integrity fails closed on changed bytes or missing SRI', () => {
  const bytes = Buffer.from('official fixture');
  const integrity = 'sha512-' + crypto.createHash('sha512').update(bytes).digest('base64');
  verifyIntegrity(bytes, integrity);
  assert.throws(() => verifyIntegrity(Buffer.from('corrupt fixture'), integrity), /integrity mismatch/);
  assert.throws(() => verifyIntegrity(bytes, undefined), /integrity mismatch/);
});
test('official CLI layout requires matching version, platform and companion executables', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'own-cli-layout-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const manifest = {layoutVersion: 1, version: '0.167.1', target: 'aarch64-apple-darwin', variant: 'codex', entrypoint: 'bin/codex', resourcesDir: 'codex-resources', pathDir: 'codex-path'};
  fs.writeFileSync(path.join(root, 'codex-package.json'), JSON.stringify(manifest));
  for (const name of ['bin/codex', 'bin/codex-code-mode-host', 'codex-path/rg']) {
    fs.mkdirSync(path.dirname(path.join(root, name)), {recursive: true}); fs.writeFileSync(path.join(root, name), 'fixture');
  }
  assert.equal(officialLayout(root, '0.167.1'), path.join(root, 'bin/codex'));
  assert.throws(() => officialLayout(root, '0.166.0'), /Unsupported/);
  fs.unlinkSync(path.join(root, 'bin/codex-code-mode-host'));
  assert.throws(() => officialLayout(root, '0.167.1'));
});
test('verified archive cache avoids repeated downloads and refuses corrupted cached bytes', {skip: process.platform === 'win32'}, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'own-cli-cache-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const vendor = path.join(root, 'fixture/package/vendor/aarch64-apple-darwin');
  for (const name of ['bin/codex', 'bin/codex-code-mode-host', 'codex-path/rg']) {
    const file = path.join(vendor, name); fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, '#!/bin/sh\nprintf "codex-cli 0.167.1\\n"\n', {mode: 0o755});
  }
  fs.writeFileSync(path.join(vendor, 'codex-package.json'), JSON.stringify({layoutVersion: 1, version: '0.167.1', target: 'aarch64-apple-darwin', variant: 'codex', entrypoint: 'bin/codex', resourcesDir: 'codex-resources', pathDir: 'codex-path'}));
  const archive = path.join(root, 'fixture.tgz');
  await createRequire(import.meta.url)('tar').c({file: archive, cwd: path.join(root, 'fixture'), gzip: true}, ['package']);
  const bytes = fs.readFileSync(archive), integrity = 'sha512-' + crypto.createHash('sha512').update(bytes).digest('base64');
  let downloads = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    if (url.endsWith('.tgz')) { downloads++; return new Response(bytes); }
    return Response.json({name: '@openai/codex', version: '0.167.1-darwin-arm64', dist: {tarball: 'https://registry.npmjs.org/@openai/codex/-/codex-0.167.1-darwin-arm64.tgz', integrity}});
  };
  t.after(() => { globalThis.fetch = original; });
  const cacheRoot = path.join(root, 'cache');
  const first = await prepareOfficialCli('0.167.1', path.join(root, 'first'), {cacheRoot});
  const second = await prepareOfficialCli('0.167.1', path.join(root, 'second'), {cacheRoot});
  assert.equal(downloads, 1); assert.equal(first.binarySha256, second.binarySha256);
  const cached = path.join(cacheRoot, fs.readdirSync(cacheRoot)[0]);
  fs.writeFileSync(cached, 'corrupt cache');
  await assert.rejects(prepareOfficialCli('0.167.1', path.join(root, 'third'), {cacheRoot}), /integrity mismatch/);
  assert.equal(downloads, 1);
});
