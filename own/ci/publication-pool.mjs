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

// npm has a per-package pending-publication quota. Bound submissions separately
// from HTTP concurrency, and expose each complete window before submitting more.
export async function mapPublicationWindows(items,action,settle,{window=20,concurrency=4}={}){
  if(!Number.isInteger(window)||window<1||window>20)throw Error('Publication window must be 1–20');
  const results=[];
  for(let offset=0;offset<items.length;offset+=window){
    results.push(...await mapLimited(items.slice(offset,offset+window),concurrency,action));
    await settle();
  }
  return results;
}
export function npmPendingFailure(error){
  const text=[error?.stdout,error?.stderr,error?.message].filter(Boolean).join('\n');
  if(!/\bE409\b/.test(text))return null;
  if(/Cannot publish over previously staged version/.test(text))return 'accepted';
  if(/Too many pending publishes for .*\(limit: \d+\).*Wait for existing publishes to finish/.test(text))return 'capacity';
  return null;
}
export async function submitPayload(publish,{sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now,timeoutMs=30*60*1000,report=()=>{}}={}){
  const deadline=now()+timeoutMs;
  for(;;){
    try{await publish();return;}
    catch(error){
      const auth=npmAuthFailure(error);
      if(auth)throw Object.assign(Error(`${auth}: restore npm Trusted Publishing; no OTP/token fallback`),{code:'NPM_PUBLISH_AUTH_FAILED'});
      const pending=npmPendingFailure(error);
      if(pending==='accepted'){report('Existing exact payload is pending npm processing');return;}
      if(pending!=='capacity')throw error;
      if(now()>=deadline)throw Object.assign(Error('NPM_PROCESSING_PENDING: npm pending-publication capacity did not become available'),{code:'NPM_PROCESSING_PENDING'});
      report('npm pending-publication quota reached; waiting before retrying this exact payload');
      await sleep(30000);
    }
  }
}
