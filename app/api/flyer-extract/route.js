import { NextResponse } from 'next/server';
import { STORES } from '../../../lib/config.js';
import { isAdminRequest } from '../../../lib/admin-auth.js';
import { ocrImageBufferDetailed } from '../../../lib/ocr.js';
import { extractFlyerItems } from '../../../lib/flyer-upload.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

const AUTOMATIC_TYPES=new Set(['costco-online','uniqlo-online','akachan-online','nishimatsuya-online']);
const IMAGE_TYPES=new Set(['image/jpeg','image/png','image/webp']);

export async function POST(req){
  try{
    if(!isAdminRequest(req))return NextResponse.json({error:'管理者ログインが必要です'},{status:401});
    const form=await req.formData();
    const storeId=String(form.get('storeId')||'').trim();
    const image=form.get('image');
    const store=STORES.find(item=>item.id===storeId&&!AUTOMATIC_TYPES.has(item.type));
    if(!store)return NextResponse.json({error:'登録先店舗を選択してください'},{status:400});
    if(!image?.size)return NextResponse.json({error:'チラシ画像を選択してください'},{status:400});
    if(image.size>4*1024*1024)return NextResponse.json({error:'チラシ画像は4MB以下にしてください'},{status:400});
    if(!IMAGE_TYPES.has(String(image.type||'').toLowerCase()))return NextResponse.json({error:'JPEG・PNG・WebPの画像を選択してください'},{status:400});
    const detail=await ocrImageBufferDetailed(Buffer.from(await image.arrayBuffer()));
    const items=extractFlyerItems(detail);
    return NextResponse.json({ok:true,storeId,storeName:store.exactStoreName,items,recognizedLines:(detail.lines||[]).length,notice:items.length?'抽出結果を確認し、必要に応じて修正してください。':'商品を自動判定できませんでした。行を追加して登録できます。'},{headers:{'Cache-Control':'no-store'}});
  }catch(error){
    console.error('flyer-extract failed',error);
    return NextResponse.json({error:`チラシの読み取りに失敗しました: ${error?.message||String(error)}`},{status:500});
  }
}
