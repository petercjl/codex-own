// Download routes for the public codex-own package. Release identities and
// hashes keep their canonical npm URLs; only the transport address changes.
export const registrySources = Object.freeze([
  'https://registry.npmjs.org',
  'https://registry.npmmirror.com',
  'https://mirrors.cloud.tencent.com/npm',
]);
const redirectHosts = new Set(['registry.npmjs.org','registry.npmmirror.com','cdn.npmmirror.com','mirrors.cloud.tencent.com']);
function publicPackageURL(input,options){
  let url;try{url=new URL(input);}catch{return null;}
  const headers=new Headers(options.headers);
  if(url.origin!==registrySources[0]||url.username||url.password||url.search||url.hash
    ||!['GET','HEAD'].includes((options.method||'GET').toUpperCase())||options.body
    ||['authorization','proxy-authorization','cookie'].some(key=>headers.has(key)))return null;
  let pathname;try{pathname=decodeURIComponent(url.pathname);}catch{return null;}
  return /^\/@petercjl\/codex-own(?:\/|$)/.test(pathname)?url:null;
}
export function createRegistryFetch(fetcher,{sources=registrySources,headerTimeoutMs=3000}={}){
  let preferred=null;
  return async function registryFetch(input,options={}){
    const canonical=publicPackageURL(input,options);
    if(!canonical)return fetcher(input,options);
    const attempts=[];
    const ordered=preferred?[preferred,...sources.filter(source=>source!==preferred)]:sources;
    for(const source of ordered){
      options.signal?.throwIfAborted();
      let url=new URL(source+canonical.pathname),response;
      try{
        for(let redirects=0;;redirects++){
          const timeout=new AbortController();
          const timer=setTimeout(()=>timeout.abort(),headerTimeoutMs);
          const signal=options.signal?AbortSignal.any([options.signal,timeout.signal]):timeout.signal;
          try{response=await fetcher(url.href,{...options,redirect:'manual',signal});}
          finally{clearTimeout(timer);}
          if(![301,302,303,307,308].includes(response.status))break;
          const location=response.headers.get('location');
          await response.body?.cancel();
          if(!location||redirects>=3)throw Object.assign(Error('Invalid registry redirect'),{code:'REGISTRY_REDIRECT'});
          const next=new URL(location,url);
          if(next.protocol!=='https:'||next.username||next.password||next.port||!redirectHosts.has(next.hostname))
            throw Object.assign(Error('Untrusted registry redirect'),{code:'REGISTRY_REDIRECT'});
          url=next;
        }
        if(!response.ok){await response.body?.cancel();throw Object.assign(Error('Registry HTTP '+response.status),{code:'HTTP_'+response.status});}
        preferred=source;
        return response;
      }catch(error){
        options.signal?.throwIfAborted();
        attempts.push({source,code:error.cause?.code||error.code||error.name||'NETWORK_ERROR'});
      }
    }
    throw Object.assign(Error('All update sources are unavailable ('+attempts.map(item=>item.code).join(', ')+'). The current installation is unchanged.'),{code:'REGISTRY_NETWORK_UNAVAILABLE',attempts});
  };
}
