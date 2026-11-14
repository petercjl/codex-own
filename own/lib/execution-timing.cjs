'use strict';
const {Transform,Readable}=require('node:stream'),{StringDecoder}=require('node:string_decoder');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const METHOD='codexOwn/executionTiming';
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(v)?v:null;
// Metadata only: never persist request/response bodies, headers, commands or errors.
function requestTrace(req,emit=()=>{},context=()=>null){
 const requestId=crypto.randomUUID(),started=performance.now(),marks={},headerId=id(req.headers.session_id)||id(req.headers['x-codex-thread-id'])||id(req.headers['x-codex-session-id']),resolved=context(headerId,req.headers),threadId=id(resolved?.threadId)||headerId;
 let last,ended=false,terminal=null;const turnId=id(resolved?.turnId);
 const mark=(phase,extra={})=>{if(ended||last===phase)return;last=phase;const elapsedMs=Math.round(performance.now()-started);marks[phase]??=elapsedMs;try{emit({requestId,threadId,turnId,phase,time:Date.now(),elapsedMs,...extra});}catch{}};
 mark('request_received');
 const trace={mark,observe(response){if(!response.body)return response;const input=Readable.fromWeb(response.body),output=trace.stream();input.on('error',e=>output.destroy(e));output.on('close',()=>input.destroy());return new Response(Readable.toWeb(input.pipe(output)),{status:response.status,statusText:response.statusText,headers:response.headers});},finish(phase='request_complete'){if(ended)return;if(terminal==='complete')phase='request_complete';if(terminal==='failed')phase='request_failed';mark(phase,{marks:{...marks}});ended=true;},stream(){
  let first=true,pending='',oversized=false;const decoder=new StringDecoder('utf8');
  return new Transform({transform(chunk,_encoding,done){
   if(first){first=false;mark('first_byte');}
   // Observe SSE frames without changing bytes, delaying delivery, or retaining content.
   pending+=decoder.write(chunk);let match;
   while((match=/\r?\n\r?\n/.exec(pending))){const frame=pending.slice(0,match.index);pending=pending.slice(match.index+match[0].length);
    if(!oversized){const type=/"type"\s*:\s*"(response\.[a-zA-Z_.]+)"/.exec(frame)?.[1];
     if(type==='response.completed'){terminal='complete';mark('upstream_complete');}else if(type==='response.failed'||type==='response.incomplete'){terminal='failed';mark('upstream_failed');}
     else if(type?.startsWith('response.reasoning')||/"type"\s*:\s*"thinking_delta"/.test(frame))mark('reasoning');
     else if(type==='response.output_text.delta'||/"type"\s*:\s*"text_delta"/.test(frame))mark('text_output');
     else if(type==='response.function_call_arguments.delta'||type==='response.custom_tool_call_input.delta')mark('tool_arguments');
    }oversized=false;
   }
   if(pending.length>1024*1024){pending=pending.slice(-3);oversized=true;}
   this.push(chunk);done();
  }});
 }};return trace;
}
// Bind each per-thread HTTP override to the actual result, including fork IDs.
function correlations(){
 const turns=new Map(),traces=new Map(),pending=new Map();
 return {input(m){if(!['thread/start','thread/resume','thread/fork'].includes(m.method))return;const key=crypto.randomUUID();if(m.params?.threadId)traces.set(key,m.params.threadId);if(m.id!==undefined)pending.set(m.id,key);return key;},output(m){
  if(!m.method&&pending.has(m.id)){const key=pending.get(m.id);pending.delete(m.id);if(m.result?.thread?.id)traces.set(key,m.result.thread.id);else if(m.error)traces.delete(key);}
  if(m.method==='turn/started'&&m.params?.threadId)turns.set(m.params.threadId,m.params.turn?.id);
  if(m.method==='turn/completed')turns.delete(m.params?.threadId);
 },resolve(id,headers){const threadId=traces.get(headers['x-codex-own-trace'])||id;return {threadId,turnId:turns.get(threadId)};}};
}
const monitors=new Map();
function monitor(root){root=path.resolve(root);if(monitors.has(root))return monitors.get(root);
 const threads=new Map();let file,bytes=0;
 const log=data=>{try{
  if(!file||bytes>4*1024*1024){const dir=path.join(root,'core','execution-timing');if(!fs.existsSync(dir))fs.mkdirSync(dir,{recursive:true,mode:0o700});const s=fs.lstatSync(dir);if(!s.isDirectory()||s.isSymbolicLink()||(process.platform!=='win32'&&(s.mode&0o077)))return;
   const previous=fs.readdirSync(dir).filter(n=>/^timing-\d+-[a-f0-9-]+\.jsonl$/.test(n)).sort();for(const name of previous.slice(0,-7)){const old=path.join(dir,name),st=fs.lstatSync(old);if(st.isFile()&&!st.isSymbolicLink()&&(process.platform==='win32'||(st.mode&0o077)===0))fs.unlinkSync(old);}
   file=path.join(dir,'timing-'+Date.now()+'-'+crypto.randomUUID()+'.jsonl');fs.writeFileSync(file,'',{flag:'wx',mode:0o600});bytes=0;
  }
  const line=JSON.stringify(data)+'\n';const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink())return;fs.appendFileSync(file,line);bytes+=Buffer.byteLength(line);
 }catch{}};
 const set=(threadId,phase,extra={})=>{if(!id(threadId))return;const prev=threads.get(threadId)||{};const now=Date.now();const state={...prev,...extra,threadId,phase,phaseStartedAt:prev.phase===phase?prev.phaseStartedAt:now,updatedAt:now};threads.set(threadId,state);if(threads.size>200)threads.delete(threads.keys().next().value);return state;};
 const api={read(threadId){const s=threads.get(threadId);return s?{...s,logFile:file}:null;},input(m){if(m.method==='turn/start'&&id(m.params?.threadId)){const now=Date.now();threads.delete(m.params.threadId);set(m.params.threadId,'runtime',{startedAt:now,active:true,turnId:null,tools:{}});log({time:now,threadId:m.params.threadId,phase:'turn_submitted'});}},model(p){
  const phases=['request_received','body_read','body_prepared','authorized','upstream_sent','upstream_headers','first_byte','reasoning','text_output','tool_arguments','upstream_complete','upstream_failed','request_complete','request_failed','request_cancelled'];if(!phases.includes(p?.phase)||!id(p.requestId))return;
  const clean={time:Date.now(),requestId:p.requestId,threadId:id(p.threadId),turnId:id(p.turnId),phase:p.phase,elapsedMs:Math.max(0,Number(p.elapsedMs)||0)};
  if(p.marks){clean.marks={};for(const k of phases)if(Number.isFinite(p.marks[k]))clean.marks[k]=p.marks[k];}if(Number.isInteger(p.status))clean.status=p.status;log(clean);
  const s=threads.get(clean.threadId);if(!s?.active||clean.turnId&&s.turnId&&clean.turnId!==s.turnId)return;
  const phase={request_received:'preparing',body_read:'preparing',body_prepared:'authorizing',authorized:'preparing',upstream_sent:'waiting_model',upstream_headers:'waiting_stream',first_byte:'receiving',reasoning:'reasoning',text_output:'text_output',tool_arguments:'tool_arguments',request_complete:'runtime',request_failed:'request_failed',request_cancelled:'runtime',upstream_complete:'receiving',upstream_failed:'request_failed'}[p.phase];
  // Parallel tools remain visible while the model handles another response.
  set(clean.threadId,Object.keys(s.tools||{}).length?'tool':phase,{requestId:p.requestId,modelPhase:phase,...(p.phase==='request_received'?{nativeSeen:{}}:{})});
 },output(m){const p=m.params||{},threadId=id(p.threadId||p.thread?.id);if(!threadId)return;
  let s=threads.get(threadId);if(m.method==='turn/started'){if(!s?.active){threads.delete(threadId);set(threadId,'runtime',{startedAt:Date.now(),active:true,tools:{}});}set(threadId,'runtime',{turnId:id(p.turn?.id)});}
  s=threads.get(threadId);if(!s?.active)return;
  if(m.method==='turn/completed'){const now=Date.now();set(threadId,p.turn?.status==='failed'?'failed':p.turn?.status==='interrupted'?'interrupted':'complete',{active:false,tools:{},completedAt:now});log({time:now,threadId,turnId:s.turnId,phase:'turn_complete',elapsedMs:now-s.startedAt});return;}
  if(m.id!==undefined&&/approval|requestUserInput|elicitation\/request/.test(m.method)){set(threadId,'attention');log({time:Date.now(),threadId,turnId:s.turnId,phase:'waiting_user'});return;}
  if(m.method==='serverRequest/resolved'){set(threadId,'runtime');return;}
  if(m.method==='item/started'||m.method==='item/completed'){
   const it=p.item||{},type=it.type;if(['commandExecution','mcpToolCall','dynamicToolCall','fileChange','imageView','webSearch'].includes(type)){
    const tools={...s.tools},key=id(it.id);if(!key)return;
    if(m.method==='item/started')tools[key]={type,startedAt:Date.now()};else delete tools[key];
    set(threadId,Object.keys(tools).length?'tool':'runtime',{tools});log({time:Date.now(),threadId,turnId:s.turnId,itemId:key,phase:m.method==='item/started'?'tool_started':'tool_completed',toolType:type,...(Number.isFinite(it.durationMs)?{elapsedMs:it.durationMs}:{})});
   }
  }
  const delivery=/item\/reasoning\//.test(m.method)?'runtime_reasoning_received':m.method==='item/agentMessage/delta'?'runtime_text_received':null;
  if(delivery&&!s.nativeSeen?.[delivery]){set(threadId,s.phase,{nativeSeen:{...s.nativeSeen,[delivery]:true}});log({time:Date.now(),threadId,turnId:s.turnId,requestId:s.requestId,phase:delivery});}
  if(/item\/reasoning\//.test(m.method)&&s.phase!=='reasoning'&&!Object.keys(s.tools||{}).length)set(threadId,'reasoning');
  if(m.method==='item/agentMessage/delta'&&s.phase!=='text_output'&&!Object.keys(s.tools||{}).length)set(threadId,'text_output');
 },disconnect(){for(const [t,s]of threads)if(s.active){set(t,'disconnected',{active:false});log({time:Date.now(),threadId:t,phase:'backend_disconnected'});}}};monitors.set(root,api);return api;
}
module.exports={METHOD,requestTrace,monitor,correlations};
