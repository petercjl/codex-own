import {parse} from 'acorn';
// Resolve the real desktop RPC export from executable source, independent of
// the bundler's current chunk hash and identifier names.
export function nativeDeviceContract(source){
 const tree=parse(source,{ecmaVersion:'latest',sourceType:'module'}),imports=new Map(),matches=new Map();
 for(const node of tree.body)if(node.type==='ImportDeclaration')for(const spec of node.specifiers)if(spec.type==='ImportSpecifier')imports.set(spec.local.name,{module:node.source.value,binding:spec.imported.name??spec.imported.value});
 function walk(node){if(!node||typeof node!=='object')return;
  if(node.type==='MemberExpression'&&!node.computed&&node.property.name==='codexMicro'&&node.object.type==='Identifier'){
   const entry=imports.get(node.object.name);if(entry&&/^\.\/app-shared-[\w-]+\.js$/.test(entry.module))matches.set(JSON.stringify(entry),entry);
  }
  for(const value of Object.values(node))if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);
 }
 walk(tree);if(matches.size!==1)throw Error('Native device RPC contract missing or ambiguous');
 const entry=[...matches.values()][0];return{module:'/assets/'+entry.module.slice(2),binding:entry.binding};
}
