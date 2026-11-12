'use strict';
// Host registration only; all board behavior belongs to the Tuda package.
const fs=require('node:fs'),path=require('node:path');
const {resolveBundledNode}=require('./bundled-node.cjs');
const TOOLS=Object.freeze('status get_space get_board_library manage_board_library list_boards get_active_board get_board get_board_layout open_board fit_board_view focus_nodes move_image resize_image arrange_images duplicate_images trash_images restore_image list_assets read_asset export_assets open_tuda create_board rename_board trash_board list_trashed_boards restore_board import_board_images write_board_text move_board_nodes'.split(' '));
function registration(bundle,core){
 const file=path.join(bundle,'tuda-plugin.json');if(!fs.existsSync(file))return null;
 const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
 if(manifest.contract!==2||manifest.package!=='@petercjl/tuda'||manifest.profile!=='board-only'||manifest.connection!=='independent-existing'||Object.hasOwn(manifest,'desktop'))throw Error('Invalid bundled Tuda contract');
 if(['nativeContract','preparationContract','handoffContract','updateContract'].some(key=>manifest.contracts?.[key]!==1))throw Error('Bundled Tuda lifecycle contract mismatch');
 const pkg=JSON.parse(fs.readFileSync(path.join(bundle,'node_modules/@petercjl/tuda/package.json'),'utf8'));
 if(!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(manifest.version)||pkg.name!==manifest.package||pkg.version!==manifest.version)throw Error('Bundled Tuda version mismatch');
 for(const item of ['desktop/tuda-mcp.mjs','node_modules/@petercjl/tuda/dist/board-plugin.js'])fs.statSync(path.join(bundle,item));
 return {command:resolveBundledNode(bundle),args:[path.join(bundle,'desktop/tuda-mcp.mjs'),path.resolve(core)],enabled:true,startup_timeout_sec:120,tool_timeout_sec:240,enabled_tools:[...TOOLS]};
}
function argumentsFor(args,bundle,core){
 const config=registration(bundle,core);if(!config)return args;
 // CLI overrides are ephemeral: preserve the user's config.toml and other MCPs.
 const toml=v=>typeof v==='string'?JSON.stringify(v):Array.isArray(v)?'['+v.map(toml).join(',')+']':String(v);
 return [...args,...Object.entries(config).flatMap(([key,value])=>['-c',`mcp_servers.codex_own_tuda.${key}=${toml(value)}`])];
}
module.exports={TOOLS,registration,argumentsFor};
