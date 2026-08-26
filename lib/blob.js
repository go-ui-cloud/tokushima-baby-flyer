import fs from 'node:fs/promises';
import { put } from '@vercel/blob';
import path from 'node:path';
import { safeName } from './utils.js';

export async function persistFlyer(storeId, file, originalUrl){
  if(!process.env.BLOB_READ_WRITE_TOKEN) return {savedUrl:null,originalUrl};
  try{
    const buf=await fs.readFile(file);
    const filename=path.basename(file);
    const blob=await put(`flyers/${safeName(storeId)}/${Date.now()}-${filename}`,buf,{access:'public'});
    return {savedUrl:blob.url,originalUrl};
  }catch(e){
    return {savedUrl:null,originalUrl,saveError:e.message};
  }
}
