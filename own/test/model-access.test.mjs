import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parse} from 'smol-toml';
import {parseModelAccess} from '../lib/model-access.mjs';
import {configure, configuredModels, selectConfiguredModel} from '../lib/manager.mjs';

export const accessFixture = () => ({model: 'gateway-claude/claude-fixture', provider: {
  'gateway-claude': {name: 'Gateway Claude', npm: '@ai-sdk/anthropic', options: {baseURL: 'https://claude.example/v1', apiKey: 'sk-claude-fixture-private'}, models: {'claude-fixture': {name: 'Claude fixture', reasoning: true, limit: {context: 200000, output: 32000}, options: {thinking: {type: 'adaptive'}}}}},
  'gateway-deepseek': {name: 'Gateway DeepSeek', npm: '@ai-sdk/openai-compatible', options: {baseURL: 'https://gateway.example/v1', apiKey: 'sk-gateway-fixture-private'}, models: {'deepseek-flash': {name: 'DeepSeek gateway'}}},
  dashscope: {name: 'Bailian DeepSeek', npm: '@ai-sdk/openai-compatible', options: {baseURL: 'https://bailian.example/v1', apiKey: 'sk-bailian-fixture-private'}, models: {'deepseek-v4.1-flash': {name: 'DeepSeek Bailian'}}}
}});
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'own-model-access-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const p = {root, manager: path.join(root, 'manager'), core: path.join(root, 'core'), target: path.join(root, 'app')};
  fs.mkdirSync(p.core); const input = path.join(root, 'configuration.txt');
  fs.writeFileSync(input, JSON.stringify(accessFixture()), {flag: 'wx', mode: 0o600});
  return {p, input};
}
test('SealWork-shaped JSON imports three providers without exposing remote credentials in receipts or native config', async t => {
  const {p, input} = fixture(t);
  const previous = '[desktop]\nsansFontSize=16\n[plugins.example]\nenabled=true\n';
  fs.writeFileSync(path.join(p.core, 'config.toml'), previous);
  const result = await configure(input, {p, isRunning: () => []});
  assert.equal(result.modelProvider, 'codex_own_imported'); assert.equal(result.models.length, 3);
  const native = parse(fs.readFileSync(path.join(p.core, 'config.toml'), 'utf8'));
  assert.equal(native.desktop.sansFontSize, 16); assert.equal(native.plugins.example.enabled, true);
  assert.equal(native.model, 'gateway-claude/claude-fixture');
  const catalogue = JSON.parse(fs.readFileSync(native.model_catalog_json));
  assert.deepEqual(catalogue.models.map(m => m.slug), result.models.map(m => m.id));
  for (const provider of Object.values(accessFixture().provider)) {
    assert.ok(!JSON.stringify(result).includes(provider.options.apiKey));
    assert.ok(!fs.readFileSync(path.join(p.core, 'config.toml'), 'utf8').includes(provider.options.apiKey));
    assert.ok(!JSON.stringify(catalogue).includes(provider.options.apiKey));
  }
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(p.core, 'model-access.json')).mode & 0o777, 0o600);
  const stored=JSON.parse(fs.readFileSync(path.join(p.core,'model-access.json')));for(const [provider,entry] of Object.entries(accessFixture().provider)) assert.equal(stored.providers[provider].apiKey,entry.options.apiKey);
  assert.equal(fs.readFileSync(result.backups['config.toml'], 'utf8'), previous);
  const selected = await selectConfiguredModel('dashscope/deepseek-v4.1-flash', {p, isRunning: () => []});
  assert.equal(selected.selected, 'dashscope/deepseek-v4.1-flash'); assert.equal(configuredModels({p}).selected, selected.selected);
  await assert.rejects(selectConfiguredModel('absent/model', {p, isRunning: () => []}), {code: 'MODEL_NOT_CONFIGURED'});
});
test('invalid imports preserve existing user files and do not start a transaction', async t => {
  const {p, input} = fixture(t), file = path.join(p.core, 'auth.json'); fs.writeFileSync(file, 'prior-user-credential');
  const invalid = accessFixture(); invalid.provider.dashscope.options.baseURL = 'http://remote.example/v1';
  fs.writeFileSync(input, JSON.stringify(invalid));
  await assert.rejects(configure(input, {p, isRunning: () => []}), {code: 'MODEL_ACCESS_INVALID'});
  assert.equal(fs.readFileSync(file, 'utf8'), 'prior-user-credential');
  assert.equal(fs.existsSync(path.join(p.core, 'model-access.json')), false);
});
test('an older desktop refuses multi-provider import before changing model settings', async t => {
  const {p,input}=fixture(t);fs.mkdirSync(p.target);
  await assert.rejects(configure(input,{p,isRunning:()=>[]}),{code:'MODEL_ROUTING_UNAVAILABLE'});
  assert.equal(fs.existsSync(path.join(p.core,'model-access.json')),false);
});
test('invalid TOML, running app, unsupported SDK, missing default, token and URL ambiguity fail closed', async t => {
  for (const mutate of [x => x.model = 'missing/model', x => x.provider.dashscope.npm = 'arbitrary-code', x => x.provider.dashscope.options.apiKey = '',
    x => x.provider.dashscope.options.baseURL = 'https://user:pass@example/v1', x => x.provider.dashscope.options.baseURL = 'https://example/v1?key=secret', x => x.enabled_providers = ['dashscope']]) {
    const input = accessFixture(); mutate(input); assert.throws(() => parseModelAccess(JSON.stringify(input)), {code: 'MODEL_ACCESS_INVALID'});
  }
  const {p, input} = fixture(t); await assert.rejects(configure(input, {p, isRunning: () => [123]}), {code: 'APP_RUNNING'});
  fs.writeFileSync(path.join(p.core, 'config.toml'), 'model = [broken');
  await assert.rejects(configure(input, {p, isRunning: () => []}), {code: 'CONFIG_INVALID'});
  assert.equal(fs.existsSync(path.join(p.core, 'model-access.json')), false);
});
