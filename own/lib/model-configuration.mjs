import {parse,stringify} from 'smol-toml';

// Merge model access independently of desktop preferences, plugins and projects.
export function deepseekConfiguration(source,models){
  let config;
  try{config=parse(source||'');}catch{throw Object.assign(Error('Existing model configuration is invalid TOML; configuration and credentials were preserved'),{code:'CONFIG_INVALID'});}
  const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
  if(config.model_providers!==undefined&&!record(config.model_providers))throw Object.assign(Error('model_providers must be a table; configuration was preserved'),{code:'CONFIG_INVALID'});
  const selected=config.model_provider==='dashscope_deepseek';
  if(!selected||typeof config.model!=='string'||!config.model.startsWith('deepseek-'))config.model='deepseek-v4.1-flash';
  config.model_provider='dashscope_deepseek';
  config.forced_login_method='api';
  config.cli_auth_credentials_store='file';
  config.model_catalog_json=models.replaceAll('\\','/');
  config.model_reasoning_effort??='high';
  config.web_search??='disabled';
  config.model_providers??={};
  const previous=config.model_providers.dashscope_deepseek;
  if(previous!==undefined&&!record(previous))throw Object.assign(Error('DeepSeek provider must be a table; configuration was preserved'),{code:'CONFIG_INVALID'});
  config.model_providers.dashscope_deepseek={...previous,name:previous?.name||'DeepSeek-DashScope',base_url:selected&&previous?.base_url?previous.base_url:'https://dashscope.aliyuncs.com/compatible-mode/v1',wire_api:'responses',requires_openai_auth:true};
  return stringify(config)+'\n';
}
