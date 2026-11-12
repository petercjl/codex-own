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

// Rspack exposes its live require through the HTML entry module. Resolve the
// service reference in executable module factories, then use that live cache;
// executing a copied factory would create an uninitialized service instance.
export function nativeDeviceBundleContract(files,html){
 const matches=new Map(),runtimes=[];
 const walk=(node,visit)=>{if(!node||typeof node!=='object')return;visit(node);for(const value of Object.values(node))if(Array.isArray(value))value.forEach(n=>walk(n,visit));else if(value&&typeof value==='object')walk(value,visit);};
 for(const [file,source]of files){
  if(!source.includes('.codexMicro'))continue;
  const tree=parse(source,{ecmaVersion:'latest',sourceType:'module'});
  walk(tree,node=>{
   if(node.type!=='VariableDeclarator'||node.id.name!=='__webpack_modules__'||node.init?.type!=='ObjectExpression')return;
   for(const property of node.init.properties){
    const factory=property.value,requireName=factory.params?.[2]?.name,imports=new Map();if(!requireName)continue;
    for(const statement of factory.body.body??[])if(statement.type==='VariableDeclaration')for(const declaration of statement.declarations){
     const init=declaration.init;if(declaration.id.type==='Identifier'&&init?.type==='CallExpression'&&init.callee.name===requireName&&init.arguments.length===1&&typeof init.arguments[0].value==='string')imports.set(declaration.id.name,init.arguments[0].value);
    }
    walk(factory.body,member=>{
     if(member.type!=='MemberExpression'||member.computed||member.property.name!=='codexMicro')return;
     const object=member.object;if(object.type!=='MemberExpression'||object.computed||object.object.type!=='Identifier')return;
     const moduleId=imports.get(object.object.name);if(!moduleId)return;
     const entry={moduleId,binding:object.property.name};matches.set(JSON.stringify(entry),entry);
    });
   }
  });
 }
 for(const script of html.matchAll(/<script\b[^>]*\btype="module"[^>]*\bsrc="(\/assets\/[\w./-]+\.js)"[^>]*>/g)){
  const module=script[1],source=files.get(module.slice(1));if(!source)continue;
  const tree=parse(source,{ecmaVersion:'latest',sourceType:'module'});
  if(tree.body.some(n=>n.type==='ExportNamedDeclaration'&&n.specifiers.some(s=>s.exported.name==='__webpack_require__')))runtimes.push(module);
 }
 if(matches.size!==1||runtimes.length!==1)throw Error('Native device bundle RPC contract missing or ambiguous');
 return{runtimeModule:runtimes[0],...[...matches.values()][0]};
}
