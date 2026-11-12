import {parse} from 'acorn';
// Delay the existing async startup flow, after Chromium switches were set.
// A synchronous require gate would freeze Electron before it can show progress.
export function gateToolStartup(source,runtimeFile){
 const gate=`await require("./${runtimeFile}").ensureTools();`;
 if(source.includes(gate))return source;
 const ast=parse(source,{ecmaVersion:'latest',sourceType:'script'});
 const candidates=[];
 function walk(n){if(!n||typeof n!=='object')return;
  if(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(n.type)&&n.async&&n.body.type==='BlockStatement'&&n.body.end-n.body.start<20000&&source.slice(n.body.start,n.body.end).includes('initializeNodeNetworkPermissions'))candidates.push(n);
  for(const v of Object.values(n))if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);
 }walk(ast);
 if(candidates.length!==1)throw Error('Unknown asynchronous desktop bootstrap contract');
 const at=candidates[0].body.start+1;return source.slice(0,at)+gate+source.slice(at);
}
