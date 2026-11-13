'use strict';
const fs=require('node:fs'),path=require('node:path');
const PACKAGE='@petercjl/taobao-ai-ops';
function policy(root){
 const file=path.join(root,'company-tools','policy.json');
 if(!fs.existsSync(file))return {contract:1,autoUpdate:true};
 if(fs.lstatSync(file).isSymbolicLink())throw Error('Unsafe company tools policy');
 const value=JSON.parse(fs.readFileSync(file,'utf8'));
 if(value.contract!==1||typeof value.autoUpdate!=='boolean')throw Error('Invalid company tools policy');
 return {contract:1,autoUpdate:value.autoUpdate};
}
function selection(root){
 const base=path.join(root,'company-tools'),file=path.join(base,'active.json');
 if(!fs.existsSync(file))return null;
 const receipt=JSON.parse(fs.readFileSync(file,'utf8'));
 if(receipt.contract!==1||receipt.package!==PACKAGE||!/^generation-[a-f0-9-]{36}$/.test(receipt.generation))throw Error('Invalid company tools receipt');
 const directory=path.join(base,receipt.generation);
 for(const f of [base,file,directory])if(fs.lstatSync(f).isSymbolicLink())throw Error('Unsafe company tools path');
 return {...receipt,directory};
}
function environment(root,env,platform=process.platform){
 const next={...env};
 for(const key of Object.keys(next))if(/^TAOBAO_AI_OPS_|^AGENT_PACKAGE_UPDATE_CHECK$/.test(key))delete next[key];
 const current=selection(root);if(!current)return next;
 const graph=JSON.parse(fs.readFileSync(path.join(current.directory,'collection.json'),'utf8'));
 if(graph.package!==PACKAGE||graph.version!==current.version)throw Error('Company tools identity mismatch');
 // Only the collection's documented environment keys cross the host boundary.
 const state=path.join(current.directory,'state');
 if(graph.environment?.TAOBAO_AI_OPS_STATE_DIR!==state)throw Error('Invalid company tools state');
 const separator=platform==='win32'?';':':',bin=path.join(root,'company-tools','bin');
 const inherited=String(next.PATH||'').split(separator).filter(p=>p!==bin&&!p.startsWith(path.join(root,'company-tools','generation-'))).join(separator);
 const legacy=fs.existsSync(path.join(bin,'.codex-own-company-bin.json'))?'':path.join(current.directory,'bin')+separator;
 return {...next,PATH:bin+separator+legacy+inherited,
  TAOBAO_AI_OPS_STATE_DIR:state,TAOBAO_AI_OPS_AUTO_UPDATE:'0',AGENT_PACKAGE_UPDATE_CHECK:'0',NODE_USE_ENV_PROXY:'1'};
}
function apply(body,core){
 const current=selection(path.dirname(core));if(!current||!body||typeof body!=='object')return body;
 const marker='codex_own_company_tools',clean=String(body.instructions||'').replace(new RegExp(`<${marker}>[\\s\\S]*?<\\/${marker}>`,'g'),'').trim();
 const policy=`<${marker}>\nCompany Skills and CLIs are managed through ${PACKAGE}. The active collection pointer is ${JSON.stringify(path.join(path.dirname(core),'company-tools','active.json'))}. For a Skill registered there, read its complete current Skill under ${JSON.stringify(path.join(core,'skills','company-tools'))}, including when another independent installation has the same Skill name. Each managed Skill directory contains .collection-runtime.json with its exact runtimeEntry and environment; execute that entry using the private Node in CODEX_OWN_NODE and the declared environment. Commands in the stable company-tools/bin directory resolve the active collection at invocation time. Updates apply online; processes already running retain their loaded version. The desktop owns installation and updates; component calls retain business authentication, payment and external-action authorization boundaries.\n</${marker}>`;
 return {...body,instructions:[clean,policy].filter(Boolean).join('\n\n')};
}
module.exports={PACKAGE,selection,environment,apply,policy};
