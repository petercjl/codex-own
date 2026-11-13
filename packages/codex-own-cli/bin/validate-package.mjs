import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'))),caps=JSON.parse(fs.readFileSync(path.join(root,'capabilities.json'))),skill=fs.readFileSync(path.join(root,'skills/codex-own-cli/SKILL.md'),'utf8');
if(pkg.name!==caps.package||pkg.version!==caps.version||!skill.includes('version `'+pkg.version+'`'))throw Error('Package/Skill version drift');
for(const item of pkg.files)fs.statSync(path.join(root,item));console.log(JSON.stringify({ok:true,package:pkg.name,version:pkg.version,canonicalSkill:true}));
