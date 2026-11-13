import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createRequire} from 'node:module';
import {parseModelAccess} from '../lib/model-access.mjs';
const require = createRequire(import.meta.url), bridge = require('../lib/subagent-bridge.cjs'), {routing} = require('../lib/model-router.cjs'), anthropic = require('../lib/anthropic-responses.cjs');
const searchCompat = require('../lib/tool-search-compat.cjs');

test('Claude envelopes composed native schemas and restores their history without changing the caller contract', () => {
  for (const composition of ['oneOf', 'anyOf', 'allOf']) {
    const schema = {type: 'object', $defs: {code: {type: 'string'}}, properties: {code: {$ref: '#/$defs/code'}}, [composition]: [{required: ['code']}]};
    const tool = {type: 'function', name: 'js', parameters: schema}, before = structuredClone(tool);
    const body = {tools: [{type: 'namespace', name: 'mcp__cua_repl', tools: [tool]}], input: [{role: 'user', content: 'Check'},
      {type: 'function_call', call_id: 'call1', name: 'js', namespace: 'mcp__cua_repl', arguments: '{"code":"中文\\n"}'},
      {type: 'function_call_output', call_id: 'call1', output: 'OK'}]};
    const {request} = anthropic.toMessages(body, {model: 'claude-fixture', spec: {maxOutput: 1000}});
    assert.equal(request.tools[0].input_schema[composition], undefined);
    assert.deepEqual(request.tools[0].input_schema.properties.arguments[composition], schema[composition]);
    assert.equal(request.tools[0].input_schema.properties.arguments.properties.code.$ref, '#/properties/arguments/$defs/code');
    assert.deepEqual(request.messages[1].content[0].input, {arguments: {code: '中文\n'}});
    assert.deepEqual(tool, before, 'Native tool definition remains unchanged');
  }
});

test('Claude streams both computer-use union branches back as exact native arguments', async t => {
  const inputs = [{code: 'console.log("中文\\n")', title: '检查'}, {completion_summary: '已完成界面检查'}];
  let calls = 0;
  const upstream = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw), schema = body.tools[0].input_schema;
    assert.equal(schema.oneOf, undefined); assert.equal(schema.properties.arguments.oneOf.length, 2);
    const input = inputs[calls++];
    res.writeHead(200, {'content-type': 'text/event-stream'});
    const send = (type, value) => res.write('event: ' + type + '\ndata: ' + JSON.stringify({type, ...value}) + '\n\n');
    send('message_start', {message: {usage: {input_tokens: 1}}});
    send('content_block_start', {index: 0, content_block: {type: 'tool_use', id: 'toolu_union', name: 'mcp__cua_repl__js', input: {}}});
    const json = JSON.stringify({arguments: input}), middle = Math.floor(json.length / 2);
    for (const partial_json of [json.slice(0, middle), json.slice(middle)]) send('content_block_delta', {index: 0, delta: {type: 'input_json_delta', partial_json}});
    send('content_block_stop', {index: 0}); send('message_delta', {delta: {stop_reason: 'tool_use'}, usage: {output_tokens: 1}}); send('message_stop', {}); res.end();
  });
  await new Promise(r => upstream.listen(0, '127.0.0.1', r)); t.after(() => {upstream.closeAllConnections(); upstream.close();});
  const server = await bridge.startServer({fetch, resolveRoute: () => ({model: 'claude-fixture', apiKey: 'fixture-key', protocol: 'anthropic', baseURL: `http://127.0.0.1:${upstream.address().port}/v1`, spec: {maxOutput: 1000}})});
  t.after(() => server.close());
  for (const input of inputs) {
    const result = await fetch(server.url + '/responses', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({model: 'fixture', input: 'Check', tools: [{type: 'namespace', name: 'mcp__cua_repl', tools: [{type: 'function', name: 'js', parameters: {type: 'object', oneOf: [{required: ['code']}, {required: ['completion_summary']}], properties: {code: {type: 'string'}, completion_summary: {type: 'string'}, title: {type: 'string'}}}}]}]})});
    assert.equal(result.status, 200);
    const events = (await result.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
    const item = events.find(e => e.type === 'response.output_item.done').item;
    assert.equal(item.name, 'js'); assert.equal(item.namespace, 'mcp__cua_repl');
    assert.deepEqual(JSON.parse(item.arguments), input, 'Envelope stays within the provider adapter');
    assert.equal(events.at(-1).type, 'response.completed');
  }
  assert.equal(calls, 2);
});

