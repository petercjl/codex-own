'use strict';
// Local control of the desktop-owned backend. Never launches a second writer.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {Transform}=require('node:stream');
const brokers=new Map();
const activityStates=new Map();
function activity(root){const s=activityStates.get(path.resolve(root));return {ready:s?.ready===true,busy:!!s&&(s.active.size>0||s.pending.size>0),activeTasks:s?.active.size||0};}
function observeActivity(child,root){
 root=path.resolve(root);if(!child.stdin||!child.stdout)return;
 const state={ready:false,active:new Set(),pending:new Map(),refreshes:new Map()},old=activityStates.get(root);if(old?.child===child)return;
 state.child=child;activityStates.set(root,state);let initializeId;
 const timing=require('./execution-timing.cjs').monitor(root);
 const input=frames(m=>{
  timing.input(m);
  if(m.method==='initialize')initializeId=m.id;
  if(m.method==='initialized')state.ready=true;
  if(m.method==='turn/start'&&m.params?.threadId){state.active.add(m.params.threadId);if(m.id!==undefined)state.pending.set(m.id,m.params.threadId);}
 });
 const output=frames(m=>{
  if(m.method===require('./execution-timing.cjs').METHOD){timing.model(m.params);return false;}timing.output(m);
  if(state.refreshes.has(m.id)&&!m.method){const request=state.refreshes.get(m.id);state.refreshes.delete(m.id);clearTimeout(request.timer);if(m.error)request.reject(error('SKILL_REFRESH_FAILED'));else{request.resolve(m.result);output.push(Buffer.from(JSON.stringify({method:'skills/changed',params:{}})+'\n'));}return false;}
  if(m.id===initializeId&&!m.method&&!m.error&&m.result)state.ready=true;
  if(state.pending.has(m.id)&&!m.method){const id=state.pending.get(m.id);state.pending.delete(m.id);if(m.error)state.active.delete(id);}
  if(m.method==='turn/started'&&m.params?.threadId)state.active.add(m.params.threadId);
  if(m.method==='turn/completed'&&m.params?.threadId)state.active.delete(m.params.threadId);
 });
 const stdin=child.stdin,stdout=child.stdout;input.on('error',()=>{});output.on('error',()=>{});stdin.on('error',()=>{});stdout.on('error',()=>{});
 input.pipe(stdin);stdout.pipe(output);child.stdin=input;child.stdout=output;state.input=input;
 child.once('exit',()=>{timing.disconnect();state.ready=false;state.active.clear();state.pending.clear();for(const r of state.refreshes.values()){clearTimeout(r.timer);r.reject(error('BACKEND_DISCONNECTED'));}state.refreshes.clear();input.destroy();output.destroy();});
}
async function refreshSkills(root){
 const state=activityStates.get(path.resolve(root));if(!state?.ready)return {status:'deferred'};
 const id='company-skills-'+crypto.randomUUID();await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{state.refreshes.delete(id);reject(error('SKILL_REFRESH_TIMEOUT'));},10000);timer.unref();state.refreshes.set(id,{resolve,reject,timer});state.input.write(JSON.stringify({id,method:'skills/list',params:{forceReload:true}})+'\n');});return {status:'refreshed'};
}
const error=(code,message=code)=>Object.assign(Error(message),{code});
function privateDirectory(dir){
 if(!fs.existsSync(dir))fs.mkdirSync(dir,{mode:0o700});
 const s=fs.lstatSync(dir);if(!s.isDirectory()||s.isSymbolicLink()||(process.platform!=='win32'&&(s.mode&0o077)))throw error('UNSAFE_CONTROL_DIRECTORY');
}
function readPrivate(file){const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||(process.platform!=='win32'&&(s.mode&0o077)))throw error('UNSAFE_CONTROL_FILE');return JSON.parse(fs.readFileSync(file,'utf8'));}
function writeNew(file,data){fs.writeFileSync(file,JSON.stringify(data)+'\n',{flag:'wx',mode:0o600});}
function frames(consume){return require('./request-budget.cjs').frames({allowIncomplete:true,code:'CONTROL_FRAME_TOO_LARGE',adapt:message=>consume(message)===false?false:message});}
class Broker{
 constructor(root){
  this.root=root;this.dir=path.join(root,'control');privateDirectory(this.dir);this.operations=path.join(this.dir,'operations');privateDirectory(this.operations);
  this.token=crypto.randomBytes(32).toString('hex');this.epoch=crypto.randomUUID();this.events=[];this.sequence=0;this.pending=new Map();this.inflight=new Map();this.turns=new Map();this.attention=new Map();this.backend=null;this.ready=false;
 }
 async listen(){
  const descriptor=path.join(this.dir,'bridge.json');
  if(fs.existsSync(descriptor)){
   const old=readPrivate(descriptor);if(old.contract!==1||old.kind!=='codex-own-desktop-control'||!Number.isInteger(old.pid))throw error('UNMANAGED_CONTROL_ENDPOINT');
   let alive=true;try{process.kill(old.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}
   if(alive)throw error('CONTROL_ALREADY_RUNNING');
   fs.renameSync(descriptor,path.join(this.dir,'bridge-stale-'+crypto.randomUUID()+'.json'));
  }
  this.server=http.createServer(async(req,res)=>{
   const reply=(status,body)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));};
   if(req.headers.origin||req.headers.authorization!=='Bearer '+this.token){reply(403,{ok:false,error:{code:'CONTROL_UNAUTHORIZED'}});return;}
   if(req.method!=='POST'||req.url!=='/v1'){reply(404,{ok:false,error:{code:'CONTROL_NOT_FOUND'}});return;}
   try{let text='';for await(const b of req){text+=b;if(Buffer.byteLength(text)>1024*1024)throw error('CONTROL_REQUEST_TOO_LARGE');}const input=JSON.parse(text);const data=await this.dispatch(input.action,input.params||{});reply(200,{ok:true,data});}
   catch(e){reply(400,{ok:false,error:{code:e.code||'CONTROL_FAILED',message:String(e.message).slice(0,1000)}});}
  });
  await new Promise((r,j)=>{this.server.once('error',j);this.server.listen(0,'127.0.0.1',r);});this.server.unref();
  this.descriptor={contract:1,kind:'codex-own-desktop-control',pid:process.pid,port:this.server.address().port,token:this.token,epoch:this.epoch};writeNew(descriptor,this.descriptor);
  return this;
 }
 attach(child){
  if(!child.stdin||!child.stdout)return;
  if(this.backend&&this.backend!==child&&this.ready)throw error('CONTROL_MULTIPLE_BACKENDS');
  this.backend=child;this.ready=false;
  let initializeId;
  const input=frames(m=>{if(m.method==='initialize')initializeId=m.id;if(m.method==='initialized')this.ready=true;if(m.id!==undefined&&!m.method&&this.attention.has(String(m.id))){const a=this.attention.get(String(m.id));this.attention.delete(String(m.id));const previous=this.turns.get(a.threadId);this.turns.set(a.threadId,{status:'running',turnId:previous?.turnId});}});
  input.on('error',()=>{});child.stdin.on('error',e=>input.destroy(e));input.pipe(child.stdin);child.stdin=input;
  const output=frames(m=>{
   if(initializeId!==undefined&&m.id===initializeId&&!m.error)this.ready=true;
   const pending=this.pending.get(m.id);if(pending){this.pending.delete(m.id);clearTimeout(pending.timer);m.error?pending.reject(error('BACKEND_RPC_ERROR',JSON.stringify(m.error))):pending.resolve(m.result);return false;}
   if(m.method)this.observe(m);return true;
  });
  output.on('error',()=>{});child.stdout.pipe(output);child.stdout=output;
  child.once('exit',()=>{if(this.backend===child){this.ready=false;this.backend=null;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error('BACKEND_DISCONNECTED'));}this.pending.clear();}});
 }
 observe(m){
  const p=m.params||{},threadId=p.threadId||p.thread?.id;if(!threadId)return;
  const event={cursor:this.epoch+':'+(++this.sequence),time:new Date().toISOString(),threadId,method:m.method,requestId:m.id,params:p};this.events.push(event);if(this.events.length>4000)this.events.shift();
  if(m.method==='turn/started')this.turns.set(threadId,{status:'running',turnId:p.turn?.id});
  if(m.method==='turn/completed')this.turns.set(threadId,{status:p.turn?.status||'unknown',turnId:p.turn?.id,error:p.turn?.error||null});
  if(m.id!==undefined&&/approval|requestUserInput|elicitation\/request/.test(m.method)){const request={threadId,requestId:m.id,method:m.method,params:p};this.attention.set(String(m.id),request);this.turns.set(threadId,{status:'needs_attention',turnId:p.turnId,attention:request});}
  if(m.method==='serverRequest/resolved'){this.attention.delete(String(p.requestId));const previous=this.turns.get(threadId);if(previous?.status==='needs_attention')this.turns.set(threadId,{status:'running',turnId:previous.turnId});}
 }
 rpc(method,params){
  if(!this.ready||!this.backend)throw error('DESKTOP_BACKEND_NOT_READY');
  const id='codex-own-control:'+crypto.randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(error('BACKEND_OUTCOME_UNKNOWN','Query status before retrying the operation'));},30000);this.pending.set(id,{resolve,reject,timer});this.backend.stdin.write(JSON.stringify({id,method,params})+'\n');});
 }
 async once(action,p,run){
  if(typeof p.operationId!=='string'||!/^[-a-zA-Z0-9]{8,100}$/.test(p.operationId))throw error('OPERATION_ID_REQUIRED');
  const file=path.join(this.operations,p.operationId+'.json'),hash=crypto.createHash('sha256').update(JSON.stringify({action,p})).digest('hex');
  if(this.inflight.has(p.operationId)){const active=this.inflight.get(p.operationId);if(active.hash!==hash)throw error('OPERATION_ID_CONFLICT');return active.promise;}
  if(fs.existsSync(file)){const saved=readPrivate(file);if(saved.hash!==hash)throw error('OPERATION_ID_CONFLICT');if(saved.status==='completed')return saved.result;throw error('OPERATION_OUTCOME_UNKNOWN','Inspect chat status/events before issuing a new operation');}
  writeNew(file,{contract:1,hash,status:'submitted',action});
  const promise=(async()=>{const result=await run();const tmp=file+'.'+crypto.randomUUID();writeNew(tmp,{contract:1,hash,status:'completed',action,result});fs.renameSync(tmp,file);return result;})();this.inflight.set(p.operationId,{hash,promise});
  try{return await promise;}finally{this.inflight.delete(p.operationId);}
 }
 permissionParams(){
  const file=path.join(this.root,'core','.codex-global-state.json');
  if(!fs.existsSync(file))return {};
  const state=JSON.parse(fs.readFileSync(file,'utf8'));
  const selections=Object.entries(state).filter(([key])=>key.startsWith('electron-owner-atoms:')).map(([,atoms])=>atoms?.['permission-selection-by-host-id:local']).filter(Boolean);
  if(!selections.length)return {};
  if(selections.some(s=>JSON.stringify(s)!==JSON.stringify(selections[0])))throw error('PERMISSION_SELECTION_AMBIGUOUS');
  const selection=selections[0];
  if(selection.kind==='server-default'||selection.kind==='custom')return {};
  if(selection.kind==='profile'&&typeof selection.profileId==='string'&&selection.profileId)return {permissions:selection.profileId};
  const modes={
   'full-access':{permissions:':danger-full-access',approvalPolicy:'never',approvalsReviewer:'user'},
   'read-only':{permissions:':read-only',approvalPolicy:'on-request',approvalsReviewer:'user'},
   auto:{permissions:':workspace',approvalPolicy:'on-request',approvalsReviewer:'user'},
   'guardian-approvals':{permissions:':workspace',approvalPolicy:'on-request',approvalsReviewer:'guardian_subagent'},
   granular:{permissions:':workspace',approvalPolicy:{granular:{sandbox_approval:false,rules:false,skill_approval:false,request_permissions:true,mcp_elicitations:true}},approvalsReviewer:'user'}
  };
  if(selection.kind!=='agent-mode'||!Object.hasOwn(modes,selection.agentMode))throw error('PERMISSION_SELECTION_UNSUPPORTED');
  return modes[selection.agentMode];
 }
 async dispatch(action,p){
  if(['company.identity','company.handoff'].includes(action))return require('./company-session.cjs').invoke(this.root,action,p);
  if(action==='doctor')return {contract:1,desktopPid:process.pid,backendAttached:!!this.backend,ready:this.ready,epoch:this.epoch,transport:'desktop-owned-app-server',root:this.root};
  if(action==='skills.list'){
   if(p.forceReload!==undefined&&typeof p.forceReload!=='boolean'||p.cwds!==undefined&&(!Array.isArray(p.cwds)||p.cwds.length>32||p.cwds.some(c=>typeof c!=='string'||!path.isAbsolute(c))))throw error('INVALID_SKILLS_QUERY');
   return this.rpc('skills/list',{cwds:p.cwds||[],forceReload:p.forceReload===true});
  }
  if(action==='operations.read'){if(!/^[-a-zA-Z0-9]{8,100}$/.test(p.operationId))throw error('INVALID_OPERATION_ID');return readPrivate(path.join(this.operations,p.operationId+'.json'));}
  if(action==='chat.list')return this.rpc('thread/list',{limit:Math.min(100,p.limit||20),cursor:p.cursor||null});
  if(action==='chat.create')return this.once(action,p,async()=>{
   const config=require('smol-toml').parse(fs.readFileSync(path.join(this.root,'core','config.toml'),'utf8'));
   if(typeof p.cwd!=='string'||!path.isAbsolute(p.cwd)||!fs.statSync(p.cwd).isDirectory())throw error('WORKSPACE_REQUIRED');
   const result=await this.rpc('thread/start',{cwd:p.cwd,model:p.model||config.model,modelProvider:config.model_provider,...this.permissionParams()});
   if(p.title)await this.rpc('thread/name/set',{threadId:result.thread.id,name:p.title});
   return result;
  });
  if(!['chat.send','chat.read','chat.status','chat.result','chat.events','chat.interrupt','chat.respond','chat.resume'].includes(action))throw error('CONTROL_ACTION_UNSUPPORTED');
  if(typeof p.threadId!=='string'||!/^[-a-zA-Z0-9]{10,100}$/.test(p.threadId))throw error('THREAD_ID_REQUIRED');
  if(action==='chat.events'){
   let since=0;if(p.after){const split=p.after.lastIndexOf(':');if(p.after.slice(0,split)!==this.epoch)throw error('EVENT_CURSOR_EXPIRED');since=Number(p.after.slice(split+1));if(!Number.isSafeInteger(since)||since<0||since>this.sequence)throw error('INVALID_EVENT_CURSOR');if(this.events.length&&since<this.sequence-this.events.length)throw error('EVENT_CURSOR_EXPIRED');}
   const selected=this.events.filter(e=>e.threadId===p.threadId&&Number(e.cursor.slice(e.cursor.lastIndexOf(':')+1))>since).slice(0,100);
   return {events:selected,cursor:selected.at(-1)?.cursor||this.epoch+':'+this.sequence,epoch:this.epoch};
  }
  if(action==='chat.resume')return this.rpc('thread/resume',{threadId:p.threadId,...this.permissionParams()});
  if(action==='chat.respond')return this.once(action,p,async()=>{
   const attention=this.attention.get(String(p.requestId));if(!attention||attention.threadId!==p.threadId)throw error('REQUEST_NOT_PENDING');
   if(attention.method!=='mcpServer/elicitation/request'||attention.params._meta?.codex_approval_kind!=='mcp_tool_call')throw error('RESPONSE_KIND_UNSUPPORTED','Resolve this request in the desktop');
   if(p.confirmed!==true||!['accept','decline','cancel'].includes(p.decision))throw error('EXPLICIT_RESPONSE_REQUIRED');
   this.backend.stdin.write(JSON.stringify({id:attention.requestId,result:{action:p.decision,content:{}}})+'\n');
   return {threadId:p.threadId,requestId:attention.requestId,decision:p.decision,persistence:'once',submitted:true};
  });
  if(action==='chat.send')return this.once(action,p,async()=>{
   if(typeof p.text!=='string'||!p.text.trim()||p.text.length>500000)throw error('MESSAGE_REQUIRED');
   const current=this.turns.get(p.threadId);if(current&&['running','needs_attention'].includes(current.status))throw error('CHAT_BUSY');
   return this.rpc('turn/start',{threadId:p.threadId,input:[{type:'text',text:p.text,text_elements:[]}],...this.permissionParams()});
  });
  if(action==='chat.interrupt'){const t=this.turns.get(p.threadId);if(!t?.turnId)throw error('NO_ACTIVE_TURN');return this.rpc('turn/interrupt',{threadId:p.threadId,turnId:t.turnId});}
  const result=await this.rpc('thread/read',{threadId:p.threadId,includeTurns:true});
  if(action==='chat.read')return result;
  const thread=result.thread,turn=thread.turns?.at(-1),observed=this.turns.get(p.threadId),lastTurnId=turn?.id;
  const status=observed&&(!lastTurnId||!observed.turnId||observed.turnId===lastTurnId)?observed.status:turn?.status||'idle';
  const normalized=status==='inProgress'?'running':status;
  const base={threadId:p.threadId,status:normalized,turnId:lastTurnId||observed?.turnId||null,error:turn?.error||observed?.error||null,...(normalized==='needs_attention'?{attention:observed?.attention}:{} )};
  if(action==='chat.status')return base;
  return {...base,complete:['completed','failed','interrupted'].includes(normalized),messages:(turn?.items||[]).filter(i=>i.type==='agentMessage').map(i=>({id:i.id,text:i.text,phase:i.phase})),items:turn?.items||[]};
 }
 async close(){if(this.server)await new Promise(r=>this.server.close(r));const file=path.join(this.dir,'bridge.json');if(fs.existsSync(file)&&readPrivate(file).token===this.token)fs.unlinkSync(file);brokers.delete(this.root);}
}
function start(root){root=path.resolve(root);if(brokers.has(root))return brokers.get(root);const b=new Broker(root);brokers.set(root,b);b.listening=b.listen().catch(e=>{brokers.delete(root);throw e;});b.listening.catch(()=>{});return b;}
function attach(child,core){const root=path.resolve(core,'..');observeActivity(child,root);brokers.get(root)?.attach(child);return child;}
async function request(root,action,params={}){
 const descriptor=readPrivate(path.join(root,'control','bridge.json'));
 if(descriptor.contract!==1||descriptor.kind!=='codex-own-desktop-control'||!Number.isInteger(descriptor.port)||descriptor.port<1||descriptor.port>65535||! /^[a-f0-9]{64}$/.test(descriptor.token||''))throw error('UNSAFE_CONTROL_ENDPOINT');
 const response=await fetch('http://127.0.0.1:'+descriptor.port+'/v1',{method:'POST',headers:{authorization:'Bearer '+descriptor.token,'content-type':'application/json'},body:JSON.stringify({action,params}),signal:AbortSignal.timeout(20000),redirect:'error'});
 const value=await response.json();if(!response.ok||value.ok!==true)throw error(value.error?.code||'CONTROL_FAILED');return value.data;
}
module.exports={Broker,start,attach,frames,activity,observeActivity,request,refreshSkills};
