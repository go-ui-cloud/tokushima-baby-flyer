import { NextResponse } from 'next/server';
import { getLatest, getManualItems } from '../../../lib/db.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(){
  try{
    const [latest,manualItems]=await Promise.all([getLatest(),getManualItems()]);
    const results=latest.results.map(store=>store.id==='costco-online'?store:{...store,items:manualItems.filter(x=>x.storeId===store.id),flyers:[],readImages:[],durationMs:null,extendedAnalysis:false,error:null,warnings:[],flyerFreshness:'手動登録'});
    return NextResponse.json({...latest,results},{headers:{'Cache-Control':'no-store'}});
  }
  catch(e){return NextResponse.json({error:e.message,updatedAt:null,results:[]},{status:500});}
}
