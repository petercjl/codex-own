// Private-profile acceptance MCP server: deterministic, read-only, no service access.
import readline from 'node:readline';
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
for await (const line of readline.createInterface({input: process.stdin})) {
  const m = JSON.parse(line); if (m.id === undefined) continue;
  let result;
  if (m.method === 'initialize') result = {protocolVersion: m.params.protocolVersion, capabilities: {tools: {}}, serverInfo: {name: 'model_route_probe', version: '1'}};
  else if (m.method === 'tools/list') result = {tools: [{name: 'probe', description: 'Read-only codex-own model routing acceptance probe. Returns MODEL_DISCOVERY_OK.', inputSchema: {type: 'object', properties: {}, additionalProperties: false}}]};
  else if (m.method === 'tools/call' && m.params.name === 'probe') result = {content: [{type: 'text', text: 'MODEL_DISCOVERY_OK'}]};
  else if (m.method === 'ping') result = {};
  else {send({jsonrpc: '2.0', id: m.id, error: {code: -32601, message: 'Unknown method'}}); continue;}
  send({jsonrpc: '2.0', id: m.id, result});
}
