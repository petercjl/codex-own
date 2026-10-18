const {parse}=require('acorn');
const OLD='© OpenAI',NEW='© OpenAI · Cometix Space';
function copyrightPatches(source){
 const patches=[],ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
 function walk(n){if(!n||typeof n!=='object')return;
  if(n.type==='Property'&&(n.key.name??n.key.value)==='copyright'){
   if(n.value.type==='Literal'&&n.value.value===OLD)patches.push({start:n.value.start,end:n.value.end,replacement:JSON.stringify(NEW)});
   if(n.value.type==='TemplateLiteral'&&n.value.expressions.length===0&&n.value.quasis[0].value.cooked===OLD)patches.push({start:n.value.start,end:n.value.end,replacement:JSON.stringify(NEW)});
  }
  if(n.type==='TemplateElement'){
   const anchor='<div class="copyright">'+OLD+'</div>',i=n.value.raw.indexOf(anchor);
   if(i>=0){const start=n.start+i+'<div class="copyright">'.length;patches.push({start,end:start+OLD.length,replacement:NEW});}
  }
  for(const v of Object.values(n)){if(Array.isArray(v))for(const c of v)walk(c);else if(v&&typeof v==='object')walk(v);}
 }walk(ast);return patches.sort((a,b)=>b.start-a.start);
}
module.exports={copyrightPatches,NEW_COPYRIGHT:NEW};
