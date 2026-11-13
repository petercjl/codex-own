'use strict';
const crypto = require('node:crypto');
const opaquePrefix = 'codex-own-anthropic-v1:';
const fail = message => { throw Object.assign(Error(message), {code: 'ANTHROPIC_INPUT_UNSUPPORTED'}); };
const toolId = value => 'own_' + crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 40);

// Messages requires an object schema without a top-level composition. Keep the
// native schema intact inside an argument envelope, including local references.
function envelopeSchema(schema) {
  const nested = structuredClone(schema);
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (['$ref', '$dynamicRef'].includes(key) && typeof child === 'string' && (child === '#' || child.startsWith('#/')))
        value[key] = '#/properties/arguments' + child.slice(1);
      else visit(child);
    }
  };
  visit(nested);
  return {type: 'object', properties: {arguments: nested}, required: ['arguments'], additionalProperties: false};
}

function toolDefinitions(tools = [], namespace, result = []) {
  for (const tool of tools) {
    if (tool.type === 'namespace') { toolDefinitions(tool.tools, tool.name, result); continue; }
    if (tool.type === 'tool_search' && tool.execution !== 'client') fail('Only client-executed tool search is supported');
    if (!['function', 'custom', 'tool_search'].includes(tool.type)) fail('Unsupported native tool for Messages API: ' + tool.type);
    const name = tool.type === 'tool_search' ? 'tool_search' : tool.name || tool.function?.name;
    if (!name) fail('Tool name is missing');
    const alias = namespace ? namespace + '__' + name : name;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(alias) || result.some(t => t.alias === alias)) fail('Unsupported or ambiguous tool name');
    const schema = tool.type === 'custom' ? {type: 'object', properties: {input: {type: 'string', description: 'Exact literal tool input, preserving all line breaks'}}, required: ['input'], additionalProperties: false} : tool.parameters || tool.function?.parameters || {type: 'object', properties: {}};
    const enveloped = tool.type !== 'custom' && ['oneOf', 'anyOf', 'allOf'].some(key => Array.isArray(schema[key]));
    result.push({alias, name, namespace, search: tool.type === 'tool_search', custom: tool.type === 'custom', enveloped, definition: {name: alias, description: tool.description || tool.function?.description || '',
      input_schema: enveloped ? envelopeSchema(schema) : schema}});
  }
  return result;
}
function contentParts(parts) {
  if (typeof parts === 'string') return [{type: 'text', text: parts}];
  if (!Array.isArray(parts)) fail('Unsupported message content');
  return parts.map(part => {
    if (['input_text', 'output_text', 'text', 'reasoning_text'].includes(part.type) && typeof part.text === 'string') return {type: 'text', text: part.text};
    if (part.type === 'input_image') {
      const url = part.image_url?.url || part.image_url;
      if (typeof url !== 'string') fail('Unsupported image input');
      const data = url.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\r\n]+)$/);
      if (data) return {type: 'image', source: {type: 'base64', media_type: data[1], data: data[2].replace(/\s/g, '')}};
      if (url.startsWith('https://')) return {type: 'image', source: {type: 'url', url}};
      fail('Messages API images require a data URL or HTTPS URL');
    }
    fail('Unsupported message content type: ' + part.type);
  });
}
function toMessages(body, route) {
  const tools = toolDefinitions(body.tools), messages = [], system = [];
  // Loaded definitions remain callable on later turns and after thread resume.
  for (const item of Array.isArray(body.input) ? body.input : []) {
    if (['tool_search_output', 'additional_tools'].includes(item.type)) {
      for (const tool of toolDefinitions(item.tools)) if (!tools.some(t => t.alias === tool.alias)) tools.push(tool);
    }
  }
  if (typeof body.instructions === 'string' && body.instructions) system.push(body.instructions);
  const add = (role, content) => { if (!content.length) return; const last = messages.at(-1); if (last?.role === role) last.content.push(...content); else messages.push({role, content}); };
  const input = typeof body.input === 'string' ? [{type: 'message', role: 'user', content: body.input}] : body.input;
  if (!Array.isArray(input)) fail('Responses input must be a string or array');
  for (const item of input) {
    if (item.type === 'additional_tools') continue;
    if (item.type === 'tool_search_call') {
      if (item.execution !== 'client') fail('Only client-executed tool search history is supported');
      const tool = tools.find(t => t.search);
      add('assistant', [{type: 'tool_use', id: toolId(item.call_id), name: 'tool_search', input: tool?.enveloped ? {arguments: item.arguments} : item.arguments}]); continue;
    }
    if (item.type === 'tool_search_output') {
      if (item.execution !== 'client') fail('Only client-executed tool search history is supported');
      add('user', [{type: 'tool_result', tool_use_id: toolId(item.call_id), content: JSON.stringify(item.tools)}]); continue;
    }
    if (item.type === 'reasoning') {
      if (item.encrypted_content?.startsWith(opaquePrefix)) {
        let blocks; try { blocks = JSON.parse(Buffer.from(item.encrypted_content.slice(opaquePrefix.length), 'base64').toString()); } catch { fail('Invalid persisted Claude reasoning'); }
        if (!Array.isArray(blocks) || blocks.some(b => !['thinking', 'redacted_thinking'].includes(b.type))) fail('Invalid Claude reasoning blocks');
        add('assistant', blocks);
      }
      continue;
    }
    if (item.type === 'agent_message') {
      add('user', contentParts(item.content.map(p => p.type === 'encrypted_content' ? {type: 'input_text', text: p.encrypted_content} : p))); continue;
    }
    if (['function_call', 'custom_tool_call'].includes(item.type)) {
      const tool = tools.find(t => t.name === item.name && t.namespace === item.namespace) || tools.find(t => t.name === item.name && !t.namespace);
      if (!tool) fail('Historical tool is absent from the active tool contract: ' + item.name);
      let value; try { value = tool.custom ? {input: item.input} : JSON.parse(item.arguments || '{}'); } catch { fail('Invalid historical tool arguments'); }
      add('assistant', [{type: 'tool_use', id: toolId(item.call_id), name: tool.alias, input: tool.enveloped ? {arguments: value} : value}]); continue;
    }
    if (['function_call_output', 'custom_tool_call_output'].includes(item.type)) {
      add('user', [{type: 'tool_result', tool_use_id: toolId(item.call_id), content: typeof item.output === 'string' ? item.output : contentParts(item.output)}]); continue;
    }
    if (item.type === 'message' || item.role) {
      const parts = contentParts(item.content);
      if (['system', 'developer'].includes(item.role)) system.push(...parts.map(p => p.text || ''));
      else if (['assistant', 'user'].includes(item.role)) add(item.role, parts);
      else fail('Unsupported message role');
      continue;
    }
    fail('Unsupported Responses input item: ' + item.type);
  }
  if (!messages.length) fail('No Messages API input');
  const request = {model: route.model, messages, system: system.join('\n\n'), max_tokens: Math.min(body.max_output_tokens || route.spec.maxOutput, route.spec.maxOutput), stream: true};
  if (tools.length) request.tools = tools.map(t => t.definition);
  if (body.tool_choice === 'none') request.tool_choice = {type: 'none'};
  else if (body.tool_choice === 'required') request.tool_choice = {type: 'any'};
  else if (body.tool_choice && body.tool_choice !== 'auto') {
    const selected = tools.find(t => t.name === body.tool_choice.name && t.namespace === body.tool_choice.namespace);
    if (!selected) fail('Unsupported tool choice'); request.tool_choice = {type: 'tool', name: selected.alias};
  }
  if (route.spec.thinking === 'adaptive') {
    const effort = body.reasoning?.effort;
    if (effort && !['none', 'low', 'medium', 'high', 'max'].includes(effort)) fail('Unsupported Claude reasoning effort');
    request.thinking = {type: effort === 'none' ? 'disabled' : 'adaptive'};
    if (['low', 'medium', 'high', 'max'].includes(effort)) request.output_config = {effort};
  }
  if (body.text?.format && body.text.format.type !== 'text') {
    if (!['json_schema', 'json_object'].includes(body.text.format.type)) fail('Unsupported structured output');
    request.system += '\nReturn exactly one JSON object.' + (body.text.format.schema ? '\nRequired JSON schema:\n' + JSON.stringify(body.text.format.schema) : '');
  }
  return {request, tools};
}

