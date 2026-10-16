import fs from'node:fs';import{execFileSync}from'node:child_process';
const [run,output]=process.argv.slice(2);if(!/^\d+$/.test(run))throw Error('Numeric run required');
const jobs=JSON.parse(execFileSync('gh',['api',`repos/petercjl/codex-own/actions/runs/${run}/jobs?per_page=100`],{encoding:'utf8',maxBuffer:8*1048576})).jobs;
const duration=(a,b)=>b&&b!=='0001-01-01T00:00:00Z'?Math.max(0,(Date.parse(b)-Date.parse(a))/1000):null;
const report={schema:1,run,stages:jobs.map(j=>({name:j.name,conclusion:j.conclusion,seconds:duration(j.started_at,j.completed_at),steps:j.steps.map(s=>({name:s.name,conclusion:s.conclusion,seconds:duration(s.started_at,s.completed_at)}))}))};fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
