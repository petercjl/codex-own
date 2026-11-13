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
async function start({core, config, fetch, dispatcher,bootstrap}) {
  const {readModelAccess} = await import('./model-access.mjs');
  const managed=fs.existsSync(path.join(core,'managed-login.json'))?JSON.parse(fs.readFileSync(path.join(core,'managed-login.json'),'utf8')):null;
  const validBootstrap=managed?.contract===2&&managed.active===true&&bootstrap?.access&&bootstrap?.session?.credentialFile===managed.credentialFile&&bootstrap.session.subject===managed.subject;
  const access = validBootstrap?bootstrap.access:readModelAccess(core), token = config.model_providers?.codex_own_imported?.experimental_bearer_token;
  if (!access || typeof token !== 'string' || token.length < 32) throw Error('Imported model routing configuration is incomplete');
  const blocked=managed?.contract===1||managed?.contract===2&&!validBootstrap||Object.values(access.providers).some(p=>p.apiKey==='sk-codex-own-protected-local-only')&&!validBootstrap;
  const gate=validBootstrap?require('./company-authorization.cjs').create({core,session:bootstrap.session,fetch:(url,options)=>fetch(url,{...options,...dispatcher?{dispatcher}:{}})}):null;
  try{
   // Keep the native app-server available for settings/login even while model access is paused.
   if(gate)await gate.start().catch(()=>{});
   const server=await bridge.startServer({resolveRoute: routing(access), authorization: token, fetch, dispatcher,beforeRequest:()=>{if(blocked)throw Object.assign(Error('Company sign-in is required for direct model access'),{code:'AUTH_REQUIRED',status:401});return gate?.check();},prepareBody:body=>require('./image-provider.cjs').apply(require('./company-tools-env.cjs').apply(body,core),core)});
   const close=server.close;server.close=async()=>{gate?.close();await close();};return server;
  }catch(error){gate?.close();throw error;}
}
module.exports = {routing, start};
