// Bind registry integrity to its public npm-hosted GitHub SLSA provenance.
// Registry TLS is the trust boundary; no account credentials or tokens are used.
export async function verifyPackageProvenance(pkg,source,{fetcher=url=>fetch(url,{signal:AbortSignal.timeout(30000)})}={}){
 const publisher=source?.publication||source,url=pkg.dist?.attestations?.url;
 if(!publisher||!/^[a-f0-9]{40}$/.test(publisher.ref||'')||!/^\d+$/.test(String(publisher.run||''))||publisher.workflow!=='.github/workflows/own-release.yml')throw Error('NPM_PROVENANCE_REQUIRED: publication identity missing');
 if(!url||new URL(url).origin!=='https://registry.npmjs.org'||!new URL(url).pathname.startsWith('/-/npm/v1/attestations/'))throw Error('NPM_PROVENANCE_REQUIRED: trusted registry attestation missing');
 const response=await fetcher(url);if(!response.ok)throw Error('NPM_PROVENANCE_REQUIRED: registry attestation unavailable');const attest=await response.json();
 const item=attest.attestations?.find(a=>a.predicateType==='https://slsa.dev/provenance/v1');if(!item?.bundle?.dsseEnvelope?.payload)throw Error('NPM_PROVENANCE_REQUIRED: SLSA v1 statement missing');
 const statement=JSON.parse(Buffer.from(item.bundle.dsseEnvelope.payload,'base64').toString('utf8')),sri=pkg.dist.integrity?.match(/^sha512-([A-Za-z0-9+/=]+)$/);
 if(!sri||Buffer.from(sri[1],'base64').length!==64||!statement.subject?.some(s=>s.name===`pkg:npm/%40petercjl/codex-own@${pkg.version}`&&s.digest?.sha512===Buffer.from(sri[1],'base64').toString('hex')))throw Error('NPM_PROVENANCE_MISMATCH: package subject/integrity differs');
 const workflow=statement.predicate?.buildDefinition?.externalParameters?.workflow,invocation=statement.predicate?.runDetails?.metadata?.invocationId;
 if(workflow?.repository!=='https://github.com/petercjl/codex-own'||workflow.path!==publisher.workflow||invocation!==`https://github.com/petercjl/codex-own/actions/runs/${publisher.run}/attempts/1`&&!new RegExp('^https://github.com/petercjl/codex-own/actions/runs/'+publisher.run+'/attempts/[1-9][0-9]*$').test(invocation||''))throw Error('NPM_PROVENANCE_MISMATCH: original publication run differs');
 const dependencies=statement.predicate?.buildDefinition?.resolvedDependencies;
 if(!dependencies?.some(d=>d.uri?.startsWith('git+https://github.com/petercjl/codex-own@')&&d.digest?.gitCommit===publisher.ref))throw Error('NPM_PROVENANCE_MISMATCH: publication source commit differs');
 return{ok:true,version:pkg.version,publicationRun:String(publisher.run),publicationRef:publisher.ref};
}
