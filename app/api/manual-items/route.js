import { NextResponse } from 'next/server';
import { STORES } from '../../../lib/config.js';
import { addManualItem, deleteManualItem, getManualItems } from '../../../lib/db.js';
import { deleteManualImage, persistManualImage } from '../../../lib/blob.js';
import { isAdminRequest } from '../../../lib/admin-auth.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const CATEGORIES=['おむつ・おしりふき','粉ミルク・液体ミルク','離乳食・ベビーフード','おもちゃ','ベビーケア・その他','その他'];

export async function GET(){
  try{return NextResponse.json({items:await getManualItems()},{headers:{'Cache-Control':'no-store'}});}
  catch(e){return NextResponse.json({error:e.message},{status:500});}
}

export async function POST(req){
  try{
    if(!isAdminRequest(req))return NextResponse.json({error:'管理者ログインが必要です'},{status:401});
    const form=await req.formData();
    const storeId=String(form.get('storeId')||'').trim();
    const product=String(form.get('product')||'').trim();
    const price=String(form.get('price')||'').trim();
    const category=String(form.get('category')||'').trim();
    if(!STORES.some(x=>x.id===storeId&&x.type!=='costco-online'))return NextResponse.json({error:'登録対象店舗が正しくありません'},{status:400});
    if(!product||!price||!CATEGORIES.includes(category))return NextResponse.json({error:'商品名・価格・カテゴリは必須です'},{status:400});
    const startDate=String(form.get('startDate')||''),endDate=String(form.get('endDate')||'');
    if(startDate&&endDate&&endDate<startDate)return NextResponse.json({error:'広告終了日は広告開始日以降にしてください'},{status:400});
    const image=form.get('image');
    if(image?.size>8*1024*1024)return NextResponse.json({error:'商品画像は8MB以下にしてください'},{status:400});
    if(image?.size&&!String(image.type||'').startsWith('image/'))return NextResponse.json({error:'画像ファイルを選択してください'},{status:400});
    const saved=image?.size?await persistManualImage(storeId,image):{savedUrl:null,viewerUrl:null};
    const id=await addManualItem({storeId,product,price,category,startDate,endDate,memo:String(form.get('memo')||''),imageUrl:saved.viewerUrl,imageBlobUrl:saved.savedUrl});
    return NextResponse.json({ok:true,id},{headers:{'Cache-Control':'no-store'}});
  }catch(e){return NextResponse.json({error:e.message},{status:500});}
}

export async function DELETE(req){
  try{
    if(!isAdminRequest(req))return NextResponse.json({error:'管理者ログインが必要です'},{status:401});
    const {id}=await req.json();
    if(!/^\d+$/.test(String(id||'')))return NextResponse.json({error:'正しいidが必要です'},{status:400});
    const deleted=await deleteManualItem(String(id));
    if(deleted?.image_blob_url)await deleteManualImage(deleted.image_blob_url).catch(()=>{});
    return NextResponse.json({ok:true},{headers:{'Cache-Control':'no-store'}});
  }catch(e){return NextResponse.json({error:e.message},{status:500});}
}
