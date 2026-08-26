import { NextResponse } from 'next/server';
import { getProgress } from '../../../lib/db.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(req){
  const {searchParams}=new URL(req.url);
  const storeId=searchParams.get('storeId');
  if(!storeId) return NextResponse.json({error:'storeId が必要です'},{status:400});
  try{return NextResponse.json({progress:await getProgress(storeId)},{headers:{'Cache-Control':'no-store'}});}
  catch(e){return NextResponse.json({error:e.message},{status:500});}
}
