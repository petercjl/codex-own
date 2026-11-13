import fs from 'node:fs/promises';
export type RegisteredApplication={id:string;name:string;corpId:string;organizationName:string};
export async function privateApplications(){
 const corpId=process.env.DINGTALK_CORP_ID!,organizationName=process.env.COMPANY_ORGANIZATION_NAME||'东轩';
 const defaults=[{id:'codex-own',name:'codex-own',corpId,organizationName},{id:'tuda',name:'Tuda',corpId,organizationName},{id:'project-workbench',name:'项目工作台',corpId,organizationName}];
 const file=process.env.COMPANY_APPLICATIONS_FILE;if(!file)return {applications:defaults,nas:undefined};
 const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024||(process.platform!=='win32'&&(stat.mode&0o077)!==0))throw Error('Unsafe company application file');
 const input=JSON.parse(await fs.readFile(file,'utf8'));if(input.schemaVersion!==1||!Array.isArray(input.applications))throw Error('Invalid company application registry');
 const applications=[...defaults,...input.applications];const ids=new Set();
 for(const a of applications){if(!/^[a-z][a-z0-9-]{0,63}$/.test(a.id)||ids.has(a.id)||a.corpId!==corpId||!['name','organizationName'].every(k=>typeof a[k]==='string'&&a[k].length>0&&a[k].length<=256))throw Error('Invalid registered company application');ids.add(a.id);}
 const nas=input.nas;if(nas&&(!(typeof nas.serviceToken==='string'&&nas.serviceToken.length>=32&&nas.serviceToken.length<=256)||! /^[a-f0-9]{64}$/.test(nas.organizationId)||nas.audience!=='tuda-nas'))throw Error('Invalid NAS service configuration');
 return {applications:applications as RegisteredApplication[],nas};
}
