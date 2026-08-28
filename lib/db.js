import { neon } from '@neondatabase/serverless';
import { STORES } from './config.js';
import { hasBlobStorage } from './blob.js';

let initialized=false;

const DB_URL_KEYS = [
  'DATABASE_URL',
  'POSTGRES_URL',
  'DATABASE_URL_UNPOOLED',
  'POSTGRES_URL_NON_POOLING',
  'POSTGRES_PRISMA_URL',
  'POSTGRES_URL_NO_SSL'
];

function resolveDatabaseUrl(){
  for(const key of DB_URL_KEYS){
    const value=process.env[key];
    if(value && /^postgres(?:ql)?:\/\//i.test(value.trim())) return {url:value.trim(),key};
  }
  const host=process.env.PGHOST || process.env.POSTGRES_HOST;
  const user=process.env.PGUSER || process.env.POSTGRES_USER;
  const password=process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD;
  const database=process.env.PGDATABASE || process.env.POSTGRES_DATABASE;
  if(host && user && password && database){
    const url=`postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}/${encodeURIComponent(database)}?sslmode=require`;
    return {url,key:'PG*'};
  }
  return null;
}

function client(){
  const resolved=resolveDatabaseUrl();
  if(!resolved) return null;
  return neon(resolved.url);
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
export const hasDatabase = () => Boolean(resolveDatabaseUrl());
export const getDatabaseEnvSource = () => resolveDatabaseUrl()?.key || null;

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

export async function getLatestNonEmptyStoreResult(storeId,limit=50){
  const sql=await init(); if(!sql) return null;
  const current=await sql`SELECT result FROM baby_flyer_store_state WHERE store_id=${storeId} LIMIT 1`;
  if(current[0]?.result?.items?.length)return current[0].result;
  const rows=await sql`SELECT payload FROM baby_flyer_update_history ORDER BY id DESC LIMIT ${limit}`;
  for(const row of rows){
    const result=row.payload?.results?.find?.(x=>x?.id===storeId&&x?.items?.length);
    if(result)return result;
  }
  return null;
}

async function ensureManualItemsTable(sql){
  await sql`CREATE TABLE IF NOT EXISTS baby_flyer_manual_items (
    id bigserial PRIMARY KEY,
    store_id text NOT NULL,
    product text NOT NULL,
    image_url text,
    image_blob_url text,
    price text NOT NULL,
    start_date text,
    end_date text,
    category text NOT NULL,
    memo text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`;
}

export async function getManualItems(){
  const sql=await init(); if(!sql)return [];
  await ensureManualItemsTable(sql);
  const rows=await sql`SELECT id,store_id,product,image_url,image_blob_url,price,start_date,end_date,category,memo,created_at FROM baby_flyer_manual_items ORDER BY created_at DESC,id DESC`;
  return rows.map(r=>({id:String(r.id),storeId:r.store_id,product:r.product,imageUrl:r.image_url||null,imageBlobUrl:r.image_blob_url||null,price:r.price,startDate:r.start_date||'不明',endDate:r.end_date||'不明',category:r.category,memo:r.memo||'',manual:true,createdAt:new Date(r.created_at).toISOString()}));
}

export async function addManualItem(item){
  const sql=await init(); if(!sql)throw new Error('Neon/Postgresが設定されていません');
  await ensureManualItemsTable(sql);
  const rows=await sql`INSERT INTO baby_flyer_manual_items (store_id,product,image_url,image_blob_url,price,start_date,end_date,category,memo)
    VALUES (${item.storeId},${item.product},${item.imageUrl||null},${item.imageBlobUrl||null},${item.price},${item.startDate||null},${item.endDate||null},${item.category},${item.memo||null}) RETURNING id`;
  return String(rows[0].id);
}

export async function deleteManualItem(id){
  const sql=await init(); if(!sql)throw new Error('Neon/Postgresが設定されていません');
  await ensureManualItemsTable(sql);
  const rows=await sql`DELETE FROM baby_flyer_manual_items WHERE id=${id} RETURNING image_blob_url`;
  return rows[0]||null;
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

export async function getActiveProgress(maxAgeSeconds=900){
  const sql=await init(); if(!sql) return null;
  await sql`CREATE TABLE IF NOT EXISTS baby_flyer_progress (store_id text PRIMARY KEY,batch_id text,phase text NOT NULL,detail text,extra jsonb,updated_at timestamptz NOT NULL DEFAULT now())`;
  // updateStore が保存する終了状態は「完了」「エラー」「スキップ」。
  // 旧表記の「失敗」も含め、終了済み進捗へ再同期しない。
  const rows=await sql`SELECT store_id,batch_id,phase,detail,extra,updated_at FROM baby_flyer_progress WHERE updated_at >= now() - (${maxAgeSeconds} * interval '1 second') AND phase NOT IN ('完了','失敗','エラー','スキップ') ORDER BY updated_at DESC LIMIT 1`;
  if(!rows.length)return null; const r=rows[0];
  return {storeId:r.store_id,batchId:r.batch_id,phase:r.phase,detail:r.detail,extra:r.extra||{},updatedAt:new Date(r.updated_at).toISOString()};
}

export async function clearCurrentCache(){
  const sql=await init(); if(!sql) return false;
  await sql`DELETE FROM baby_flyer_store_state`;
  await sql`DELETE FROM baby_flyer_progress`;
  await sql`CREATE TABLE IF NOT EXISTS baby_flyer_skip_request (store_id text PRIMARY KEY,batch_id text,requested_at timestamptz NOT NULL DEFAULT now())`;
  await sql`DELETE FROM baby_flyer_skip_request`;
  return true;
}

async function ensureSkipTable(sql){
  await sql`CREATE TABLE IF NOT EXISTS baby_flyer_skip_request (
    store_id text PRIMARY KEY,
    batch_id text,
    requested_at timestamptz NOT NULL DEFAULT now()
  )`;
}

export async function requestSkip(storeId,batchId=null){
  const sql=await init(); if(!sql) return false; await ensureSkipTable(sql);
  await sql`INSERT INTO baby_flyer_skip_request (store_id,batch_id,requested_at) VALUES (${storeId},${batchId},now())
    ON CONFLICT (store_id) DO UPDATE SET batch_id=EXCLUDED.batch_id, requested_at=now()`;
  return true;
}

export async function clearSkip(storeId){
  const sql=await init(); if(!sql) return false; await ensureSkipTable(sql);
  await sql`DELETE FROM baby_flyer_skip_request WHERE store_id=${storeId}`; return true;
}

export async function isSkipRequested(storeId,batchId=null){
  const sql=await init(); if(!sql) return false; await ensureSkipTable(sql);
  const rows=await sql`SELECT batch_id FROM baby_flyer_skip_request WHERE store_id=${storeId} LIMIT 1`;
  if(!rows.length) return false;
  return !batchId || !rows[0].batch_id || rows[0].batch_id===batchId;
}
