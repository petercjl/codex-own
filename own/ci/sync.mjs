import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const run=(c,a)=>execFileSync(c,a,{encoding:'utf8'}).trim(),git=(...a)=>run('git',a),repo='petercjl/codex-own';
if(process.env.GITHUB_REPOSITORY!==repo)throw Error('Own repository only');
git('fetch','https://github.com/Haleclipse/CodexDesktop-Rebuild.git','master');const upstream=git('rev-parse','FETCH_HEAD'),base=git('rev-parse','HEAD');
let unchanged=false;try{git('merge-base','--is-ancestor',upstream,base);unchanged=true;}catch{}
const output=(k,v)=>fs.appendFileSync(process.env.GITHUB_OUTPUT,`${k}=${v}\n`);
if(unchanged){output('changed','false');process.exit(0);}
// A deterministic branch makes retries reuse the same merge request.
const branch='own-sync/'+upstream.slice(0,12)+'-'+base.slice(0,8);
git('config','user.name','github-actions[bot]');git('config','user.email','41898282+github-actions[bot]@users.noreply.github.com');git('checkout','-b',branch);
try{git('merge','--no-ff','--no-edit',upstream);}catch(e){git('merge','--abort');throw Error('UPSTREAM_CONFLICT: existing own version remains unchanged');}
const changes=git('diff','--name-only',base,'HEAD').split('\n');
if(changes.some(f=>f.startsWith('own/')||f.startsWith('resources/own/')||f.startsWith('.github/workflows/own-')))throw Error('OWN_OVERLAY_CHANGED: review required');
try{git('push','origin',`HEAD:refs/heads/${branch}`);}catch{const remote=git('ls-remote','origin',`refs/heads/${branch}`).split(/\s+/)[0];if(!remote)throw Error('Branch push failed');git('fetch','origin',branch);if(git('diff',remote,'HEAD','--stat'))throw Error('Existing sync branch differs');git('checkout','--detach',remote);}
const list=JSON.parse(run('gh',['pr','list','--repo',repo,'--head',branch,'--state','open','--json','number,url']));
let pr;if(list.length)pr=list[0];else{const body='Synchronize upstream Rebuild while preserving codex-own overlay. Application build, isolation and package lifecycle checks are required before merge. No model credentials are used in CI.';const url=run('gh',['pr','create','--repo',repo,'--base','own-main','--head',branch,'--title','Sync Rebuild '+upstream.slice(0,12),'--body',body]);pr={url,number:Number(url.split('/').at(-1))};}
output('changed','true');output('ref',git('rev-parse','HEAD'));output('upstream',upstream);output('base',base);output('pr',pr.number);console.log(JSON.stringify({pr,upstream,base}));
