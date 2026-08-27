import { NextResponse } from 'next/server';
import { updateStore } from '../../../lib/update.js';
import { finalizeHistory, getLatest, clearCurrentCache } from '../../../lib/db.js';
import { clearFlyerBlobs } from '../../../lib/blob.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

export async function POST(req){
  try{
    const body=await req.json().catch(()=>({}));
    if(body.action==='clear-cache'){
      const [blobResult]=await Promise.all([clearFlyerBlobs().catch(e=>({deleted:0,error:e.message})),clearCurrentCache().catch(()=>false)]);
      return NextResponse.json({ok:true,blob:blobResult},{headers:{'Cache-Control':'no-store, max-age=0'}});
    }
    if(body.action==='finalize') return NextResponse.json(await finalizeHistory(body.batchId||null,body.snapshot||null),{headers:{'Cache-Control':'no-store, max-age=0'}});
    if(!body.storeId) return NextResponse.json({error:'storeId が必要です'},{status:400});
    const result=await updateStore(body.storeId,body.batchId||null,{startAssetIndex:body.startAssetIndex||0,previousResult:body.previousResult||null,continuationPass:body.continuationPass||1});
    const latest=await getLatest();
    return NextResponse.json({ok:true,result,persistence:latest.persistence},{headers:{'Cache-Control':'no-store, max-age=0'}});
  }catch(e){return NextResponse.json({error:e.message},{status:500,headers:{'Cache-Control':'no-store, max-age=0'}});}
}
