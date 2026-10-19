'use strict';
const outputs=new Map([['function_call','function_call_output'],['custom_tool_call','custom_tool_call_output']]);
const isCall=item=>outputs.has(item?.type);
const isResult=item=>[...outputs.values()].includes(item?.type);
// Bailian converts consecutive Responses calls to separate assistant messages.
// Pair completed parallel history for that converter; execution stays parallel.
// Never invent results or alter persisted history, arguments or result bytes.
function history(body){
 if(!Array.isArray(body?.input))return body;
 const input=[];let changed=false;
 for(let i=0;i<body.input.length;){
  const start=i;
  if(!isCall(body.input[i])){input.push(body.input[i++]);continue;}
  while(i<body.input.length&&(isCall(body.input[i])||isResult(body.input[i])))i++;
  const block=body.input.slice(start,i),calls=block.filter(isCall),results=block.filter(isResult);
  const ids=new Set(calls.map(x=>x.call_id)),byId=new Map(results.map(x=>[x.call_id,x]));
  const complete=calls.length>1&&ids.size===calls.length&&results.length===calls.length&&byId.size===results.length&&calls.every(x=>typeof x.call_id==='string'&&byId.get(x.call_id)?.type===outputs.get(x.type));
  if(!complete){input.push(...block);continue;}
  const paired=calls.flatMap(x=>[x,byId.get(x.call_id)]);
  if(paired.some((x,n)=>x!==block[n]))changed=true;
  input.push(...paired);
 }
 return changed?{...body,input}:body;
}
module.exports={history};
