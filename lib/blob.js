import fs from 'node:fs/promises';
import path from 'node:path';
import dns from 'node:dns/promises';
import net from 'node:net';
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
  const allowedTypes=new Set(['image/jpeg','image/png','image/webp','image/gif','image/avif']);
  if(!allowedTypes.has(String(file.type||'').toLowerCase()))throw new Error('商品画像はJPEG・PNG・WebP・GIF・AVIFを指定してください');
  const ext=path.extname(file.name||'')||'.jpg';
  const buf=Buffer.from(await file.arrayBuffer());
  const blob=await put(`manual/${safeName(storeId)}/${Date.now()}-${safeName(path.basename(file.name||`image${ext}`))}`,buf,{access:'private',addRandomSuffix:false,contentType:file.type||undefined});
  return {savedUrl:blob.url,viewerUrl:`/api/flyer?url=${encodeURIComponent(blob.url)}`};
}

function isPrivateAddress(address){
  if(net.isIPv4(address)){
    const [a,b]=address.split('.').map(Number);
    return a===10||a===127||a===0||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)||a>=224;
  }
  const value=address.toLowerCase();
  return value==='::1'||value==='::'||value.startsWith('fc')||value.startsWith('fd')||value.startsWith('fe8')||value.startsWith('fe9')||value.startsWith('fea')||value.startsWith('feb')||value.startsWith('ff')||value.startsWith('::ffff:127.')||value.startsWith('::ffff:10.')||value.startsWith('::ffff:192.168.');
}

async function validateRemoteImageUrl(value){
  let url;
  try{url=new URL(value);}catch{throw new Error('商品画像URLが正しくありません');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('商品画像URLはhttpまたはhttpsを指定してください');
  const host=url.hostname.toLowerCase();
  if(host==='localhost'||host.endsWith('.localhost'))throw new Error('この商品画像URLにはアクセスできません');
  const addresses=await dns.lookup(host,{all:true,verbatim:true}).catch(()=>[]);
  if(!addresses.length||addresses.some(x=>isPrivateAddress(x.address)))throw new Error('この商品画像URLにはアクセスできません');
  return url;
}

export async function persistManualImageFromUrl(storeId,value){
  if(!hasBlobStorage())throw new Error('Vercel Blobが設定されていないため画像を保存できません');
  let url=await validateRemoteImageUrl(value);let response;
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
  try{
    for(let redirects=0;redirects<=5;redirects++){
      response=await fetch(url,{redirect:'manual',signal:controller.signal,headers:{'User-Agent':'TokushimaBabyFlyer/3.0'}});
      if(response.status>=300&&response.status<400){
        const location=response.headers.get('location');
        if(!location||redirects===5)throw new Error('商品画像URLの転送回数が多すぎます');
        await response.body?.cancel().catch(()=>{});
        url=await validateRemoteImageUrl(new URL(location,url).href);continue;
      }
      break;
    }
    if(!response?.ok)throw new Error(`商品画像URLから取得できませんでした（HTTP ${response?.status||'error'}）`);
    const type=String(response.headers.get('content-type')||'').split(';')[0].toLowerCase();
    const allowedTypes=new Set(['image/jpeg','image/png','image/webp','image/gif','image/avif']);
    if(!allowedTypes.has(type))throw new Error('指定URLは対応画像（JPEG・PNG・WebP・GIF・AVIF）ではありません');
    const length=Number(response.headers.get('content-length')||0);
    if(length>8*1024*1024)throw new Error('商品画像は8MB以下にしてください');
    const chunks=[];let total=0;const reader=response.body?.getReader();
    if(!reader)throw new Error('商品画像URLの内容を読み取れませんでした');
    while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>8*1024*1024){await reader.cancel();throw new Error('商品画像は8MB以下にしてください');}chunks.push(Buffer.from(value));}
    const buf=Buffer.concat(chunks,total);
    const ext=({ 'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','image/gif':'.gif','image/avif':'.avif' })[type]||'.img';
    const blob=await put(`manual/${safeName(storeId)}/${Date.now()}-url-image${ext}`,buf,{access:'private',addRandomSuffix:false,contentType:type});
    return {savedUrl:blob.url,viewerUrl:`/api/flyer?url=${encodeURIComponent(blob.url)}`,sourceUrl:url.href};
  }catch(e){if(e?.name==='AbortError')throw new Error('商品画像URLの取得が15秒でタイムアウトしました');throw e;}finally{clearTimeout(timer);}
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
