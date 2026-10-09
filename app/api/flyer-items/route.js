import { NextResponse } from 'next/server';
import { STORES } from '../../../lib/config.js';
import { isAdminRequest } from '../../../lib/admin-auth.js';
import { addManualItem } from '../../../lib/db.js';
import { validFlyerCategory } from '../../../lib/flyer-upload.js';
import { safeName } from '../../../lib/utils.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

const AUTOMATIC_TYPES=new Set(['costco-online','uniqlo-online','akachan-online','nishimatsuya-online']);
function validBlobUrl(value,storeId){try{const url=new URL(value);return /\.blob\.vercel-storage\.com$/i.test(url.hostname)&&url.pathname.includes(`/manual/${safeName(storeId)}/`);}catch{return false;}}

export async function POST(req){
  try{
    if(!isAdminRequest(req))return NextResponse.json({error:'管理者ログインが必要です'},{status:401});
    const body=await req.json();const storeId=String(body.storeId||'').trim();const blobUrl=String(body.blobUrl||'');const contentType=String(body.contentType||'');
    const store=STORES.find(item=>item.id===storeId&&!AUTOMATIC_TYPES.has(item.type));
    if(!store||!validBlobUrl(blobUrl,storeId))return NextResponse.json({error:'登録先店舗またはアップロードファイルが正しくありません'},{status:400});
    const items=body.items;
    if(!Array.isArray(items)||!items.length||items.length>40)return NextResponse.json({error:'登録する商品を1〜40件選択してください'},{status:400});
    const normalized=items.map(item=>({product:String(item.product||'').trim().slice(0,120),price:String(item.price||'').trim().slice(0,40),endDate:String(item.endDate||'').trim(),category:String(item.category||'').trim()}));
    if(normalized.some(item=>!item.product||!item.price||!validFlyerCategory(item.category)||!(/^$|^\d{4}-\d{2}-\d{2}$/.test(item.endDate))))return NextResponse.json({error:'商品名・価格・カテゴリを確認してください'},{status:400});
    const isImage=contentType.startsWith('image/');const viewerUrl=isImage?`/api/flyer?url=${encodeURIComponent(blobUrl)}`:null;const ids=[];
    for(const item of normalized)ids.push(await addManualItem({...item,storeId,sourceType:'チラシ',imageUrl:viewerUrl,imageBlobUrl:blobUrl,imageSourceUrl:null}));
    return NextResponse.json({ok:true,count:ids.length,ids},{headers:{'Cache-Control':'no-store'}});
  }catch(error){
    console.error('flyer-items failed',error);
    return NextResponse.json({error:`一括登録に失敗しました: ${error?.message||String(error)}`},{status:500});
  }
}
