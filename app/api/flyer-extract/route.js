import { NextResponse } from 'next/server';
import { get } from '@vercel/blob';
import { STORES } from '../../../lib/config.js';
import { isAdminRequest } from '../../../lib/admin-auth.js';
import { attachFlyerCropPreviews, ocrUploadedDocument } from '../../../lib/ocr.js';
import { extractFlyerItems } from '../../../lib/flyer-upload.js';
import { safeName } from '../../../lib/utils.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

const MAX_SIZE=25*1024*1024;
const CONTENT_TYPES=new Set(['application/pdf','image/jpeg','image/png','image/webp']);
const AUTOMATIC_TYPES=new Set(['costco-online','uniqlo-online','akachan-online','nishimatsuya-online']);

function validBlobUrl(value,storeId){
  try{const url=new URL(value);return /\.blob\.vercel-storage\.com$/i.test(url.hostname)&&url.pathname.includes(`/manual/${safeName(storeId)}/`);}catch{return false;}
}
async function readLimited(stream){
  const reader=stream?.getReader?.();if(!reader)throw new Error('アップロードファイルを読み取れませんでした');
  const chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_SIZE){await reader.cancel();throw new Error('ファイルは25MB以下にしてください');}chunks.push(Buffer.from(value));}
  return Buffer.concat(chunks,size);
}

export async function POST(req){
  try{
    if(!isAdminRequest(req))return NextResponse.json({error:'管理者ログインが必要です'},{status:401});
    const body=await req.json();const storeId=String(body.storeId||'').trim();const blobUrl=String(body.blobUrl||'');
    const store=STORES.find(item=>item.id===storeId&&!AUTOMATIC_TYPES.has(item.type));
    if(!store||!validBlobUrl(blobUrl,storeId))return NextResponse.json({error:'登録先店舗またはアップロードファイルが正しくありません'},{status:400});
    const result=await get(blobUrl,{access:'private',useCache:false});
    if(!result||result.statusCode===404)return NextResponse.json({error:'アップロードファイルが見つかりません'},{status:404});
    const contentType=String(result.blob?.contentType||result.contentType||body.contentType||'').split(';')[0].toLowerCase();
    if(!CONTENT_TYPES.has(contentType))return NextResponse.json({error:'PDF・JPEG・PNG・WebPを選択してください'},{status:400});
    const buffer=await readLimited(result.stream??result.body);
    const detail=await ocrUploadedDocument(buffer,contentType);const items=extractFlyerItems(detail);await attachFlyerCropPreviews(buffer,contentType,items);
    return NextResponse.json({ok:true,storeId,storeName:store.exactStoreName,blobUrl,contentType,items,pageCount:detail.pageCount||1,totalPages:detail.totalPages||detail.pageCount||1,truncated:Boolean(detail.truncated),recognizedLines:(detail.lines||[]).length,warningCount:(detail.warnings||[]).length,notice:items.length?'抽出結果を確認し、必要に応じて修正してください。':'商品を自動判定できませんでした。行を追加して登録できます。'},{headers:{'Cache-Control':'no-store'}});
  }catch(error){
    console.error('flyer-extract failed',error);
    return NextResponse.json({error:`チラシの読み取りに失敗しました: ${error?.message||String(error)}`},{status:500});
  }
}
