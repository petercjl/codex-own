'use strict';
const {Transform}=require('node:stream');
const {constants}=require('node:buffer');
// A per-request memory guard, rather than an application conversation-size cap.
// JSON parsing and protocol adaptation need several simultaneous representations.
function maxRequestBytes({heapBytes=require('node:v8').getHeapStatistics().heap_size_limit,totalBytes=require('node:os').totalmem(),stringBytes=constants.MAX_STRING_LENGTH}={}){
 return Math.max(1,Math.floor(Math.min(heapBytes/8,totalBytes/16,stringBytes)));
}
function frames({adapt=value=>value,maxFrameBytes=maxRequestBytes(),code='API_INPUT_FRAME_TOO_LARGE',allowIncomplete=false}={}){
 let chunks=[],length=0;
 const clear=()=>{chunks=[];length=0;};
 return new Transform({transform(chunk,_encoding,done){
  try{
   let start=0;
   while(start<chunk.length){
    const end=chunk.indexOf(10,start),stop=end<0?chunk.length:end;
    const part=chunk.subarray(start,stop);length+=part.length;
    if(length>maxFrameBytes)throw Object.assign(Error('Request exceeds available local JSON memory budget'),{code});
    if(part.length)chunks.push(part);
    if(end<0)break;
    const raw=Buffer.concat(chunks,length);clear();let value;
    try{value=JSON.parse(raw.toString('utf8'));}catch{this.push(raw);this.push('\n');start=end+1;continue;}
    const next=adapt(value);
    if(next!==false){this.push(next===value?raw:Buffer.from(JSON.stringify(next)));this.push('\n');}
    start=end+1;
   }
   done();
  }catch(error){clear();done(error);}
 },flush(done){
  if(length&&!allowIncomplete)return done(Object.assign(Error('Incomplete app-server input frame'),{code:'API_INPUT_INCOMPLETE_FRAME'}));
  if(length)this.push(Buffer.concat(chunks,length));clear();done();
 }});
}
module.exports={maxRequestBytes,frames};