test('Responses-compatible providers receive ordinary search functions and merged loaded schemas', () => {
  const fn = name => ({type: 'function', name, parameters: {type: 'object', properties: {}}});
  const ns = tool => ({type: 'namespace', name: 'mcp__fixture', tools: [fn(tool)]});
  const body = {model: 'deepseek-flash', tools: [{type: 'tool_search', execution: 'client', parameters: {type: 'object'}}, ns('first')], input: [
    {type: 'tool_search_call', call_id: 'search1', execution: 'client', arguments: {query: 'probe'}},
    {type: 'tool_search_output', call_id: 'search1', execution: 'client', tools: [ns('second')]},
    {type: 'function_call', call_id: 'use1', namespace: 'mcp__fixture', name: 'second', arguments: '{}'},
    {type: 'function_call_output', call_id: 'use1', output: 'OK'}]};
  const converted = bridge.normalizeBody(body);
  assert.equal(converted.tools[0].type, 'function');assert.equal(converted.tools[0].name, 'tool_search');
  assert.deepEqual(converted.tools[1].tools.map(t => t.name), ['first', 'second']);
  assert.equal(converted.input[0].type, 'function_call');assert.equal(converted.input[0].arguments, '{"query":"probe"}');
  assert.equal(converted.input[1].type, 'function_call_output');assert.equal(converted.input[1].call_id, 'search1');
  assert.equal(body.tools[1].tools.length, 1, 'Original persisted history is unchanged');
  const adapt = searchCompat.eventAdapter();
  const call = {type: 'function_call', id: 'fc1', call_id: 'search2', name: 'tool_search', arguments: ''};
  assert.equal(adapt({type: 'response.output_item.added', item: call})[0].item.type, 'tool_search_call');
  assert.deepEqual(adapt({type: 'response.function_call_arguments.delta', item_id: 'fc1', delta: '{'}), []);
  const done = adapt({type: 'response.output_item.done', item: {...call, arguments: '{"query":"probe"}'}})[0].item;
  assert.deepEqual(done.arguments, {query: 'probe'});assert.equal(done.execution, 'client');
  assert.equal(searchCompat.response({output: [{...call, arguments: '{}'}]}).output[0].type, 'tool_search_call');
});