async function serve({body, route, response, signal, fetch: fetchApi}) {
  const {request, tools} = toMessages(body, route);
  const Anthropic = require('@anthropic-ai/sdk').default;
  // The official SDK appends /v1/messages; SealWork's baseURL includes /v1.
  const client = new Anthropic({apiKey: route.apiKey, baseURL: route.baseURL.replace(/\/v1\/?$/, ''), defaultHeaders: {'x-api-key': route.apiKey}, fetch: fetchApi, maxRetries: 0, timeout: 600000});
  const stream = await client.messages.create(request, {signal});
  const id = 'resp_' + crypto.randomUUID(), output = [], blocks = new Map();
  let usage = {}, stopped = false, stopReason;
  response.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-store'});
  const send = (type, fields) => { if (!response.destroyed) response.write('event: ' + type + '\ndata: ' + JSON.stringify({type, ...fields}) + '\n\n'); };
  send('response.created', {response: {id, object: 'response', status: 'in_progress', output: []}});
  for await (const event of stream) {
    if (event.type === 'message_start') usage = {...event.message.usage};
    if (event.type === 'content_block_start') {
      const block = structuredClone(event.content_block), index = output.length;
      let item, tool;
      if (block.type === 'text') item = {type: 'message', id: 'msg_' + crypto.randomUUID(), role: 'assistant', status: 'in_progress', content: []};
      else if (block.type === 'tool_use') {
        tool = tools.find(t => t.alias === block.name); if (!tool) fail('Claude returned an unknown tool');
        item = tool.search ? {type: 'tool_search_call', id: 'ts_' + block.id, call_id: block.id, execution: 'client', status: 'in_progress', arguments: {}} : {type: tool.custom ? 'custom_tool_call' : 'function_call', id: 'fc_' + block.id, call_id: block.id, name: tool.name,
          ...(tool.namespace ? {namespace: tool.namespace} : {}), ...(tool.custom ? {input: ''} : {arguments: ''})};
      } else if (['thinking', 'redacted_thinking'].includes(block.type)) item = {type: 'reasoning', id: 'rs_' + crypto.randomUUID(), summary: []};
      else fail('Unsupported Claude output block: ' + block.type);
      blocks.set(event.index, {block, index, item, tool, partial: ''}); output.push(item);
      send('response.output_item.added', {output_index: index, item: structuredClone(item)});
      if (block.type === 'text') send('response.content_part.added', {item_id: item.id, output_index: index, content_index: 0, part: {type: 'output_text', text: '', annotations: []}});
    }
    if (event.type === 'content_block_delta') {
      const state = blocks.get(event.index); if (!state) fail('Claude stream delta without a block');
      const delta = event.delta;
      if (delta.type === 'text_delta') { state.block.text += delta.text; send('response.output_text.delta', {item_id: state.item.id, output_index: state.index, content_index: 0, delta: delta.text}); }
      else if (delta.type === 'input_json_delta') state.partial += delta.partial_json;
      else if (delta.type === 'thinking_delta') state.block.thinking += delta.thinking;
      else if (delta.type === 'signature_delta') state.block.signature = delta.signature;
      else fail('Unsupported Claude delta: ' + delta.type);
    }
    if (event.type === 'content_block_stop') {
      const state = blocks.get(event.index); if (!state) fail('Claude block stop without a block');
      const {block, item, index, tool} = state;
      if (block.type === 'text') {
        item.status = 'completed'; item.content = [{type: 'output_text', text: block.text, annotations: []}];
        send('response.output_text.done', {item_id: item.id, output_index: index, content_index: 0, text: block.text});
        send('response.content_part.done', {item_id: item.id, output_index: index, content_index: 0, part: item.content[0]});
      } else if (block.type === 'tool_use') {
        let args; try { args = state.partial ? JSON.parse(state.partial) : block.input; } catch { fail('Incomplete Claude tool arguments'); }
        if (tool.enveloped) {
          if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length !== 1 || !Object.hasOwn(args, 'arguments')) fail('Claude tool requires its argument envelope');
          args = args.arguments;
        }
        if (tool.search) { item.arguments = args; item.status = 'completed'; }
        const value = tool.custom ? args.input : JSON.stringify(args);
        if (typeof value !== 'string') fail('Claude custom tool requires an input string');
        if (!tool.search) item[tool.custom ? 'input' : 'arguments'] = value;
        if (!tool.search) {
        const type = tool.custom ? 'response.custom_tool_call_input' : 'response.function_call_arguments';
        send(type + '.delta', {item_id: item.id, output_index: index, delta: value});
        send(type + '.done', {item_id: item.id, output_index: index, ...(tool.custom ? {input: value} : {arguments: value})});
        }
      } else item.encrypted_content = opaquePrefix + Buffer.from(JSON.stringify([block])).toString('base64');
      state.done = true; send('response.output_item.done', {output_index: index, item});
    }
    if (event.type === 'message_delta') { usage = {...usage, ...event.usage}; stopReason = event.delta.stop_reason; }
    if (event.type === 'message_stop') stopped = true;
  }
  if (!stopped || [...blocks.values()].some(b => !b.done)) throw Object.assign(Error('Incomplete Claude stream'), {code: 'ANTHROPIC_STREAM_INCOMPLETE'});
  const status = ['end_turn', 'tool_use', 'stop_sequence'].includes(stopReason) ? 'completed' : 'incomplete';
  send(status === 'completed' ? 'response.completed' : 'response.incomplete', {response: {id, object: 'response', status, output,
    ...(status === 'incomplete' ? {incomplete_details: {reason: stopReason === 'max_tokens' ? 'max_output_tokens' : stopReason || 'unknown'}} : {}),
    usage: {input_tokens: usage.input_tokens || 0, output_tokens: usage.output_tokens || 0, total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0)}}});
  response.end();
}
module.exports = {toMessages, serve, toolDefinitions};
