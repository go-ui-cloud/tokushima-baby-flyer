import { NextResponse } from 'next/server';
import { STORES } from '../../../lib/config.js';
import { addManualItem, deleteManualItem, getManualItems } from '../../../lib/db.js';
import { deleteManualImage, persistManualImage, persistManualImageFromUrl } from '../../../lib/blob.js';
import { isAdminRequest } from '../../../lib/admin-auth.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const CATEGORIES=['おむつ・おしりふき','粉ミルク・液体ミルク','離乳食・ベビーフード','おもちゃ','ベビーケア・その他','その他'];
const SOURCE_TYPES=['チラシ','アプリ','その他'];

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
    const sourceType=String(form.get('sourceType')||'').trim();
    if(!STORES.some(x=>x.id===storeId&&x.type!=='costco-online'))return NextResponse.json({error:'登録対象店舗が正しくありません'},{status:400});
    if(!product||!price||!CATEGORIES.includes(category)||!SOURCE_TYPES.includes(sourceType))return NextResponse.json({error:'商品名・価格・カテゴリ・情報元は必須です'},{status:400});
    const startDate=String(form.get('startDate')||''),endDate=String(form.get('endDate')||'');
    if(startDate&&endDate&&endDate<startDate)return NextResponse.json({error:'広告終了日は広告開始日以降にしてください'},{status:400});
    const image=form.get('image');
    const imageUrl=String(form.get('imageUrl')||'').trim();
    if(imageUrl.length>2000)return NextResponse.json({error:'商品画像URLが長すぎます'},{status:400});
    if(image?.size&&imageUrl)return NextResponse.json({error:'商品画像はファイルまたはURLのどちらか一方を指定してください'},{status:400});
    if(image?.size>8*1024*1024)return NextResponse.json({error:'商品画像は8MB以下にしてください'},{status:400});
    if(image?.size&&!['image/jpeg','image/png','image/webp','image/gif','image/avif'].includes(String(image.type||'').toLowerCase()))return NextResponse.json({error:'商品画像はJPEG・PNG・WebP・GIF・AVIFを選択してください'},{status:400});
    const saved=image?.size?await persistManualImage(storeId,image):imageUrl?await persistManualImageFromUrl(storeId,imageUrl):{savedUrl:null,viewerUrl:null,sourceUrl:null};
    const id=await addManualItem({storeId,product,price,category,sourceType,startDate,endDate,imageUrl:saved.viewerUrl,imageBlobUrl:saved.savedUrl,imageSourceUrl:saved.sourceUrl||null});
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
