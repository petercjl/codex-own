const {parse}=require('acorn');
function hasNativeArchiveDelete(source){
 const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'}),keys=new Set();let call=false;
 function walk(n){if(!n||typeof n!=='object')return;
  if(n.type==='Property')keys.add(n.key.name??n.key.value);
  if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&n.callee.property.name==='deleteArchivedConversation')call=true;
  for(const v of Object.values(n)){if(Array.isArray(v))for(const c of v)walk(c);else if(v&&typeof v==='object')walk(v);}
 }walk(ast);return call&&['archivedThread','showDeleteButton','onDelete'].every(k=>keys.has(k));
}
module.exports={hasNativeArchiveDelete};
