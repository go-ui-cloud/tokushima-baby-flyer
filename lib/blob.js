import fs from 'node:fs/promises';
import path from 'node:path';
import { put } from '@vercel/blob';
import { safeName } from './utils.js';

// New Vercel Blob connections use OIDC by default (BLOB_STORE_ID + short-lived
// VERCEL_OIDC_TOKEN). Older token-based stores are supported as a fallback.
export function hasBlobStorage(){
  return Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
}

export async function persistFlyer(storeId, file, originalUrl){
  if(!hasBlobStorage()) return {savedUrl:null,viewerUrl:null,originalUrl};
  try{
    const buf=await fs.readFile(file);
    const filename=path.basename(file);
    const blob=await put(
      `flyers/${safeName(storeId)}/${Date.now()}-${filename}`,
      buf,
      {
        // The user's current Blob store is Private. Vercel OIDC authenticates
        // this server-side write automatically when the store is connected.
        access:'private',
        addRandomSuffix:false,
      }
    );
    const viewerUrl=`/api/flyer?url=${encodeURIComponent(blob.url)}`;
    return {savedUrl:blob.url,viewerUrl,originalUrl};
  }catch(e){
    return {savedUrl:null,viewerUrl:null,originalUrl,saveError:e?.message||String(e)};
  }
}
