'use strict';
const fs = require('node:fs'), path = require('node:path');
const bridge = require('./subagent-bridge.cjs');
function routing(access) {
  if (access?.schema !== 1 || !access.providers || typeof access.providers !== 'object') throw Error('Invalid model access registry');
  return alias => {
    if (typeof alias !== 'string') throw Object.assign(Error('Model identity is missing'), {code: 'MODEL_NOT_CONFIGURED'});
    const separator = alias.indexOf('/'), provider = alias.slice(0, separator), model = alias.slice(separator + 1);
    const entry = Object.hasOwn(access.providers, provider) && access.providers[provider];
    const spec = entry?.models && Object.hasOwn(entry.models, model) && entry.models[model];
    if (separator < 1 || !spec) throw Object.assign(Error('Model is not configured'), {code: 'MODEL_NOT_CONFIGURED'});
    return {model, spec, protocol: entry.protocol, baseURL: entry.baseURL, apiKey: entry.apiKey};
  };
}
async function start({core, config, fetch, dispatcher}) {
  const {readModelAccess} = await import('./model-access.mjs');
  const access = readModelAccess(core), token = config.model_providers?.codex_own_imported?.experimental_bearer_token;
  if (!access || typeof token !== 'string' || token.length < 32) throw Error('Imported model routing configuration is incomplete');
  return bridge.startServer({resolveRoute: routing(access), authorization: token, fetch, dispatcher});
}
module.exports = {routing, start};
