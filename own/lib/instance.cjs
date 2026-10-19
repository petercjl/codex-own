'use strict';
const fs=require('node:fs'),path=require('node:path');
// Identity is a bundled build decision, never inferred from the executable's
// spelling or inherited Agent environment variables.
function identity(resources){
 const file=path.join(resources,'own-development.json');
 if(!fs.existsSync(file))return {channel:'stable',name:'codex-own',identifier:'local.codex-own',scheme:'codex-own',automaticUpdates:true};
 const marker=JSON.parse(fs.readFileSync(file,'utf8'));
 if(marker.schema!==1||marker.channel!=='development'||marker.automaticUpdates!==false)throw Error('Invalid development identity');
 return {channel:'development',name:'codex-own 开发版',identifier:'local.codex-own.development',scheme:'codex-own-dev',automaticUpdates:false};
}
module.exports={identity};
