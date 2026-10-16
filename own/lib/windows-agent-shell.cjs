'use strict';
const fs=require('node:fs'),path=require('node:path');
const {Transform}=require('node:stream');
const childProcess=require('node:child_process');
const {parse}=require('smol-toml');
const MARKER='codex-own-windows-shell-policy';
const HOOK=Symbol.for('codex-own.windows-agent-shell');

function discover({env=process.env,exists=f=>{try{return fs.statSync(f).isFile()}catch{return false}},probe=f=>childProcess.execFileSync(f,['--version'],{encoding:'utf8',timeout:5000,windowsHide:true}),platform=process.platform}={}){
 if(platform!=='win32')return {supported:false,preferred:null,powershell:null,fallbackReason:null};
 const p=path.win32,dirs=(Object.entries(env).find(([k])=>k.toUpperCase()==='PATH')?.[1]||'').split(';').map(s=>s.trim().replace(/^"(.*)"$/,'$1')).filter(Boolean);
 const roots=[env.ProgramFiles,env['ProgramFiles(x86)'],env.ProgramW6432].filter(Boolean).map(r=>p.join(r,'Git'));
 if(env.LOCALAPPDATA)roots.push(p.join(env.LOCALAPPDATA,'Programs','Git'));
 for(const dir of dirs){if(exists(p.join(dir,'git.exe'))||exists(p.join(dir,'git-bash.exe'))){roots.push(dir,p.dirname(dir));}}
 const candidates=[...new Set(roots.flatMap(r=>[p.join(r,'bin','bash.exe'),p.join(r,'usr','bin','bash.exe')]))];
 let bash=null,version=null,unusable=false;
 for(const file of candidates){if(!exists(file))continue;try{const output=String(probe(file));if(!/^GNU bash,/m.test(output)){unusable=true;continue;}bash=file;version=output.split(/\r?\n/)[0];break;}catch{unusable=true;}}
 const powershell=[...dirs.map(d=>p.join(d,'pwsh.exe')),p.join(env.SystemRoot||env.WINDIR||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe')].find(exists)||null;
 return {supported:true,preferred:bash?'gitBash':'powershell',bash,bashVersion:version,powershell,fallbackReason:bash?null:unusable?'GIT_BASH_UNUSABLE':'GIT_BASH_NOT_FOUND'};
}
function policy(selection){
 const fallback=selection.powershell?JSON.stringify(selection.powershell):'the available Windows PowerShell executable';
 const preferred=selection.bash?
  `The preferred task shell is Git Bash at ${JSON.stringify(selection.bash)}. For general command-line work (Git, file/text operations, Node, npm, Python and portable scripts), set exec_command.shell explicitly to this executable and write Bash syntax. Set login=false unless the task needs login initialization. Use the tool workdir for the working directory; use /c/... paths inside Bash commands when needed.`:
  `Git Bash is unavailable (${selection.fallbackReason}). Use PowerShell at ${fallback} and PowerShell syntax. Report the unavailable Git Bash preference when relevant; do not claim to be running Bash.`;
 return `<${MARKER} version="1">\nWindows task execution policy:\n${preferred}\nFor Windows-specific operations such as Registry, COM, Windows services or PowerShell cmdlets, explicitly set exec_command.shell to ${fallback} and use PowerShell syntax. Honor an explicit user request for another available shell. The environment_context shell describes the native Windows host; the integrated-terminal preference is independent from this task policy. Specify the chosen shell on each exec_command call, including calls composed through other tools. Do not mix Bash and PowerShell syntax in one command. Do not automatically replay a failed command in another shell. For substantial scripts or JSON, use UTF-8 files and pass file paths rather than fragile nested inline quoting. Preserve codex-own's inherited private Node/npm/Python environment.\n</${MARKER}>`;
}
function compose(existing,selection){
 const clean=(existing||'').replace(new RegExp(`(?:\\n\\n)?<${MARKER} version="1">[\\s\\S]*?<\\/${MARKER}>`,'g'),'');
 return [clean,policy(selection)].filter(Boolean).join('\n\n');
}
function readInstructions(core){
 const file=path.join(core,'config.toml');if(!fs.existsSync(file))return '';
 let config;try{config=parse(fs.readFileSync(file,'utf8'));}catch{throw Object.assign(Error('Invalid private TOML configuration; shell policy was not applied'),{code:'CONFIG_INVALID'});}
 if(config.developer_instructions!==undefined&&typeof config.developer_instructions!=='string')throw Object.assign(Error('developer_instructions must be a string'),{code:'CONFIG_INVALID'});
 return config.developer_instructions||'';
}
function request(message,selection,baseline=''){
 if(!selection.supported||!['thread/start','thread/resume','thread/fork'].includes(message?.method)||!message.params||typeof message.params!=='object'||Array.isArray(message.params))return message;
 const original=message.params.developerInstructions??message.params.config?.developer_instructions??baseline;
 if(typeof original!=='string')throw Object.assign(Error('Session developer instructions must be a string'),{code:'SHELL_POLICY_INVALID'});
 return {...message,params:{...message.params,developerInstructions:compose(original,selection)}};
}
function inputStream(selection,{baseline=()=>'',maxFrameBytes=64*1024*1024}={}){
 let pending=Buffer.alloc(0);
 return new Transform({transform(chunk,_encoding,done){
  try{pending=Buffer.concat([pending,chunk]);let end;
   while((end=pending.indexOf(10))>=0){const frame=pending.subarray(0,end),rest=pending.subarray(end+1);if(frame.length>maxFrameBytes)throw Object.assign(Error('Agent request exceeds shell-policy framing limit'),{code:'SHELL_POLICY_FRAME_TOO_LARGE'});let message;try{message=JSON.parse(frame.toString('utf8'));}catch{this.push(pending.subarray(0,end+1));pending=rest;continue;}
    const session=selection.supported&&['thread/start','thread/resume','thread/fork'].includes(message?.method)&&message.params&&typeof message.params==='object'&&!Array.isArray(message.params);
    if(!session)this.push(pending.subarray(0,end+1));else this.push(JSON.stringify(request(message,selection,baseline()))+'\n');pending=rest;
   }
   if(pending.length>maxFrameBytes)throw Object.assign(Error('Agent request exceeds shell-policy framing limit'),{code:'SHELL_POLICY_FRAME_TOO_LARGE'});done();
  }catch(error){done(error);}
 },flush(done){if(pending.length)this.push(pending);done();}});
}
function serverInvocation(file,args,cli){
 if(typeof file!=='string'||!Array.isArray(args)||path.resolve(file).toLowerCase()!==path.resolve(cli).toLowerCase())return false;
 const index=args.indexOf('app-server');if(index<0||['daemon','proxy','generate-ts','generate-json-schema','help'].includes(args[index+1]))return false;
 const inline=args.find(a=>typeof a==='string'&&a.startsWith('--listen='));if(inline&&inline!=='--listen=stdio://')return false;
 const listen=args.indexOf('--listen');return listen<0||args[listen+1]==='stdio://';
}
function install({cli,core,env=process.env,platform=process.platform,processApi=childProcess,selection=discover({env,platform})}={}){
 if(platform!=='win32')return selection;
 if(processApi[HOOK])return processApi[HOOK].selection;
 const original=processApi.spawn;
 processApi.spawn=function(file,args,options){
  const child=original.apply(this,arguments);if(!serverInvocation(file,args,cli)||!child.stdin)return child;
  const target=child.stdin,stream=inputStream(selection,{baseline:()=>readInstructions(core)});
  stream.on('error',error=>{child.emit('error',error);target.destroy();child.kill();});target.on('error',error=>stream.destroy(error));child.once('exit',()=>{stream.destroy();target.destroy();});stream.pipe(target);child.stdin=stream;return child;
 };
 processApi[HOOK]={selection,restore(){processApi.spawn=original;delete processApi[HOOK];}};
 return selection;
}
module.exports={discover,policy,compose,readInstructions,request,inputStream,serverInvocation,install,HOOK};
