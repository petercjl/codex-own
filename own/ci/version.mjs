import fs from 'node:fs';
const current=JSON.parse(fs.readFileSync('own/package.json')).version,kind=process.argv[2]||'patch';
let version=kind;
if(['patch','minor','major'].includes(kind)){let [a,b,c]=current.split('-')[0].split('.').map(Number);if(kind==='major'){a++;b=0;c=0;}else if(kind==='minor'){b++;c=0;}else c++;version=[a,b,c].join('.');}
if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))throw Error('Release must be patch, minor, major or exact semver');
console.log(version);
