// Retain the upstream resolver body verbatim; omit only its CLI entry call.
export function exposeVendorResolver(source){const code=source.replaceAll('\r\n','\n');if(!code.endsWith('main();\n'))throw Error('Upstream resolver contract changed');return code.slice(0,-8)+'module.exports={resolveCodexVendor};\n';}
