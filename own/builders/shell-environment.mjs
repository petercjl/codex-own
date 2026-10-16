import{createRequire}from'node:module';const require=createRequire(import.meta.url),acorn=require('acorn');
const property=n=>n?.computed?n.property?.value:n?.property?.name;
export function isolateShellImport(source,runtime){
 if(!['own-runtime.cjs','own-runtime-win.cjs'].includes(runtime))throw Error('Unknown own runtime');
 const matches=[],observed=[];function walk(n){if(!n||typeof n!=='object')return;if(n.type==='CallExpression'&&n.callee?.type==='MemberExpression'&&n.callee.object?.name==='Object'&&property(n.callee)==='assign'&&n.arguments[0]?.object?.name==='process'&&property(n.arguments[0])==='env'){observed.push(n.arguments.map(a=>a.type));if(n.arguments.slice(1).some(a=>a.type==='MemberExpression'&&property(a)==='userEnv'))matches.push(n);}for(const v of Object.values(n))if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);}
 walk(acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'}));if(matches.length!==1)throw Error('Shell environment boundary changed: expected one userEnv import; argument shapes='+JSON.stringify(observed));
 const n=matches[0],call=source.slice(n.start,n.end),replacement=`(${call},require(${JSON.stringify('./'+runtime)}).apply(),process.env)`;
 return{source:source.slice(0,n.start)+replacement+source.slice(n.end),patches:1};
}
