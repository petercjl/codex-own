'use strict';
const {Transform}=require('node:stream');
// Recover only a single-field, JSON-encoded transport envelope. Patch content
// is never evaluated, unescaped heuristically, or rewritten.
function patchInput(input){
 if(typeof input!=='string')return input;
 const original=input;let value=input;
 for(let depth=0;depth<4;depth++){
  if(value.startsWith('*** Begin Patch\n')||value.startsWith('*** Begin Patch\r\n'))return value.trimEnd().endsWith('*** End Patch')?value:original;
  let envelope;try{envelope=JSON.parse(value);}catch{return original;}
  if(!envelope||Array.isArray(envelope)||typeof envelope!=='object')return original;
  const keys=Object.keys(envelope);if(keys.length!==1||!['data','input','patch'].includes(keys[0])||typeof envelope[keys[0]]!=='string')return original;
  value=envelope[keys[0]];
 }
 return original;
}
function item(value){
 if(value?.type!=='custom_tool_call'||value.name!=='apply_patch')return value;
 const input=patchInput(value.input);return input===value.input?value:{...value,input};
}
function response(value){
 if(!Array.isArray(value?.output))return value;
 const output=value.output.map(item);return output.some((v,i)=>v!==value.output[i])?{...value,output}:value;
}
function history(body){
 if(!Array.isArray(body?.input))return body;
 const input=body.input.map(item);return input.some((v,i)=>v!==body.input[i])?{...body,input}:body;
}
function eventAdapter(){
 const calls=new Map();
 function finish(state,input){
  if(state.emitted)return [];
  const raw=typeof input==='string'?input:state.input,normalized=patchInput(raw);state.emitted=true;state.normalized=normalized;
  return normalized?[{type:'response.custom_tool_call_input.delta',item_id:state.id,output_index:state.index,delta:normalized}]:[];
 }
 return event=>{
  const type=event?.type;
  if(type==='response.output_item.added'&&event.item?.type==='custom_tool_call'&&event.item.name==='apply_patch'){
   const value=event.item,state={id:value.id,index:event.output_index,input:value.input||'',emitted:false};calls.set(value.id,state);
   return [{...event,item:{...value,input:''}}];
  }
  const state=calls.get(event?.item_id||event?.item?.id);
  if(state&&type==='response.custom_tool_call_input.delta'){state.input+=event.delta||'';if(Buffer.byteLength(state.input)>64*1024*1024)throw Error('Patch compatibility input exceeds limit');return [];}
  if(state&&type==='response.custom_tool_call_input.done')return [...finish(state,event.input),{...event,input:state.normalized}];
  if(state&&type==='response.output_item.done'){
   const events=finish(state,event.item.input);return [...events,{...event,item:{...event.item,input:state.normalized}}];
  }
  if(type==='response.completed')return [{...event,response:response(event.response)}];
  return [event];
 };
}
function eventStream({maxEventBytes=64*1024*1024}={}){
 const adapt=eventAdapter();let pending=Buffer.alloc(0);
 return new Transform({transform(chunk,_encoding,done){
  try{
   pending=Buffer.concat([pending,chunk]);let match;
   while((match=/\r?\n\r?\n/.exec(pending.toString('latin1')))){
    const end=match.index+match[0].length;if(end>maxEventBytes)throw Error('Patch compatibility event exceeds limit');
    const bytes=pending.subarray(0,end);pending=pending.subarray(end);
    const text=bytes.toString('utf8'),data=text.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).replace(/^ /,'')).join('\n');
    let value;try{value=JSON.parse(data);}catch{this.push(bytes);continue;}
    const events=adapt(value);
    if(events.length===1&&events[0]===value)this.push(bytes);
    else for(const event of events)this.push(Buffer.from('event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n'));
   }
   if(pending.length>maxEventBytes)throw Error('Patch compatibility event exceeds limit');done();
  }catch(e){done(e);}
 },flush(done){if(pending.length){done(Error('Incomplete API event frame'));return;}done();}});
}
module.exports={patchInput,item,response,history,eventAdapter,eventStream};
