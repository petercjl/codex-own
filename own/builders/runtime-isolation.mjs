import {parse} from 'acorn';
// Fail closed if the pinned upstream's runtime/cache contract changes.
export function isolateRuntimeSource(source){
 let changed=false;
 source=source.replace(/([\w$]+)\.default\.join\(([\w$]+)\.default\.homedir\(\),`\.cache`,`codex-runtimes`/g,(_old,p,o)=>{changed=true;return `${p}.default.join((process.env.CODEX_OWN_LEGACY_RUNTIME_ROOT||${p}.default.join(${o}.default.homedir(),\`.cache\`,\`codex-own-runtimes\`))`;});
 if(!changed)return source;
 // This complete optional OpenAI workspace bundle is a separate product. Its
 // updater must not download another toolchain over our npm-managed tools.
 const ast=parse(source,{ecmaVersion:'latest',sourceType:'script'}),edits=[];
 for(const node of ast.body){if(node.type!=='FunctionDeclaration'||!node.async)continue;
  const body=source.slice(node.body.start,node.body.end);
  if(body.includes('desiredBundleVersion')&&body.includes('fetchManifest'))edits.push({at:node.body.start+1,text:'if(process.env.CODEX_OWN_RUNTIME_ROOT)return{desiredBundleVersion:null,installedBundleVersion:null,status:"unsupported"};'});
  if(body.includes('primary_runtime_bundle_install_started'))edits.push({at:node.body.start+1,text:'if(process.env.CODEX_OWN_RUNTIME_ROOT)throw Error("codex-own tools are managed through npm; use codex-own runtime doctor/install");'});
 }
 for(const e of edits.sort((a,b)=>b.at-a.at))source=source.slice(0,e.at)+e.text+source.slice(e.at);
 return source;
}
