'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {parse}=require('smol-toml');
const {fetch,EnvHttpProxyAgent}=require('undici');
const bridge=require('./subagent-bridge.cjs');
async function main(){
 const [core,cli,...args]=process.argv.slice(2);
 const config=parse(fs.readFileSync(path.join(core,'config.toml'),'utf8'));
 if(!bridge.selected(config))throw Error('API compatibility configuration changed');
 const provider=config.model_provider,dispatcher=new EnvHttpProxyAgent(),server=await bridge.startServer({upstream:config.model_providers[provider].base_url,fetch,dispatcher});
 const i=args.indexOf('app-server');if(i<0)throw Error('Expected owned app-server invocation');
 const backend=[...args.slice(0,i),'-c','model_providers.'+provider+'.base_url='+JSON.stringify(server.url),...args.slice(i)];
 const child=spawn(cli,backend,{env:{...process.env,CODEX_HOME:core},stdio:['pipe','pipe','inherit'],windowsHide:true});
 const input=bridge.rpcInput(server.url);process.stdin.pipe(input).pipe(child.stdin);child.stdout.pipe(process.stdout);
 let stopping=false;
 const close=async(code)=>{if(stopping)return;stopping=true;input.destroy();process.stdin.destroy();await server.close();await dispatcher.close();process.exit(code??1);};
 input.on('error',()=>{child.stdin.destroy();child.kill();});child.stdin.on('error',()=>input.destroy());
 child.on('error',()=>close(1));child.on('exit',code=>close(code));
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{child.stdin.end();child.kill();});
}
main().catch(()=>{process.stderr.write('codex-own API compatibility backend failed to start\n');process.exit(1);});
