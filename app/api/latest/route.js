import { NextResponse } from 'next/server';
import { getLatest } from '../../../lib/db.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(){
  try{return NextResponse.json(await getLatest(),{headers:{'Cache-Control':'no-store'}});}
  catch(e){return NextResponse.json({error:e.message,updatedAt:null,results:[]},{status:500});}
}
