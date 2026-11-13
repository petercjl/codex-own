// Desktop authorization contract 1. Only employee grants are stored locally.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import imageAdapter from './bundled-image.cjs';
import credentials from './direct-credentials.cjs';
import {networkFetch} from './network.mjs';
import {parseModelAccess,readModelAccess} from './model-access.mjs';
import {configureModels,rejectLinks} from './manager.mjs';
const prefix='/api/codex-own';
const fault=(code,message)=>Object.assign(Error(message),{code});
export function serviceOrigin(value,{allowHttp=false}={}){
 let url;try{url=new URL(value);}catch{throw fault('SERVICE_URL_INVALID','请输入有效的服务地址');}
 if(url.pathname!=='/'||url.search||url.hash||url.username||url.password||!(url.protocol==='https:'||allowHttp&&url.protocol==='http:'))throw fault('SERVICE_URL_INVALID','服务地址须为 HTTPS；公司内网测试需明确允许 HTTP');
 return url.origin;
}
async function request(origin,endpoint,{fetcher=networkFetch,signal,token,body}={}){
 const response=await fetcher(origin+prefix+endpoint,{method:body===undefined?'GET':'POST',redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),headers:{...body===undefined?{}:{'content-type':'application/json'},...token?{authorization:'Bearer '+token}:{}},body:body===undefined?undefined:JSON.stringify(body)});
 let result;try{const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>1024*1024){await response.body.cancel().catch(()=>{});throw Error();}chunks.push(Buffer.from(chunk));}result=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fault('SERVICE_INVALID','登录服务返回了无效响应');}
 if(!response.ok||result.ok!==true)throw fault(['AUTH_REQUIRED','ACCESS_DENIED','AUTH_REQUEST_EXPIRED','RATE_LIMIT'].includes(result.error?.code)?result.error.code:'LOGIN_FAILED',({AUTH_REQUIRED:'登录已失效，请重新使用钉钉登录',ACCESS_DENIED:'请联系管理员开通 codex-own 使用权限',AUTH_REQUEST_EXPIRED:'授权已过期，请重新登录',RATE_LIMIT:'请求过多，请稍后重试'})[result.error?.code]||'登录服务暂时不可用，请稍后重试');
 return result.data;
}
export async function beginLogin(value,{allowHttp=false,fetcher=networkFetch,signal}={}){
 const origin=serviceOrigin(value,{allowHttp}),verifier=crypto.randomBytes(32).toString('base64url'),verifierHash=crypto.createHash('sha256').update(verifier).digest('hex');
 const data=await request(origin,'/auth/start',{fetcher,signal,body:{verifierHash}});
 let url;try{url=new URL(data.verificationUrl);}catch{throw fault('SERVICE_INVALID','授权地址无效');}
 if(data.contract!==1||! /^[A-Za-z0-9_-]{43}$/.test(data.requestId)||url.origin!==origin||url.pathname!==prefix+'/auth/authorize'||url.searchParams.get('request')!==data.requestId||url.username||url.password||url.hash||data.userCode!==data.requestId.slice(0,8).toUpperCase()||!Number.isFinite(data.expiresIn)||data.expiresIn<=0||data.expiresIn>600)throw fault('SERVICE_INVALID','授权地址或协议不匹配');
 return {origin,allowHttp,verifier,requestId:data.requestId,verificationUrl:url.href,userCode:data.userCode,expires:Date.now()+data.expiresIn*1000,intervalMs:Math.max(2000,Math.min(10000,data.intervalMs||2000))};
}
export async function pollLogin(pending,{fetcher=networkFetch,signal}={}){
 if(Date.now()>=pending.expires)throw fault('AUTH_REQUEST_EXPIRED','授权已过期，请重新登录');
 const data=await request(pending.origin,'/auth/poll',{fetcher,signal,body:{requestId:pending.requestId,verifier:pending.verifier}});
 if(data?.status==='pending')return null;
 if(data?.contract!==1||!/^cow_[A-Za-z0-9_-]{43}$/.test(data.token)||!Number.isFinite(Date.parse(data.expiresAt))||Date.parse(data.expiresAt)<=Date.now())throw fault('SERVICE_INVALID','登录凭证无效');
 return {origin:pending.origin,allowHttp:pending.allowHttp,token:data.token,expiresAt:data.expiresAt,name:String(data.member?.name||'钉钉用户').slice(0,100)};
}
function sessionFile(p){return path.join(p.core,'managed-login.json');}
function saveMetadata(p,metadata){
 const file=sessionFile(p);rejectLinks(file);fs.mkdirSync(p.core,{recursive:true,mode:0o700});
 if(fs.existsSync(file)){if(!fs.statSync(file).isFile())throw fault('UNSAFE_PATH','账户记录路径无效');fs.copyFileSync(file,file+'.backup-'+crypto.randomUUID(),fs.constants.COPYFILE_EXCL);}
 const temp=file+'.new-'+crypto.randomUUID();fs.writeFileSync(temp,JSON.stringify(metadata,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(temp,file);
}
export async function completeLogin(grant,{p,isRunning,fetcher=networkFetch,signal,protection}={}){
 const bootstrap=await request(grant.origin,'/bootstrap',{fetcher,signal,token:grant.token});
 if(bootstrap?.contract!==1)throw fault('SERVICE_INVALID','账户配置无效');
 const source=await request(grant.origin,'/direct-models',{fetcher,signal,token:grant.token});
 if(source?.contract!==2||source.transport!=='direct'||!source.provider||typeof source.provider!=='object'||!/^[a-f0-9]{64}$/.test(source.subject||'')||!/^[a-f0-9]{64}$/.test(source.configVersion||''))throw fault('SERVICE_INVALID','直连模型配置无效，请更新公司认证服务');
 const input=structuredClone(source);delete input.contract;delete input.transport;delete input.subject;delete input.configVersion;
 for(const [id,provider]of Object.entries(input.provider)){
  const url=new URL(provider.options?.baseURL);
  if(url.origin===grant.origin||typeof provider.options?.apiKey!=='string'||/^(cow_|cdev_)/.test(provider.options.apiKey))throw fault('SERVICE_INVALID','直连模型地址或凭据无效');
 }
 const access=parseModelAccess(JSON.stringify(input));
 const credentialFile=await credentials.save(p.core,{schema:1,access,session:{origin:grant.origin,allowHttp:grant.allowHttp===true,token:grant.token,expiresAt:grant.expiresAt,subject:source.subject,configVersion:source.configVersion}},{protection});
 // Public model metadata stays readable by the manager. Real secrets are encrypted.
 for(const provider of Object.values(input.provider))provider.options.apiKey='sk-codex-own-protected-local-only';
 const result=await configureModels(input,{p,isRunning});
 saveMetadata(p,{contract:2,transport:'direct',credentialFile,subject:source.subject,configVersion:source.configVersion,origin:grant.origin,allowHttp:grant.allowHttp===true,name:grant.name,expiresAt:grant.expiresAt,active:true});
 let image;try{image=await imageAdapter.configure(p.root,bootstrap,{expiresAt:grant.expiresAt});}catch{image=imageAdapter.deactivate(p.root,'IMAGE_SETUP_FAILED');}
 return {ok:true,name:grant.name,models:result.models,image,restartRequired:true};
}
export async function storedSession(p,{protection}={}){
 const file=sessionFile(p);if(!fs.existsSync(file))return null;rejectLinks(file);const meta=JSON.parse(fs.readFileSync(file,'utf8'));
 if(![1,2].includes(meta.contract)||!meta.active)return null;
 if(meta.contract===2){const value=await credentials.bootstrap(p.core,{protection});return {...meta,token:value.session.token};}
 const origin=serviceOrigin(meta.origin,{allowHttp:meta.allowHttp===true}),access=readModelAccess(p.core),providers=Object.entries(access?.providers||{});
 const token=providers[0]?.[1]?.apiKey;
 if(!/^cow_[A-Za-z0-9_-]{43}$/.test(token)||!providers.every(([id,p])=>p.apiKey===token&&p.baseURL===origin+prefix+'/proxy/'+id+'/v1'))throw fault('SESSION_INVALID','登录配置已变化，请重新登录');
 return {...meta,origin,token};
}
export async function loginStatus(p,{fetcher=networkFetch,signal,protection}={}){
 const session=await storedSession(p,{protection});if(!session){
  for(const name of ['company-service.json','managed-login.json']){const file=path.join(p.core,name);if(!fs.existsSync(file))continue;rejectLinks(file);if(!fs.statSync(file).isFile()||fs.statSync(file).size>4096)continue;try{const meta=JSON.parse(fs.readFileSync(file,'utf8'));if([1,2].includes(meta.contract))return {authenticated:false,origin:serviceOrigin(meta.origin,{allowHttp:meta.allowHttp===true})};}catch{}}
  return {authenticated:false};
 }
 if(Date.parse(session.expiresAt)<=Date.now())return {authenticated:false,expired:true,origin:session.origin};
 try{const data=await request(session.origin,'/session',{fetcher,signal,token:session.token});
  if(data?.authenticated===true&&(session.contract===1||data.configVersion&&data.configVersion!==session.configVersion)){await completeLogin(session,{p,isRunning:()=>[],fetcher,signal,protection});return {authenticated:true,restartRequired:true,name:session.name,origin:session.origin,expiresAt:session.expiresAt};}
  return {authenticated:data?.authenticated===true,name:session.name,origin:session.origin,expiresAt:session.expiresAt};}
 catch(e){if(['AUTH_REQUIRED','ACCESS_DENIED'].includes(e.code))return {authenticated:false,expired:true,origin:session.origin};throw e;}
}
export async function logout(p,{fetcher=networkFetch,signal,protection}={}){
 imageAdapter.deactivate(p.root);
 const session=await storedSession(p,{protection});if(!session)return {ok:true};
 let remoteRevoked=false;try{await request(session.origin,'/logout',{fetcher,signal,token:session.token,body:{}});remoteRevoked=true;}catch{}
 // Disable local routing even when disconnected; the server grant expires separately.
 const file=path.join(p.core,'model-access.json');rejectLinks(file);const value=JSON.parse(fs.readFileSync(file,'utf8'));
 for(const provider of Object.values(value.providers))provider.apiKey='sk-codex-own-logged-out';
 const temp=file+'.new-'+crypto.randomUUID();fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(temp,file);
 saveMetadata(p,{...session,token:undefined,active:false});return {ok:true,remoteRevoked,restartRequired:true};
}
