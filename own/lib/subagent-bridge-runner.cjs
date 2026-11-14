'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {parse}=require('smol-toml');
const {fetch,EnvHttpProxyAgent}=require('undici');
const bridge=require('./subagent-bridge.cjs');
async function main(){
 const [core,cli,...args]=process.argv.slice(2);
 const config=parse(fs.readFileSync(path.join(core,'config.toml'),'utf8'));
 if(!bridge.selected(config))throw Error('API compatibility configuration changed');
 let bootstrap=null;
 if(process.env.OWN_MANAGED_BOOTSTRAP_FD!==undefined){
  const fd=Number(process.env.OWN_MANAGED_BOOTSTRAP_FD);if(!Number.isInteger(fd)||fd<3||fd>32)throw Error('Invalid protected bootstrap descriptor');
  const chunks=[];let length=0;for await(const chunk of fs.createReadStream(null,{fd,autoClose:true})){length+=chunk.length;if(length>1024*1024)throw Error('Protected bootstrap exceeds limit');chunks.push(chunk);}bootstrap=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 }
 const timing=require('./execution-timing.cjs'),correlation=timing.correlations();
 const output=require('./request-budget.cjs').frames({allowIncomplete:true,adapt:m=>{correlation.output(m);return m;}});output.pipe(process.stdout);
 const onTiming=params=>output.push(Buffer.from(JSON.stringify({method:timing.METHOD,params})+'\n')),requestContext=correlation.resolve,traceRequest=correlation.input;
 const provider=config.model_provider,dispatcher=new EnvHttpProxyAgent({headersTimeout:600000,bodyTimeout:600000}),server=provider==='codex_own_imported'?await require('./model-router.cjs').start({core,config,fetch,dispatcher,bootstrap,onTiming,requestContext}):await bridge.startServer({upstream:config.model_providers[provider].base_url,fetch,dispatcher,onTiming,requestContext,prepareBody:body=>require('./image-provider.cjs').apply(require('./company-tools-env.cjs').apply(body,core),core)});
 const i=args.indexOf('app-server');if(i<0)throw Error('Expected owned app-server invocation');
 const backend=[...args.slice(0,i),'-c','model_providers.'+provider+'.base_url='+JSON.stringify(server.url),...args.slice(i)];
 const env={...process.env,CODEX_HOME:core};delete env.OWN_MANAGED_BOOTSTRAP_FD;
 const child=spawn(cli,backend,{env,stdio:['pipe','pipe','inherit'],windowsHide:true});
 const input=bridge.rpcInput(server.url,{provider,traceRequest});process.stdin.pipe(input).pipe(child.stdin);child.stdout.pipe(output);
 let stopping=false;
 const close=async(code)=>{if(stopping)return;stopping=true;input.destroy();process.stdin.destroy();await server.close();await dispatcher.close();process.exit(code??1);};
 input.on('error',()=>{child.stdin.destroy();child.kill();});child.stdin.on('error',()=>input.destroy());
 child.on('error',()=>close(1));child.on('exit',code=>close(code));
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{child.stdin.end();child.kill();});
}
main().catch(()=>{process.stderr.write('codex-own API compatibility backend failed to start\n');process.exit(1);});
