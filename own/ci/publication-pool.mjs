// Independent immutable payloads may upload concurrently. Drain in-flight work
// on error; never publish the mutable stable channel from this pool.
export async function mapLimited(items,limit,action){
  if(!Number.isInteger(limit)||limit<1||limit>4)throw Error('Publication concurrency must be 1–4');
  const results=new Array(items.length);let cursor=0,failure;
  async function worker(){
    while(!failure&&cursor<items.length){
      const index=cursor++;
      try{results[index]=await action(items[index],index);}
      catch(e){failure ||= e;}
    }
  }
  await Promise.allSettled(Array.from({length:Math.min(limit,items.length)},worker));
  if(failure)throw failure;
  return results;
}
export function npmAuthFailure(error){
  const text=[error?.stdout,error?.stderr,error?.message].filter(Boolean).join('\n');
  return text.match(/\b(EOTP|ENEEDAUTH|E401|E403)\b/)?.[1]||null;
}
