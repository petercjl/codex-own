import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {parse, stringify} from 'smol-toml';

export const importedProvider = 'codex_own_imported';
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw Object.assign(Error(message), {code: 'MODEL_ACCESS_INVALID'}); };
const text = value => typeof value === 'string' && value.length > 0 && !/[\x00-\x1f\x7f]/.test(value);

// The external file shares SealWork's model/provider/options/models contract.
// SDK names describe protocols; no third-party SDK named in the file is loaded.
export function parseModelAccess(source) {
  if (Buffer.byteLength(source) > 1048576) fail('Model configuration exceeds 1 MiB');
  let input; try { input = JSON.parse(source.replace(/^\uFEFF/, '')); } catch { fail('Expected a JSON model configuration or a single legacy API key'); }
  if (!record(input) || !text(input.model) || !record(input.provider)) fail('Expected model and provider fields');
  const enabled = input.enabled_providers;
  if (enabled !== undefined && (!Array.isArray(enabled) || enabled.some(id => !text(id) || !Object.hasOwn(input.provider, id)))) fail('Invalid enabled_providers');
  const providers = {};
  for (const [id, entry] of Object.entries(input.provider)) {
    if (enabled && !enabled.includes(id)) continue;
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id) || ['constructor', 'prototype'].includes(id) || !record(entry) || !record(entry.options) || !record(entry.models)) fail('Invalid provider definition');
    const {apiKey, baseURL} = entry.options;
    if (!text(apiKey) || apiKey.length < 10 || apiKey.length > 8192 || !text(baseURL)) fail('Each provider requires options.apiKey and options.baseURL');
    let url; try { url = new URL(baseURL); } catch { fail('Invalid provider baseURL'); }
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash) fail('Provider URLs require HTTPS, or loopback HTTP, without credentials, query or fragment');
    const protocol = entry.wire_api || (entry.npm === '@ai-sdk/anthropic' ? 'anthropic' : ['@ai-sdk/openai', '@ai-sdk/openai-compatible', undefined].includes(entry.npm) ? 'responses' : null);
    if (!['responses', 'anthropic'].includes(protocol)) fail('Supported provider protocols are responses and anthropic');
    const models = {};
    for (const [model, metadata] of Object.entries(entry.models)) {
      if (!text(model) || ['__proto__', 'constructor', 'prototype'].includes(model) || !record(metadata)) fail('Invalid model definition');
      const context = metadata.limit?.context ?? 128000, output = metadata.limit?.output ?? 32768;
      if (![context, output].every(n => Number.isSafeInteger(n) && n > 0) || output > context) fail('Invalid model token limits');
      const modalities = metadata.modalities?.input ?? ['text'];
      if (!Array.isArray(modalities) || modalities.some(m => !['text', 'image', 'pdf'].includes(m))) fail('Unsupported model input modality');
      models[model] = {name: text(metadata.name) ? metadata.name : model, context, maxOutput: output, modalities, reasoning: metadata.reasoning === true,
        thinking: metadata.options?.thinking?.type === 'adaptive' ? 'adaptive' : null};
    }
    if (!Object.keys(models).length) fail('Each enabled provider requires at least one model');
    providers[id] = {name: text(entry.name) ? entry.name : id, baseURL: url.href.replace(/\/+$/, ''), apiKey, protocol, models};
  }
  const index = input.model.indexOf('/'), provider = input.model.slice(0, index), model = input.model.slice(index + 1);
  if (index < 1 || !providers[provider]?.models[model]) fail('Default model must identify an enabled provider/model');
  return {schema: 1, model: input.model, providers};
}

export function modelCatalogue(access, baseline) {
  return {models: Object.entries(access.providers).flatMap(([provider, entry]) => Object.entries(entry.models).map(([model, spec]) => {
    const result = structuredClone(baseline.models.find(m => m.slug === model) || baseline.models[0]);
    const slug = provider + '/' + model;
    Object.assign(result, {slug, display_name: spec.name + ' · ' + entry.name, description: entry.name + ' / ' + model,
      context_window: spec.context, max_context_window: spec.context, priority: slug === access.model ? 0 : 10,
      input_modalities: spec.modalities.filter(m => m !== 'pdf'), prefer_websockets: false});
    result.supported_reasoning_levels = spec.reasoning ? [{effort: 'low', description: 'Low'}, {effort: 'high', description: 'High'}, {effort: 'max', description: 'Max'}] : [];
    if (entry.protocol === 'anthropic') result.model_messages.instructions_template = result.model_messages.instructions_template.replace('based on DeepSeek', 'based on Claude');
    return result;
  }))};
}

export function importedConfiguration(source, access, core) {
  let config; try { config = parse(source || ''); } catch { throw Object.assign(Error('Existing model configuration is invalid TOML; files were preserved'), {code: 'CONFIG_INVALID'}); }
  config.model_providers ??= {};
  if (!record(config.model_providers)) fail('model_providers must be a table');
  const old = config.model_providers[importedProvider];
  config.model_providers[importedProvider] = {name: 'Configured models', base_url: 'http://127.0.0.1:1/v1', wire_api: 'responses', requires_openai_auth: false,
    experimental_bearer_token: old?.experimental_bearer_token || crypto.randomBytes(32).toString('hex')};
  Object.assign(config, {model: access.model, model_provider: importedProvider, forced_login_method: 'api', cli_auth_credentials_store: 'file',
    model_catalog_json: path.join(core, 'imported-models.json').replaceAll('\\', '/')});
  config.model_reasoning_effort ??= 'high'; config.web_search ??= 'disabled';
  return stringify(config) + '\n';
}

export function readModelAccess(core) {
  const file = path.join(core, 'model-access.json');
  if (!fs.existsSync(file)) return null;
  const value = JSON.parse(fs.readFileSync(file));
  // Validate stored input through the same contract as new imports.
  return parseModelAccess(JSON.stringify({model: value.model, provider: Object.fromEntries(Object.entries(value.providers || {}).map(([id, p]) => [id,
    {name: p.name, wire_api: p.protocol, options: {apiKey: p.apiKey, baseURL: p.baseURL}, models: Object.fromEntries(Object.entries(p.models).map(([id, m]) => [id,
      {name: m.name, reasoning: m.reasoning, limit: {context: m.context, output: m.maxOutput}, modalities: {input: m.modalities}, options: {thinking: {type: m.thinking}}}]))}]))}));
}

export function publicModelInventory(access) {
  return {selected: access.model, models: Object.entries(access.providers).flatMap(([provider, p]) => Object.entries(p.models).map(([model, m]) =>
    ({id: provider + '/' + model, provider, model, name: m.name, providerName: p.name, protocol: p.protocol})))};
}