test('model aliases route to separate provider credentials and unknown models cannot fall back', async t => {
  const seen = [], upstream = http.createServer(async (req, res) => { let body = ''; for await (const part of req) body += part;
    seen.push({auth: req.headers.authorization, body: JSON.parse(body)}); res.writeHead(200, {'content-type': 'application/json'}); res.end('{"output":[]}'); });
  await new Promise(r => upstream.listen(0, '127.0.0.1', r));t.after(() => {upstream.closeAllConnections();upstream.close();});
  const options = key => ({baseURL: `http://127.0.0.1:${upstream.address().port}/v1`, apiKey: key});
  const access = parseModelAccess(JSON.stringify({model: 'one/deepseek-flash', provider: {one: {options: options('key-first-fixture'), models: {'deepseek-flash': {}}}, two: {options: options('key-second-fixture'), models: {'deepseek-flash': {}}}}}));
  const server = await bridge.startServer({fetch, resolveRoute: routing(access), authorization: 'private-local-token'});t.after(() => server.close());
  const send = (model, token = 'private-local-token') => fetch(server.url + '/responses', {method: 'POST', headers: {authorization: 'Bearer ' + token, 'content-type': 'application/json'}, body: JSON.stringify({model, input: []})});
  assert.equal((await send('one/deepseek-flash', 'wrong-token')).status, 401);
  assert.equal((await send('absent/deepseek-flash')).status, 502); assert.equal(seen.length, 0);
  assert.equal((await send('one/deepseek-flash')).status, 200);assert.equal((await send('two/deepseek-flash')).status, 200);
  assert.deepEqual(seen.map(x => x.auth), ['Bearer key-first-fixture', 'Bearer key-second-fixture']);assert.deepEqual(seen.map(x => x.body.model), ['deepseek-flash', 'deepseek-flash']);
});
test('Messages translation preserves custom patch input, function calls, reasoning signatures and matched results', () => {
  const route = {model: 'claude-fixture', spec: {maxOutput: 4096, thinking: 'adaptive'}};
  const patch = '*** Begin Patch\n*** Add File: 中文.txt\n+literal \\n and 中文\n*** End Patch';
  const body = {instructions: 'system policy', model: 'claude-fixture', tools: [{type: 'custom', name: 'apply_patch'}, {type: 'function', name: 'exec_command', parameters: {type: 'object', properties: {cmd: {type: 'string'}}}}], input: [
    {role: 'user', content: [{type: 'input_text', text: 'Perform the task'}]},
    {type: 'custom_tool_call', name: 'apply_patch', call_id: 'patch-1', input: patch}, {type: 'custom_tool_call_output', call_id: 'patch-1', output: 'Success'},
    {type: 'function_call', name: 'exec_command', call_id: 'cmd-1', arguments: '{"cmd":"cat 中文.txt"}'}, {type: 'function_call_output', call_id: 'cmd-1', output: '中文'}]};
  const {request} = anthropic.toMessages(body, route);
  assert.equal(request.messages[1].content[0].input.input, patch);
  assert.equal(request.messages[1].content[0].id, request.messages[2].content[0].tool_use_id);
  assert.equal(request.messages[3].content[0].input.cmd, 'cat 中文.txt');
  assert.equal(request.messages[3].content[0].id, request.messages[4].content[0].tool_use_id);
  assert.equal(request.thinking.type, 'adaptive');assert.equal(request.tools[0].input_schema.required[0], 'input');
  assert.equal(anthropic.toMessages({...body,reasoning:{effort:'none'}},route).request.thinking.type,'disabled');
  assert.throws(()=>anthropic.toMessages({...body,reasoning:{effort:'ultra'}},route),{code:'ANTHROPIC_INPUT_UNSUPPORTED'});
  assert.throws(() => anthropic.toMessages({...body, input: [{type: 'unknown'}]}, route), {code: 'ANTHROPIC_INPUT_UNSUPPORTED'});
});
test('client tool discovery loads namespace tools and preserves search and call history after resume', () => {
  const search = {type: 'tool_search', execution: 'client', description: 'Discover tools', parameters: {type: 'object', properties: {query: {type: 'string'}}, required: ['query']}};
  const loaded = {type: 'namespace', name: 'mcp__probe', tools: [{type: 'function', name: 'probe', parameters: {type: 'object', properties: {}}}]};
  const input = [{role: 'user', content: 'Discover a tool'},
    {type: 'tool_search_call', execution: 'client', call_id: 'search1', arguments: {query: 'probe'}},
    {type: 'tool_search_output', execution: 'client', call_id: 'search1', tools: [loaded]},
    {type: 'function_call', name: 'probe', namespace: 'mcp__probe', call_id: 'call1', arguments: '{}'},
    {type: 'function_call_output', call_id: 'call1', output: 'OK'}];
  const {request} = anthropic.toMessages({tools: [search, loaded], input}, {model: 'claude-fixture', spec: {maxOutput: 1000}});
  assert.deepEqual(request.tools.map(t => t.name), ['tool_search', 'mcp__probe__probe']);
  assert.equal(request.messages[1].content[0].name, 'tool_search');
  assert.deepEqual(request.messages[1].content[0].input, {query: 'probe'});
  assert.equal(request.messages[1].content[0].id, request.messages[2].content[0].tool_use_id);
  assert.equal(request.messages[3].content[0].name, 'mcp__probe__probe');
  assert.equal(anthropic.toMessages({tools: [search], input}, {model: 'c', spec: {maxOutput: 1000}}).request.tools.length, 2);
  assert.throws(() => anthropic.toolDefinitions([{...search, execution: 'server'}]), {code: 'ANTHROPIC_INPUT_UNSUPPORTED'});
});
test('real Anthropic SDK stream converts tool arguments and terminal status without claiming truncated success', async t => {
  let request;const upstream = http.createServer(async (req, res) => {let raw = '';for await (const b of req) raw += b;request = JSON.parse(raw);
    assert.equal(req.url, '/v1/messages');assert.equal(req.headers['x-api-key'], 'key-claude-fixture');
    res.writeHead(200, {'content-type': 'text/event-stream'});const send = (type, value) => res.write('event: ' + type + '\ndata: ' + JSON.stringify({type, ...value}) + '\n\n');
    send('message_start', {message: {id: 'msg-fixture', type: 'message', role: 'assistant', model: 'claude-fixture', content: [], usage: {input_tokens: 12, output_tokens: 1}}});
    send('content_block_start', {index: 0, content_block: {type: 'tool_use', id: 'toolu_fixture', name: 'apply_patch', input: {}}});
    send('content_block_delta', {index: 0, delta: {type: 'input_json_delta', partial_json: JSON.stringify({input: '*** Begin Patch\n*** End Patch'})}});send('content_block_stop', {index: 0});
    send('message_delta', {delta: {stop_reason: 'max_tokens'}, usage: {output_tokens: 20}});send('message_stop', {});res.end();});
  await new Promise(r => upstream.listen(0, '127.0.0.1', r));t.after(() => {upstream.closeAllConnections();upstream.close();});
  const access = parseModelAccess(JSON.stringify({model: 'claude/claude-fixture', provider: {claude: {npm: '@ai-sdk/anthropic', options: {baseURL: `http://127.0.0.1:${upstream.address().port}/v1`, apiKey: 'key-claude-fixture'}, models: {'claude-fixture': {}}}}}));
  const server = await bridge.startServer({resolveRoute: routing(access), authorization: 'local-token', fetch});t.after(() => server.close());
  const result = await fetch(server.url + '/responses', {method: 'POST', headers: {authorization: 'Bearer local-token', 'content-type': 'application/json'}, body: JSON.stringify({model: access.model, input: 'Create a file', tools: [{type: 'custom', name: 'apply_patch'}]})});
  assert.equal(result.status, 200);const events = (await result.text()).split('\n').filter(l => l.startsWith('data: ')).map(l => JSON.parse(l.slice(6)));
  assert.equal(request.model, 'claude-fixture');assert.equal(events.find(e => e.type === 'response.output_item.done').item.input, '*** Begin Patch\n*** End Patch');
  assert.equal(events.at(-1).type, 'response.incomplete');assert.equal(events.at(-1).response.incomplete_details.reason, 'max_output_tokens');
});
test('streamed client search returns object arguments for native harness dispatch', async t => {
  const upstream = http.createServer(async (req, res) => {
    for await (const part of req) {} // Consume the synthetic request.
    res.writeHead(200, {'content-type': 'text/event-stream'});
    const send = (type, value) => res.write('event: ' + type + '\ndata: ' + JSON.stringify({type, ...value}) + '\n\n');
    send('message_start', {message: {usage: {input_tokens: 1, output_tokens: 1}}});
    send('content_block_start', {index: 0, content_block: {type: 'tool_use', id: 'search_fixture', name: 'tool_search', input: {}}});
    send('content_block_delta', {index: 0, delta: {type: 'input_json_delta', partial_json: '{"query":"probe"}'}});
    send('content_block_stop', {index: 0});
    send('message_delta', {delta: {stop_reason: 'tool_use'}});send('message_stop', {});res.end();
  });
  await new Promise(r => upstream.listen(0, '127.0.0.1', r));t.after(() => {upstream.closeAllConnections();upstream.close();});
  const server = await bridge.startServer({fetch, resolveRoute: () => ({model: 'claude-fixture', apiKey: 'fixture-key', protocol: 'anthropic', baseURL: `http://127.0.0.1:${upstream.address().port}/v1`, spec: {maxOutput: 1000}})});t.after(() => server.close());
  const response = await fetch(server.url + '/responses', {method: 'POST', body: JSON.stringify({input: 'Search', tools: [{type: 'tool_search', execution: 'client', parameters: {type: 'object', properties: {query: {type: 'string'}}}}]})});
  const events = (await response.text()).split('\n').filter(l => l.startsWith('data: ')).map(l => JSON.parse(l.slice(6)));
  const item = events.find(e => e.type === 'response.output_item.done').item;
  assert.equal(item.type, 'tool_search_call');assert.equal(item.execution, 'client');
  assert.deepEqual(item.arguments, {query: 'probe'});assert.equal(item.call_id, 'search_fixture');assert.equal(item.status, 'completed');
  assert.equal(events.at(-1).type, 'response.completed');
});
