import { NextResponse } from 'next/server';
import { STORES } from '../../../lib/config.js';
import { isAdminRequest } from '../../../lib/admin-auth.js';
import { persistManualImage } from '../../../lib/blob.js';
import { addManualItem } from '../../../lib/db.js';
import { validFlyerCategory } from '../../../lib/flyer-upload.js';

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
    if(!store)return NextResponse.json({error:'登録先店舗が正しくありません'},{status:400});
    if(!image?.size||image.size>4*1024*1024||!IMAGE_TYPES.has(String(image.type||'').toLowerCase()))return NextResponse.json({error:'4MB以下のJPEG・PNG・WebP画像が必要です'},{status:400});
    let items;
    try{items=JSON.parse(String(form.get('items')||'[]'));}catch{return NextResponse.json({error:'登録商品の形式が正しくありません'},{status:400});}
    if(!Array.isArray(items)||!items.length||items.length>40)return NextResponse.json({error:'登録する商品を1〜40件選択してください'},{status:400});
    const normalized=items.map(item=>({product:String(item.product||'').trim().slice(0,120),price:String(item.price||'').trim().slice(0,40),endDate:String(item.endDate||'').trim(),category:String(item.category||'').trim()}));
    if(normalized.some(item=>!item.product||!item.price||!validFlyerCategory(item.category)||!(/^$|^\d{4}-\d{2}-\d{2}$/.test(item.endDate))))return NextResponse.json({error:'商品名・価格・カテゴリを確認してください'},{status:400});
    const saved=await persistManualImage(storeId,image);
    const ids=[];
    for(const item of normalized){
      ids.push(await addManualItem({...item,storeId,sourceType:'チラシ',imageUrl:saved.viewerUrl,imageBlobUrl:saved.savedUrl,imageSourceUrl:null}));
    }
    return NextResponse.json({ok:true,count:ids.length,ids},{headers:{'Cache-Control':'no-store'}});
  }catch(error){
    console.error('flyer-items failed',error);
    return NextResponse.json({error:`一括登録に失敗しました: ${error?.message||String(error)}`},{status:500});
  }
}
