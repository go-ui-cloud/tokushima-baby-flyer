import fs from 'node:fs/promises';
import path from 'node:path';
import { put, list, del } from '@vercel/blob';
import { safeName } from './utils.js';

export function hasBlobStorage(){
  return Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
}

export async function persistFlyer(storeId, file, originalUrl){
  if(!hasBlobStorage()) return {savedUrl:null,viewerUrl:null,originalUrl};
  try{
    const buf=await fs.readFile(file);
    const filename=path.basename(file);
    const blob=await put(`flyers/${safeName(storeId)}/${Date.now()}-${filename}`,buf,{access:'private',addRandomSuffix:false});
    return {savedUrl:blob.url,viewerUrl:`/api/flyer?url=${encodeURIComponent(blob.url)}`,originalUrl};
  }catch(e){
    return {savedUrl:null,viewerUrl:null,originalUrl,saveError:e?.message||String(e)};
  }
}

export async function persistManualImage(storeId,file){
  if(!file||!file.size)return {savedUrl:null,viewerUrl:null};
  if(!hasBlobStorage())throw new Error('Vercel Blobが設定されていないため画像を保存できません');
  const ext=path.extname(file.name||'')||'.jpg';
  const buf=Buffer.from(await file.arrayBuffer());
  const blob=await put(`manual/${safeName(storeId)}/${Date.now()}-${safeName(path.basename(file.name||`image${ext}`))}`,buf,{access:'private',addRandomSuffix:false,contentType:file.type||undefined});
  return {savedUrl:blob.url,viewerUrl:`/api/flyer?url=${encodeURIComponent(blob.url)}`};
}

export async function deleteManualImage(url){
  if(url&&hasBlobStorage())await del(url);
}

// Manual refresh starts from a clean flyer cache. History rows remain in Neon,
// but old Blob images are intentionally removed so stale flyer captures are not reused.
export async function clearFlyerBlobs(){
  if(!hasBlobStorage()) return {deleted:0,enabled:false};
  let cursor; let deleted=0;
  do{
    const page=await list({prefix:'flyers/',cursor,limit:100});
    const urls=(page.blobs||[]).map(b=>b.url).filter(Boolean);
    if(urls.length){ await del(urls); deleted+=urls.length; }
    cursor=page.hasMore?page.cursor:undefined;
  }while(cursor);
  return {deleted,enabled:true};
}
