import path from 'node:path';
// Retain the upstream resolver body verbatim; omit only its CLI entry call.
export function exposeVendorResolver(source){const code=source.replaceAll('\r\n','\n');if(!code.endsWith('main();\n'))throw Error('Upstream resolver contract changed');return code.slice(0,-8)+'module.exports={resolveCodexVendor};\n';}
export function withSystemTar(resolve,tar,{platform=process.platform,env=process.env}={}){
  if(platform!=='win32')return resolve();
  const key=Object.keys(env).find(k=>k.toLowerCase()==='path')||'PATH',old=env[key];
  env[key]=path.win32.dirname(tar)+(old?';'+old:'');
  try{return resolve();}finally{if(old===undefined)delete env[key];else env[key]=old;}
}
