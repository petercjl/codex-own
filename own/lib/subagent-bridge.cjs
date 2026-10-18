'use strict';
const fs=require('node:fs'),path=require('node:path');
const {Transform,Readable}=require('node:stream');
function selected(config){return config?.forced_login_method==='api'&&config.model_provider==='dashscope_deepseek'&&config.model_providers?.dashscope_deepseek?.wire_api==='responses'&&typeof config.model==='string'&&config.model.startsWith('deepseek-');}
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
 const result=changed?{...body,input}:body;
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
function rpcInput(url,{maxFrameBytes=64*1024*1024}={}){
 let pending=Buffer.alloc(0);
 return new Transform({transform(chunk,_encoding,done){
  try{
   pending=Buffer.concat([pending,chunk]);let i;
   while((i=pending.indexOf(10))>=0){
    if(i>maxFrameBytes)throw Error('Backend input frame exceeds limit');
    const bytes=pending.subarray(0,i+1);pending=pending.subarray(i+1);let m;
    try{m=JSON.parse(bytes.toString('utf8'));}catch{this.push(bytes);continue;}
    const next=pinRequest(m,url);this.push(next===m?bytes:Buffer.from(JSON.stringify(next)+'\n'));
   }
   if(pending.length>maxFrameBytes)throw Error('Backend input frame exceeds limit');done();
  }catch(e){done(e);}
 },flush(done){if(pending.length)return done(Error('Incomplete backend input frame'));done();}});
}
function invocation({cli,args,options,core,config,platform=process.platform}){
 if(!selected(config))return null;
 const root=path.join(path.dirname(cli),'own-updater'),node=path.join(root,platform==='win32'?'node.exe':'node'),runner=path.join(root,'lib','subagent-bridge-runner.cjs');
 if(!fs.existsSync(node)||!fs.existsSync(runner))throw Object.assign(Error('Bundled API compatibility runtime is missing'),{code:'AGENT_BRIDGE_MISSING'});
 return {file:node,args:[runner,core,cli,...args],options};
}
async function startServer({upstream,fetch:fetchApi,dispatcher,maxBodyBytes=64*1024*1024}){
 const http=require('node:http'),base=new URL(upstream);
 if(!['http:','https:'].includes(base.protocol)||base.username||base.password)throw Error('Invalid configured API endpoint');
 const active=new Set();
 const server=http.createServer(async(req,res)=>{
  const abort=new AbortController();active.add(abort);
  res.once('close',()=>{if(!res.writableEnded)abort.abort();});
  try{
   if(req.method!=='POST'||!req.url?.startsWith('/responses')||req.url.startsWith('//')){res.writeHead(404);res.end();return;}
   const pathname=new URL(req.url,'http://127.0.0.1');
   if(!['/responses','/responses/compact'].includes(pathname.pathname)){res.writeHead(404);res.end();return;}
   if(req.headers['content-encoding']&&req.headers['content-encoding']!=='identity')throw Object.assign(Error('Compressed request is unsupported'),{code:'AGENT_BRIDGE_ENCODING'});
   const chunks=[];let length=0;
   for await(const chunk of req){length+=chunk.length;if(length>maxBodyBytes)throw Object.assign(Error('API request exceeds limit'),{code:'AGENT_BRIDGE_TOO_LARGE'});chunks.push(chunk);}
   const bytes=Buffer.concat(chunks),body=JSON.parse(bytes.toString('utf8')),normalized=normalizeBody(body);
   const payload=normalized===body?bytes:Buffer.from(JSON.stringify(normalized));
   const target=new URL(base);target.pathname=base.pathname.replace(/\/$/,'')+pathname.pathname;
   for(const [k,v] of pathname.searchParams)target.searchParams.append(k,v);
   const headers={};
   for(const [k,v] of Object.entries(req.headers))if(!['host','connection','content-length','content-encoding','accept-encoding','transfer-encoding','proxy-authorization'].includes(k)&&v!==undefined)headers[k]=v;
   const response=await fetchApi(target,{method:'POST',headers,body:payload,signal:abort.signal,...dispatcher?{dispatcher}:{}});
   res.writeHead(response.status,{'content-type':response.headers.get('content-type')||'application/json','cache-control':'no-store'});
   if(response.body)await new Promise((resolve,reject)=>{const stream=Readable.fromWeb(response.body);stream.once('error',reject);res.once('error',reject);res.once('finish',resolve);res.once('close',()=>{stream.destroy();resolve();});stream.pipe(res);});
   else res.end();
  }catch(error){
   if(!res.headersSent&&!res.destroyed){res.writeHead(502,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:error.code||'AGENT_BRIDGE_FAILED',message:'The local API compatibility request could not be completed'}}));}
   else res.destroy();
  }finally{active.delete(abort);}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
 return {url:'http://127.0.0.1:'+server.address().port,close:async()=>{for(const a of active)a.abort();await new Promise(resolve=>server.close(resolve));}};
}
module.exports={selected,normalizeBody,pinRequest,rpcInput,invocation,startServer};
