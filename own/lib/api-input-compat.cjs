'use strict';
const fs=require('node:fs'),path=require('node:path'),childProcess=require('node:child_process');
const {Transform}=require('node:stream');
const HOOK=Symbol.for('codex-own.api-input-compat');
const METHODS=new Set(['turn/start','turn/steer']);
const DESKTOP_MESSAGES=new Set(['create_thread','send_message_to_thread','handoff_thread']);
function enabled(config){
 const provider=config?.model_provider;
 return config?.forced_login_method==='api'&&typeof provider==='string'&&provider!=='openai'&&config.model_providers?.[provider]?.wire_api==='responses';
}
function request(message,active){
 const p=message?.params,t=p?.toolOutput;
 if(!active||!METHODS.has(message?.method)||!p||!t||t.namespace!=='codex_app'||!DESKTOP_MESSAGES.has(t.name)||typeof t.output!=='string'||!t.output.trim()||t.callId!=null||t.call_id!=null||p.input!==undefined&&!Array.isArray(p.input))return message;
 const params={...p,input:[...(p.input||[]),{type:'text',text:t.output,text_elements:[]}]};
 delete params.toolOutput;
 return {...message,params};
}
function inputStream({active=()=>false,adapt=request,maxFrameBytes=64*1024*1024}={}){
 let pending=Buffer.alloc(0);
 return new Transform({
  transform(chunk,_encoding,done){
   try{
    pending=Buffer.concat([pending,chunk]);let end;
    while((end=pending.indexOf(10))>=0){
     if(end>maxFrameBytes)throw Object.assign(Error('API input frame exceeds limit'),{code:'API_INPUT_FRAME_TOO_LARGE'});
     const frame=pending.subarray(0,end),bytes=pending.subarray(0,end+1);pending=pending.subarray(end+1);
     let message;try{message=JSON.parse(frame.toString('utf8'));}catch{this.push(bytes);continue;}
     const next=adapt(message,active(message));
     this.push(next===message?bytes:Buffer.from(JSON.stringify(next)+'\n'));
    }
    if(pending.length>maxFrameBytes)throw Object.assign(Error('API input frame exceeds limit'),{code:'API_INPUT_FRAME_TOO_LARGE'});
    done();
   }catch(e){done(e);}
  },
  flush(done){if(pending.length){done(Object.assign(Error('Incomplete app-server input frame'),{code:'API_INPUT_INCOMPLETE_FRAME'}));return;}done();}
 });
}
function serverInvocation(file,args,cli){
 if(typeof file!=='string'||!Array.isArray(args)||path.resolve(file).toLowerCase()!==path.resolve(cli).toLowerCase())return false;
 const i=args.indexOf('app-server');if(i<0||['daemon','proxy','generate-ts','generate-json-schema','help'].includes(args[i+1]))return false;
 const inline=args.find(a=>typeof a==='string'&&a.startsWith('--listen='));
 const listen=args.indexOf('--listen');
 return (!inline||inline==='--listen=stdio://')&&(listen<0||args[listen+1]==='stdio://');
}
function install({cli,core,processApi=childProcess}={}){
 if(processApi[HOOK])return processApi[HOOK];
 const original=processApi.spawn;
 processApi.spawn=function(file,args,options){
  if(!serverInvocation(file,args,cli))return original.apply(this,arguments);
  const tools=require('./tool-env.cjs');
  const backendEnv=tools.environment(path.join(core,'..','runtimes'),options?.env||process.env);
  if(backendEnv)options={...options,env:backendEnv};
  const {parse}=require('smol-toml');
  const configPath=path.join(core,'config.toml');
  const baseline=fs.existsSync(configPath)?parse(fs.readFileSync(configPath,'utf8')):{};
  // This decision belongs to the spawned backend's provider, which is fixed
  // for its lifetime. A per-session override can only turn the adapter off.
  const baseActive=enabled(baseline);
  const invocation=baseActive?require('./subagent-bridge.cjs').invocation({cli:file,args,options,core,config:baseline}):null;
  const child=invocation?original.call(this,invocation.file,invocation.args,invocation.options):original.call(this,file,args,options);
  if(!baseActive||!child.stdin)return child;
  const active=message=>{
   const c=message?.params?.config;
   if(c&&c.model_provider!==undefined&&c.model_provider!==baseline.model_provider)return false;
   if(message?.params?.modelProvider!==undefined&&message.params.modelProvider!==baseline.model_provider)return false;
   return baseActive;
  };
  const shellHook=invocation&&processApi[Symbol.for('codex-own.windows-agent-shell')];
  const shell=shellHook?require('./windows-agent-shell.cjs'):null;
  const target=child.stdin,stream=inputStream({active,adapt:(message,on)=>{const next=request(message,on);return shell?shell.request(next,shellHook.selection,shell.readInstructions(core)):next;}});
  stream.on('error',error=>{child.emit('error',error);target.destroy();child.kill();});
  target.on('error',error=>stream.destroy(error));child.once('exit',()=>{stream.destroy();target.destroy();});
  stream.pipe(target);child.stdin=stream;return child;
 };
 return processApi[HOOK]={restore(){processApi.spawn=original;delete processApi[HOOK];}};
}
module.exports={enabled,request,inputStream,serverInvocation,install,HOOK};
