import { getHistoryRows } from '../../../lib/db.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';

function csvCell(v){
  const s=String(v??'不明').replaceAll('"','""');
  return `"${s}"`;
}
export async function GET(){
  try{
    const rows=await getHistoryRows(200);
    const out=[['history_id','batch_id','updated_at','store','area','category','product','price','start_date','end_date','source_url','flyer_url','confidence','error']];
    for(const h of rows){
      for(const store of h.payload?.results||[]){
        if(!store.items?.length){out.push([h.id,h.batch_id||'',h.updated_at,store.chain,store.area,'不明','不明','不明','不明','不明',store.sourceUrl,'不明','不明',store.error||'']);continue;}
        for(const x of store.items) out.push([h.id,h.batch_id||'',h.updated_at,store.chain,store.area,x.category,x.product,x.price,x.startDate,x.endDate,x.sourceUrl,x.flyerUrl,x.confidence,store.error||'']);
      }
    }
    const csv='\uFEFF'+out.map(r=>r.map(csvCell).join(',')).join('\r\n');
    return new Response(csv,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="tokushima-baby-flyer-history.csv"','Cache-Control':'no-store'}});
  }catch(e){return Response.json({error:e.message},{status:500});}
}
