import { NextResponse } from 'next/server';
import { getProgress, getActiveProgress } from '../../../lib/db.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(req){
  const {searchParams}=new URL(req.url);
  const storeId=searchParams.get('storeId');
  try{
    if(!storeId)return NextResponse.json({progress:await getActiveProgress(900)},{headers:{'Cache-Control':'no-store, max-age=0'}});
    return NextResponse.json({progress:await getProgress(storeId)},{headers:{'Cache-Control':'no-store, max-age=0'}});
  }
  catch(e){return NextResponse.json({error:e.message},{status:500});}
}
