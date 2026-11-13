'use strict';
const fs=require('node:fs'),path=require('node:path');
const {Transform,Readable}=require('node:stream');
const patchCompat=require('./patch-compat.cjs');
const toolHistory=require('./tool-history-compat.cjs');
const toolSearch=require('./tool-search-compat.cjs');
function selected(config){return config?.forced_login_method==='api'&&(config.model_provider==='codex_own_imported'||config.model_provider==='dashscope_deepseek'&&config.model_providers?.dashscope_deepseek?.wire_api==='responses'&&typeof config.model==='string'&&config.model.startsWith('deepseek-'));}
function normalizeBody(body){
 if(!body||!Array.isArray(body.input)||typeof body.model!=='string'||!body.model.startsWith('deepseek-'))return body;
 let changed=false;
 const input=body.input.map(item=>{
  if(item?.type!=='agent_message')return item;
  if(!Array.isArray(item.content)||!item.content.length)throw Object.assign(Error('Unsupported agent message content'),{code:'AGENT_MESSAGE_INVALID'});
  const content=item.content.map(part=>{
   if(part.type==='input_text'&&typeof part.text==='string')return {...part};
   // The native v2 tool handler puts its model-generated message string in
   // this field. Treat it literally; never decode reasoning or opaque blobs.
   if(part.type==='encrypted_content'&&typeof part.encrypted_content==='string')return {type:'input_text',text:part.encrypted_content};
   throw Object.assign(Error('Unsupported agent message part'),{code:'AGENT_MESSAGE_INVALID'});
  });
  changed=true;return {type:'message',role:'user',content};
 });
 const result=toolHistory.history(patchCompat.history(toolSearch.history(changed?{...body,input}:body)));
 const format=result.text?.format;
 if(format?.type!=='json_schema')return result;
 if(!format.schema||typeof format.schema!=='object'||Array.isArray(format.schema))throw Object.assign(Error('Invalid structured response schema'),{code:'API_RESPONSE_SCHEMA_INVALID'});
 const instructions=(typeof result.instructions==='string'?result.instructions+'\n\n':'')+'Return exactly one JSON object matching this schema. Use the required field names and types.\n'+JSON.stringify(format.schema);
 return {...result,instructions,text:{...result.text,format:{type:'json_object'}}};
}
function pinRequest(message,url,provider='dashscope_deepseek'){
 if(!['thread/start','thread/resume','thread/fork'].includes(message?.method)||!message.params)return message;
 const p=message.params,c=p.config;
 if(p.modelProvider!=null&&p.modelProvider!==provider||c?.model_provider!=null&&c.model_provider!==provider)return message;
 const config={...(c||{}),['model_providers.'+provider+'.base_url']:url};
 if(c?.model_providers?.[provider])config.model_providers={...c.model_providers,[provider]:{...c.model_providers[provider],base_url:url}};
 return {...message,params:{...p,config}};
}
function rpcInput(url,{maxFrameBytes=require('./request-budget.cjs').maxRequestBytes(),provider='dashscope_deepseek'}={}){
 return require('./request-budget.cjs').frames({maxFrameBytes,adapt:message=>pinRequest(message,url,provider)});
}
function invocation({cli,args,options,core,config,platform=process.platform}){
 if(!selected(config))return null;
 const root=path.join(path.dirname(cli),'own-updater'),node=require('./bundled-node.cjs').resolveBundledNode(root,platform),runner=path.join(root,'lib','subagent-bridge-runner.cjs');
 if(!fs.existsSync(node)||!fs.existsSync(runner))throw Object.assign(Error('Bundled API compatibility runtime is missing'),{code:'AGENT_BRIDGE_MISSING'});
 return {file:node,args:[runner,core,cli,...args],options};
}
function bridgeFailure(error){
 const status=Number.isInteger(error.status)&&error.status>=400&&error.status<=599?error.status:null;
 const providerError=error.error?.error||error.error;
 if(status===400&&(providerError?.code==='context_length_exceeded'||providerError?.type==='invalid_request_error'&&/prompt is too long|maximum context length|context length.*exceed/i.test(providerError.message||'')))return {status:400,error:{type:'invalid_request_error',code:'context_length_exceeded',message:'The model context window was exceeded.'}};
 const local={AGENT_BRIDGE_TOO_LARGE:413,ANTHROPIC_INPUT_UNSUPPORTED:400,ANTHROPIC_COMPACTION_UNSUPPORTED:400,AUTH_REQUIRED:401,ACCESS_DENIED:403};
 const code=error.code||(status?'UPSTREAM_HTTP_'+status:'AGENT_BRIDGE_FAILED');
 return {status:local[code]||status||502,error:{code,message:code==='ANTHROPIC_INPUT_UNSUPPORTED'?error.message:code==='AGENT_BRIDGE_TOO_LARGE'?'Request exceeds the available local JSON memory budget.':'The local model request could not be completed ('+code+').'}};
}
async function startServer({upstream,fetch:fetchApi,dispatcher,maxBodyBytes=require('./request-budget.cjs').maxRequestBytes(),resolveRoute,authorization,beforeRequest,prepareBody=body=>body}){
 const http=require('node:http'),base=new URL(upstream||'http://127.0.0.1');
 if(!['http:','https:'].includes(base.protocol)||base.username||base.password)throw Error('Invalid configured API endpoint');
 const active=new Set();
 const server=http.createServer(async(req,res)=>{
  const abort=new AbortController();active.add(abort);
  res.once('close',()=>{if(!res.writableEnded)abort.abort();});
  try{
   if(authorization&&req.headers.authorization!=='Bearer '+authorization){res.writeHead(401);res.end();return;}
   if(req.method!=='POST'||!req.url?.startsWith('/responses')||req.url.startsWith('//')){res.writeHead(404);res.end();return;}
   const pathname=new URL(req.url,'http://127.0.0.1');
   if(!['/responses','/responses/compact'].includes(pathname.pathname)){res.writeHead(404);res.end();return;}
   if(req.headers['content-encoding']&&req.headers['content-encoding']!=='identity')throw Object.assign(Error('Compressed request is unsupported'),{code:'AGENT_BRIDGE_ENCODING'});
   const chunks=[];let length=0;
   for await(const chunk of req){length+=chunk.length;if(length>maxBodyBytes)throw Object.assign(Error('API request exceeds limit'),{code:'AGENT_BRIDGE_TOO_LARGE'});chunks.push(chunk);}
   const bytes=Buffer.concat(chunks),originalBody=JSON.parse(bytes.toString('utf8')),route=resolveRoute?.(originalBody.model),body=await prepareBody(route?{...originalBody,model:route.model}:originalBody);
   const permissionSignal=await beforeRequest?.(body),signal=permissionSignal?AbortSignal.any([abort.signal,permissionSignal]):abort.signal;
   if(route?.protocol==='anthropic'){
    if(pathname.pathname!=='/responses')throw Object.assign(Error('Messages API does not support remote compaction'),{code:'ANTHROPIC_COMPACTION_UNSUPPORTED'});
    await require('./anthropic-responses.cjs').serve({body,route,response:res,signal,fetch:(url,options)=>fetchApi(url,{...options,...dispatcher?{dispatcher}:{}})});return;
   }
   const normalized=normalizeBody(body);
   const payload=normalized===originalBody?bytes:Buffer.from(JSON.stringify(normalized));
   const targetBase=route?new URL(route.baseURL):base,target=new URL(targetBase);target.pathname=targetBase.pathname.replace(/\/$/,'')+pathname.pathname;
   for(const [k,v] of pathname.searchParams)target.searchParams.append(k,v);
   const headers={};
   for(const [k,v] of Object.entries(req.headers))if(!['host','connection','content-length','content-encoding','accept-encoding','transfer-encoding','proxy-authorization'].includes(k)&&v!==undefined)headers[k]=v;
   if(route)headers.authorization='Bearer '+route.apiKey;
   const response=await fetchApi(target,{method:'POST',headers,body:payload,signal,...dispatcher?{dispatcher}:{}});
   res.writeHead(response.status,{'content-type':response.headers.get('content-type')||'application/json','cache-control':'no-store'});
   if(response.body&&response.ok&&body.model?.startsWith('deepseek-')&&(response.headers.get('content-type')||'').includes('application/json')){
    res.end(JSON.stringify(toolSearch.response(patchCompat.response(await response.json()))));
   }else if(response.body)await new Promise((resolve,reject)=>{
    const stream=Readable.fromWeb(response.body),adapter=response.ok&&body.model?.startsWith('deepseek-')&&(response.headers.get('content-type')||'').includes('text/event-stream')?patchCompat.eventStream({adaptEvent:toolSearch.eventAdapter()}):null;
    stream.once('error',reject);adapter?.once('error',reject);res.once('error',reject);res.once('finish',resolve);res.once('close',()=>{stream.destroy();adapter?.destroy();resolve();});
    if(adapter)stream.pipe(adapter).pipe(res);else stream.pipe(res);
   });
   else res.end();
  }catch(error){
   if(!res.headersSent&&!res.destroyed){const failure=bridgeFailure(error);res.writeHead(failure.status,{'content-type':'application/json'});res.end(JSON.stringify({error:failure.error}));}
   else res.destroy();
  }finally{active.delete(abort);}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
 return {url:'http://127.0.0.1:'+server.address().port,close:async()=>{for(const a of active)a.abort();await new Promise(resolve=>server.close(resolve));}};
}
module.exports={selected,normalizeBody,pinRequest,rpcInput,invocation,startServer};
