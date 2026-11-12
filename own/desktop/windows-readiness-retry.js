// Readiness is read-only. During a backend restart its host identity can lag
// behind the UI; keep the query pending while that specific state settles.
async function __codexOwnWindowsReadiness(request) {
 const delays=[0,250,500,1000,2000,4000,5000];
 for(let attempt=0;attempt<delays.length;attempt++){
  if(delays[attempt])await new Promise(resolve=>setTimeout(resolve,delays[attempt]));
  try{return await request();}
  catch(error){
   if(!String(error?.message??error).includes('Hosted AppServerManager identity is not ready')||attempt===delays.length-1)throw error;
  }
 }
}
