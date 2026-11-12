import path from 'node:path';
const patternFor=kind=>kind==='main'?/\[([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.help\]:([A-Za-z_$][\w$]*)\(\1\.help\)/g:/\{id:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.help,message:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.help,mnemonic:(["'`])h\1\}(?=\])/g;
// Extend the Windows custom menu bridge and title bar together. A new native
// root alone is omitted by upstream's fixed menu snapshot and renderer list.
export function patchUpdateMenuSource(source,kind){
 const backend='["codex-own-updates"]:',frontend='id:"codex-own-updates",message:';
 const marker=kind==='main'?backend:frontend;
 if(source.includes(marker))return source;
 const pattern=patternFor(kind);
 const matches=[...source.matchAll(pattern)];
 if(matches.length!==1)throw Error('Windows update menu contract changed: '+kind);
 return kind==='main'?source.replace(pattern,(all,_ids,read)=>all+','+backend+read+'("codex-own-updates")'):
  source.replace(pattern,all=>all+',{'+frontend+'{id:"codexOwn.updates",defaultMessage:"更新",description:"Label for codex-own updates"},mnemonic:"u"}');
}
export function updateMenuChanges(asar,archive){
 const changes=new Map(),counts={main:0,renderer:0};
 for(const entry of asar.listPackage(archive)){
  const file=entry.replaceAll('\\','/').replace(/^\//,'');
  const kind=file.startsWith('.vite/build/')&&file.endsWith('.js')?'main':file.startsWith('webview/assets/')&&file.endsWith('.js')?'renderer':null;
  if(!kind)continue;
  const source=asar.extractFile(archive,file.replaceAll('/',path.sep)).toString();
  const marker=kind==='main'?'["codex-own-updates"]:':'id:"codex-own-updates",message:';
  if(!source.includes(marker)&&!patternFor(kind).test(source))continue;
  const next=patchUpdateMenuSource(source,kind);
  counts[kind]++;if(next!==source)changes.set(file,Buffer.from(next));
 }
 if(counts.main!==1||counts.renderer!==1)throw Error('Windows update menu assets changed');
 return changes;
}
