import { NextResponse } from 'next/server';
import { isAdminRequest } from '../../../lib/admin-auth.js';
import { clearAllDatabaseData } from '../../../lib/db.js';
import { deleteAppImageUrls, findExpiredAppImageUrls } from '../../../lib/blob.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

export async function DELETE(req){
  try{
    if(!isAdminRequest(req))return NextResponse.json({error:'管理者ログインが必要です'},{status:401});
    const expired=await findExpiredAppImageUrls(14);
    const deleted=await clearAllDatabaseData();
    if(!deleted)return NextResponse.json({error:'データベースが設定されていません'},{status:503});
    const images=await deleteAppImageUrls(expired.urls);
    return NextResponse.json({ok:true,deletedImages:images.deleted,retentionDays:14,blobEnabled:expired.enabled},{headers:{'Cache-Control':'no-store, max-age=0'}});
  }catch(e){return NextResponse.json({error:e.message},{status:500,headers:{'Cache-Control':'no-store, max-age=0'}});}
}
