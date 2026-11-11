'use strict';
// Client tool discovery belongs to the harness. Present its schema as a regular
// function to compatible providers, then restore native search calls on return.
function mergeTools(lists) {
 const result=[];
 for(const list of lists)for(const tool of list||[]){
  const previous=result.find(t=>t.type===tool.type&&t.name===tool.name);
  if(previous?.type==='namespace')previous.tools=mergeTools([previous.tools,tool.tools]);
  else if(!previous)result.push({...tool});
 }
 return result;
}
function history(body){
 if(!Array.isArray(body?.input))return body;
 const discovered=body.input.filter(i=>['tool_search_output','additional_tools'].includes(i.type));
 if(!body.tools?.some(t=>t.type==='tool_search')&&!discovered.length&&!body.input.some(i=>i.type==='tool_search_call'))return body;
 const tools=mergeTools([body.tools,...discovered.map(i=>i.tools)]).map(t=>{
  if(t.type!=='tool_search')return t;
  if(t.execution!=='client')throw Object.assign(Error('Only client tool search is supported'),{code:'TOOL_SEARCH_UNSUPPORTED'});
  return {type:'function',name:'tool_search',description:t.description,parameters:t.parameters,strict:false};
 });
 const input=body.input.filter(i=>i.type!=='additional_tools').map(i=>{
  if(i.type==='tool_search_call')return {type:'function_call',call_id:i.call_id,name:'tool_search',arguments:JSON.stringify(i.arguments)};
  if(i.type==='tool_search_output')return {type:'function_call_output',call_id:i.call_id,output:JSON.stringify(i.tools)};
  return i;
 });
 return {...body,tools,input};
}
function item(value){
 if(value?.type!=='function_call'||value.name!=='tool_search'||value.namespace)return value;
 let args;try{args=typeof value.arguments==='string'?JSON.parse(value.arguments||'{}'):value.arguments||{};}catch{throw Object.assign(Error('Invalid tool search arguments'),{code:'TOOL_SEARCH_ARGUMENTS_INVALID'});}
 return {type:'tool_search_call',id:value.id,call_id:value.call_id,execution:'client',status:value.status||'completed',arguments:args};
}
function response(value){return Array.isArray(value?.output)?{...value,output:value.output.map(item)}:value;}
function eventAdapter(){
 const searches=new Set();
 return event=>{
  if(event?.type==='response.output_item.added'&&event.item?.type==='function_call'&&event.item.name==='tool_search'&&!event.item.namespace){searches.add(event.item.id);return [{...event,item:{...item({...event.item,arguments:'{}'}),status:'in_progress'}}];}
  if(searches.has(event?.item_id)&&['response.function_call_arguments.delta','response.function_call_arguments.done'].includes(event.type))return [];
  if(event?.type==='response.output_item.done')return [{...event,item:item(event.item)}];
  if(['response.completed','response.incomplete'].includes(event?.type))return [{...event,response:response(event.response)}];
  return [event];
 };
}
module.exports={history,item,response,eventAdapter};
