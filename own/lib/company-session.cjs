'use strict';
// Privileged main-process operations. Never expose source credentials to MCP.
const path=require('node:path'),crypto=require('node:crypto'),{pathToFileURL}=require('node:url');
const fail=()=>Object.assign(Error('Company identity is unavailable'),{code:'AUTH_REQUIRED'});
const identity=grant=>grant&&Date.parse(grant.expiresAt)>Date.now()?crypto.createHash('sha256').update(grant.origin+'\n'+grant.token).digest('hex'):null;
async function invoke(root,action,p,{readSession,fetch,companyOrigin}={}){
 const api=await import(pathToFileURL(path.join(__dirname,'managed-login.mjs')));
 readSession ||= ()=>api.storedSession({core:path.join(root,'core')});
 fetch ||= (await import(pathToFileURL(path.join(__dirname,'network.mjs')))).networkFetch;
 companyOrigin ||= require('../defaults/company-auth.json').origin;
 const grant=await readSession(),current=identity(grant);if(!current||grant.origin!==companyOrigin)throw fail();
 if(action==='company.identity')return {origin:grant.origin,expiresAt:grant.expiresAt,identity:current};
 if(action!=='company.handoff'||p.identity!==current||! /^[a-f0-9]{64}$/.test(p.verifierHash||''))throw fail();
 const response=await fetch(grant.origin+'/api/company/v1/handoff/issue',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'content-type':'application/json',authorization:'Bearer '+grant.token,'x-company-app-id':'codex-own'},body:JSON.stringify({targetAppId:'tuda',verifierHash:p.verifierHash})});
 const value=await response.json(),data=value?.data;
 if(!response.ok||value.ok!==true||data?.contract!==1||data.sourceAppId!=='codex-own'||data.targetAppId!=='tuda'||! /^[A-Za-z0-9_-]{43}$/.test(data.code)||data.expiresIn!==60||identity(await readSession())!==current)throw fail();
 return data;
}
module.exports={invoke};
