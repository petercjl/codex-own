import fs from 'node:fs';
import path from 'node:path';
import {writeCanonicalArchive} from '../lib/content-blocks.mjs';

// Candidate has already passed the platform's app verification. Preserve input.
export async function canonicalize(source,asset,file){
  const target=file.replace(/\.tar\.gz$/,'.tar');
  if(target===file)throw Error('Expected a fresh legacy archive input');
  const result=await writeCanonicalArchive(source,asset.entry,target);
  const {blocks,...transport}=result;
  // Keep the full compressed build artifact for CI recovery and old releases.
  // Runtime npm metadata contains only the canonical incremental transport.
  return {...asset,incremental:{entry:asset.entry,...transport,blocks}};
}
