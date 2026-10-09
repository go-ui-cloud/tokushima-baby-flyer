import { NextResponse } from 'next/server';
import { handleUpload } from '@vercel/blob/client';
import { STORES } from '../../../lib/config.js';
import { isAdminRequest } from '../../../lib/admin-auth.js';
import { safeName } from '../../../lib/utils.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const MAX_SIZE=25*1024*1024;
const CONTENT_TYPES=['application/pdf','image/jpeg','image/png','image/webp'];
const AUTOMATIC_TYPES=new Set(['costco-online','uniqlo-online','akachan-online','nishimatsuya-online']);

export async function POST(request){
  try{
    const body=await request.json();
    if(body?.type==='blob.generate-client-token'&&!isAdminRequest(request))return NextResponse.json({error:'管理者ログインが必要です'},{status:401});
    const result=await handleUpload({
      request,body,
      onBeforeGenerateToken:async(pathname,clientPayload)=>{
        let payload={};try{payload=JSON.parse(clientPayload||'{}');}catch{}
        const storeId=String(payload.storeId||'');
        const store=STORES.find(item=>item.id===storeId&&!AUTOMATIC_TYPES.has(item.type));
        const prefix=`manual/${safeName(storeId)}/`;
        if(!store||!String(pathname).startsWith(prefix))throw new Error('登録先店舗または保存先が正しくありません');
        return {allowedContentTypes:CONTENT_TYPES,maximumSizeInBytes:MAX_SIZE,addRandomSuffix:true};
      }
    });
    return NextResponse.json(result);
  }catch(error){
    console.error('flyer-upload failed',error);
    return NextResponse.json({error:error?.message||'アップロードを開始できませんでした'},{status:400});
  }
}
