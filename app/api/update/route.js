import { NextResponse } from 'next/server';
import { updateStore } from '../../../lib/update.js';
import { finalizeHistory, getLatest } from '../../../lib/db.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

export async function POST(req){
  try{
    const body=await req.json().catch(()=>({}));
    if(body.action==='finalize'){
      return NextResponse.json(await finalizeHistory(body.batchId||null,body.snapshot||null),{headers:{'Cache-Control':'no-store'}});
    }
    if(!body.storeId) return NextResponse.json({error:'storeId が必要です'},{status:400});
    const result=await updateStore(body.storeId);
    const latest=await getLatest();
    return NextResponse.json({ok:true,result,persistence:latest.persistence},{headers:{'Cache-Control':'no-store'}});
  }catch(e){return NextResponse.json({error:e.message},{status:500});}
}
