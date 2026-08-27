import { NextResponse } from 'next/server';
import { requestSkip, saveProgress } from '../../../lib/db.js';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(req){
  try{
    const body=await req.json().catch(()=>({}));
    if(!body.storeId) return NextResponse.json({error:'storeId が必要です'},{status:400});
    await requestSkip(body.storeId,body.batchId||null);
    // 処理がすでに異常終了していても、DB上の進捗を直ちに終了扱いにする。
    await saveProgress(body.storeId,'スキップ','ユーザー操作でこの店舗の処理を終了しました',body.batchId||null).catch(()=>{});
    return NextResponse.json({ok:true},{headers:{'Cache-Control':'no-store'}});
  }catch(e){ return NextResponse.json({error:e.message},{status:500}); }
}
