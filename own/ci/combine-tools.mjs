import fs from'node:fs';import path from'node:path';
const root=process.argv[2],output=path.join(root,'runtime-input.json');
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(x=>x.isDirectory()?walk(path.join(dir,x.name)):[path.join(dir,x.name)]);}
const files=walk(root).filter(f=>path.basename(f)==='runtime-input.json'&&f!==output);let result;
for(const f of files){const m=JSON.parse(fs.readFileSync(f));if(!result)result={schema:m.schema,version:m.version,platforms:{}};if(result.version!==m.version)throw Error('Runtime candidate versions differ');for(const [p,a]of Object.entries(m.platforms)){if(result.platforms[p])throw Error('Duplicate runtime platform');result.platforms[p]=a;}}
if(!result||!['darwin-arm64','win32-x64'].every(p=>result.platforms[p]))throw Error('Both tool platform candidates required');fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
