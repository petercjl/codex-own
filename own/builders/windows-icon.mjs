import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),PE=require('pe-library'),RE=require('resedit');
const assets=path.resolve(import.meta.dirname,'../../resources/own');
export function applyWindowsIcon(app){
  // Callers own a fresh candidate and its recovery point, never the running app.
  const png=fs.readFileSync(path.join(assets,'codex-own-windows.png'));
  const ico=fs.readFileSync(path.join(assets,'codex-own-windows.ico'));
  const exeFile=path.join(app,'codex-own.exe'),resources=path.join(app,'resources');
  const exe=PE.NtExecutable.from(fs.readFileSync(exeFile),{ignoreCert:true});
  const res=PE.NtExecutableResource.from(exe),icon=RE.Data.IconFile.from(ico);
  const groups=RE.Resource.IconGroupEntry.fromEntries(res.entries);
  if(!groups.length)throw Error('Windows executable has no icon resource');
  for(const group of groups)RE.Resource.IconGroupEntry.replaceIconsForResource(res.entries,group.id,group.lang,icon.icons.map(i=>i.data));
  res.outputResource(exe);fs.writeFileSync(exeFile,Buffer.from(exe.generate()));
  fs.writeFileSync(path.join(resources,'codex-own.png'),png);
  for(const n of fs.readdirSync(resources).filter(n=>/\.ico$/i.test(n)))fs.writeFileSync(path.join(resources,n),ico);
  return {variant:'windows-blue-w',sha256:crypto.createHash('sha256').update(ico).digest('hex')};
}
export function verifyWindowsIcon(app){
  const expected=RE.Data.IconFile.from(fs.readFileSync(path.join(assets,'codex-own-windows.ico'))).icons.map(i=>Buffer.from(i.data.bin));
  const exe=PE.NtExecutable.from(fs.readFileSync(path.join(app,'codex-own.exe')),{ignoreCert:true});
  const entries=PE.NtExecutableResource.from(exe).entries,groups=RE.Resource.IconGroupEntry.fromEntries(entries);
  if(!groups.length)throw Error('Windows executable has no icon group');
  for(const group of groups){
    const actual=group.getIconItemsFromEntries(entries);
    if(actual.length!==expected.length||actual.some((item,i)=>!Buffer.from(item.bin).equals(expected[i])))throw Error('Windows executable icon differs from the published asset');
  }
  if(!fs.readFileSync(path.join(app,'resources/codex-own.png')).equals(fs.readFileSync(path.join(assets,'codex-own-windows.png'))))throw Error('Windows window icon differs from its executable');
  return {variant:'windows-blue-w',sizes:expected.length};
}
