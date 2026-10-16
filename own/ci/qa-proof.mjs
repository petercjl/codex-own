import fs from'node:fs';import{execFileSync}from'node:child_process';import{snapshot}from'./artifact-inputs.mjs';
const [platform,output]=process.argv.slice(2),sourceRef=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),inputs=snapshot(process.cwd(),{ref:sourceRef});
const proof={schema:1,platform,sourceRef,run:process.env.GITHUB_RUN_ID,workflow:process.env.GITHUB_WORKFLOW_REF?.split('@')[0].replace('petercjl/codex-own/',''),nativeFingerprint:inputs.native,runtimeFingerprint:inputs.runtime};
fs.writeFileSync(output,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
