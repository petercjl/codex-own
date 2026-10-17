#!/usr/bin/env node
// Check before importing modules that require supported Node.
if(Number(process.versions.node.split('.')[0])<22){
 console.error(JSON.stringify({ok:false,code:'NODE_VERSION_UNSUPPORTED',message:'codex-own 需要 Node.js 22 或以上，请核对入口实际使用的 Node。',nodeVersion:process.version,executable:process.execPath}));process.exitCode=1;
}else await import('../lib/cli.mjs');
