import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { issueSignedToken, presignUrl } from '@vercel/blob';
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
    if(!isAdminRequest(request))return NextResponse.json({error:'管理者ログインが必要です'},{status:401});
    const body=await request.json();
    const storeId=String(body?.storeId||'');
    const contentType=String(body?.contentType||'').toLowerCase();
    const size=Number(body?.size||0);
    const store=STORES.find(item=>item.id===storeId&&!AUTOMATIC_TYPES.has(item.type));
    if(!store)throw new Error('登録先店舗が正しくありません');
    if(!CONTENT_TYPES.includes(contentType))throw new Error('PDF・JPEG・PNG・WebPを指定してください');
    if(!Number.isFinite(size)||size<=0||size>MAX_SIZE)throw new Error('チラシファイルは25MB以下にしてください');
    const originalName=safeName(String(body?.filename||'flyer')).slice(-100)||'flyer';
    const pathname=`manual/${safeName(storeId)}/${Date.now()}-${crypto.randomUUID()}-${originalName}`;
    const validUntil=Date.now()+10*60*1000;
    const token=await issueSignedToken({pathname,operations:['put'],allowedContentTypes:CONTENT_TYPES,maximumSizeInBytes:MAX_SIZE,validUntil});
    const {presignedUrl}=await presignUrl(token,{
      access:'private',operation:'put',pathname,allowedContentTypes:CONTENT_TYPES,
      maximumSizeInBytes:MAX_SIZE,allowOverwrite:false,addRandomSuffix:false,validUntil
    });
    return NextResponse.json({uploadUrl:presignedUrl,pathname});
  }catch(error){
    console.error('flyer-upload failed',error);
    return NextResponse.json({error:error?.message||'アップロードを開始できませんでした'},{status:400});
  }
}
