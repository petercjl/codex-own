const [version,tag]=process.argv.slice(2);
for(let i=0;i<12;i++){const r=await fetch('https://registry.npmjs.org/@petercjl%2fcodex-own?check='+Date.now());if(r.ok){const p=await r.json();if(p.versions?.[version]&&p['dist-tags']?.[tag]===version){console.log(JSON.stringify({ok:true,version,tag}));process.exit(0);}}await new Promise(r=>setTimeout(r,5000));}
throw Error('Registry version/tag not confirmed; inspect before retrying publication');
