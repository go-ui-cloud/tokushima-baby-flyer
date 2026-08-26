import { neon } from '@neondatabase/serverless';
import { STORES } from './config.js';
import { hasBlobStorage } from './blob.js';

let initialized=false;
function client(){
  if(!process.env.DATABASE_URL) return null;
  return neon(process.env.DATABASE_URL);
}
async function init(){
  const sql=client(); if(!sql || initialized) return sql;
  await sql`CREATE TABLE IF NOT EXISTS baby_flyer_store_state (
    store_id text PRIMARY KEY,
    result jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS baby_flyer_update_history (
    id bigserial PRIMARY KEY,
    batch_id text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    payload jsonb NOT NULL
  )`;
  initialized=true; return sql;
}
export const hasDatabase = () => Boolean(process.env.DATABASE_URL);

function blankResult(store){ return {id:store.id,chain:store.chain,area:store.area,storeKeywords:store.storeKeywords,sourceUrl:store.sources[0]?.url||'不明',flyers:[],items:[],error:null}; }

export async function saveStoreResult(result){
  const sql=await init(); if(!sql) return false;
  await sql`INSERT INTO baby_flyer_store_state (store_id,result,updated_at) VALUES (${result.id},${JSON.stringify(result)}::jsonb,now()) ON CONFLICT (store_id) DO UPDATE SET result=EXCLUDED.result, updated_at=now()`;
  return true;
}

export async function getLatest(){
  const sql=await init();
  if(!sql) return {updatedAt:null,results:STORES.map(blankResult),persistence:{database:false,blob:hasBlobStorage()}};
  const rows=await sql`SELECT store_id,result,updated_at FROM baby_flyer_store_state`;
  const map=new Map(rows.map(r=>[r.store_id,r]));
  let newest=null;
  const results=STORES.map(s=>{
    const row=map.get(s.id); if(!row) return blankResult(s);
    const d=new Date(row.updated_at); if(!newest || d>newest) newest=d;
    return row.result;
  });
  return {updatedAt:newest?.toISOString()||null,results,persistence:{database:true,blob:hasBlobStorage()}};
}

export async function finalizeHistory(batchId,snapshot=null){
  const sql=await init();
  const latest=sql ? await getLatest() : (snapshot || await getLatest());
  const now=new Date().toISOString();
  const payload={...latest,updatedAt:now,persistence:{database:Boolean(sql),blob:hasBlobStorage()}};
  if(sql) await sql`INSERT INTO baby_flyer_update_history (batch_id,updated_at,payload) VALUES (${batchId||null},now(),${JSON.stringify(payload)}::jsonb)`;
  return payload;
}

export async function getHistoryRows(limit=200){
  const sql=await init(); if(!sql) return [];
  return sql`SELECT id,batch_id,updated_at,payload FROM baby_flyer_update_history ORDER BY id DESC LIMIT ${limit}`;
}

export async function saveProgress(storeId, phase, detail='', batchId=null, extra={}){
  const sql=await init(); if(!sql) return false;
  await sql`CREATE TABLE IF NOT EXISTS baby_flyer_progress (
    store_id text PRIMARY KEY,
    batch_id text,
    phase text NOT NULL,
    detail text,
    extra jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`;
  await sql`INSERT INTO baby_flyer_progress (store_id,batch_id,phase,detail,extra,updated_at)
    VALUES (${storeId},${batchId},${phase},${detail},${JSON.stringify(extra||{})}::jsonb,now())
    ON CONFLICT (store_id) DO UPDATE SET batch_id=EXCLUDED.batch_id, phase=EXCLUDED.phase, detail=EXCLUDED.detail, extra=EXCLUDED.extra, updated_at=now()`;
  return true;
}

export async function getProgress(storeId){
  const sql=await init(); if(!sql) return null;
  await sql`CREATE TABLE IF NOT EXISTS baby_flyer_progress (
    store_id text PRIMARY KEY,
    batch_id text,
    phase text NOT NULL,
    detail text,
    extra jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`;
  const rows=await sql`SELECT store_id,batch_id,phase,detail,extra,updated_at FROM baby_flyer_progress WHERE store_id=${storeId} LIMIT 1`;
  if(!rows.length) return null;
  const r=rows[0];
  return {storeId:r.store_id,batchId:r.batch_id,phase:r.phase,detail:r.detail,extra:r.extra||{},updatedAt:new Date(r.updated_at).toISOString()};
}
