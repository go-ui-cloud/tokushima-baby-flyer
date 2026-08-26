import fs from 'node:fs/promises';
import { STORES } from './config.js';
import { extractBabyItems } from './extract.js';
import { ocrAsset, closeOcr } from './ocr.js';
import { persistFlyer } from './blob.js';
import { saveStoreResult } from './db.js';
import { scrapeStore } from './scraper.js';

const OCR_START_DEADLINE_MS=38000;

function dedupe(items){
  const seen=new Set();
  return items.filter(x=>{const k=`${x.category}|${x.product}|${x.price}`;if(seen.has(k))return false;seen.add(k);return true;});
}

export async function updateStore(storeId){
  const startedAt=Date.now();
  const store=STORES.find(x=>x.id===storeId);
  if(!store) throw new Error(`対象店舗が見つかりません: ${storeId}`);
  let runDir;
  const warnings=[];
  try{
    const scraped=await scrapeStore(store); runDir=scraped.runDir;
    if(scraped.browserError) warnings.push(`ブラウザ取得: ${scraped.browserError}`);
    let items=[];
    for(const p of scraped.pages){
      if(p.body) items.push(...extractBabyItems(p.body,{sourceUrl:p.url,flyerUrl:'不明',confidence:'WEB本文抽出'}));
    }
    const flyers=[];
    for(const asset of scraped.assets){
      const saved=await persistFlyer(store.id,asset.file,asset.url);
      const displayUrl=saved.viewerUrl||asset.url;
      flyers.push({url:asset.url,savedUrl:saved.savedUrl,viewerUrl:saved.viewerUrl||null,type:asset.mime||'不明',score:asset.score,saveError:saved.saveError||null});

      // Keep each store bounded. If discovery consumed most of the time,
      // preserve the flyer links and skip OCR rather than hanging the UI.
      if(Date.now()-startedAt>OCR_START_DEADLINE_MS){
        warnings.push('時間上限に近づいたため、一部チラシのOCRを省略しました');
        continue;
      }
      const ocr=await ocrAsset(asset);
      if(ocr.error) warnings.push(`OCR: ${ocr.error}`);
      if(ocr.text) items.push(...extractBabyItems(ocr.text,{sourceUrl:asset.referer||(scraped.selectedSource?.url||store.sources[0]?.url||store.sources[0]),flyerUrl:displayUrl,confidence:asset.file.endsWith('.pdf')?'PDF/OCR抽出':'画像OCR抽出'}));
    }
    items=dedupe(items).slice(0,120);
    const result={
      id:store.id,chain:store.chain,area:store.area,storeKeywords:store.storeKeywords,
      sourceUrl:(scraped.selectedSource?.url||store.sources[0]?.url||store.sources[0]),flyers,items,error:null,warnings,
      acquisition:scraped.acquisition||'不明',browserWarning:scraped.browserError||null,sourceProvider:scraped.selectedSource?.label||scraped.selectedSource?.provider||'不明',sourceAttempts:scraped.attempts||[],
      durationMs:Date.now()-startedAt,checkedAt:new Date().toISOString()
    };
    await saveStoreResult(result);
    return result;
  }catch(e){
    const result={
      id:store.id,chain:store.chain,area:store.area,storeKeywords:store.storeKeywords,
      sourceUrl:(scraped.selectedSource?.url||store.sources[0]?.url||store.sources[0]),flyers:[],items:[],error:e.message,warnings,
      durationMs:Date.now()-startedAt,checkedAt:new Date().toISOString()
    };
    await saveStoreResult(result).catch(()=>{});
    return result;
  }finally{
    await closeOcr().catch(()=>{});
    if(runDir) await fs.rm(runDir,{recursive:true,force:true}).catch(()=>{});
  }
}
