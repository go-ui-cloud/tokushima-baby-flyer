import fs from 'node:fs/promises';
import { STORES } from './config.js';
import { extractBabyItems } from './extract.js';
import { analyzeFlyerDates, pickLatestFlyers } from './flyer-date.js';
import { ocrAsset, closeOcr } from './ocr.js';
import { persistFlyer } from './blob.js';
import { saveStoreResult } from './db.js';
import { scrapeStore } from './scraper.js';

const STORE_SOFT_LIMIT_MS=112000;
function dedupe(items){const seen=new Set();return items.filter(x=>{const k=`${x.category}|${x.product}|${x.price}`;if(seen.has(k))return false;seen.add(k);return true;});}

export async function updateStore(storeId){
  const startedAt=Date.now(); const store=STORES.find(x=>x.id===storeId); if(!store)throw new Error(`対象店舗が見つかりません: ${storeId}`);
  let runDir; let scraped=null; const warnings=[];
  try{
    scraped=await scrapeStore(store); runDir=scraped.runDir; if(scraped.browserError)warnings.push(`ブラウザ取得: ${scraped.browserError}`);
    let items=[];
    // WEB本文は参考情報のみ。チラシ内日付の判定とは分離する。
    for(const p of scraped.pages){if(p.body)items.push(...extractBabyItems(p.body,{sourceUrl:p.url,flyerUrl:'不明',confidence:'WEB本文抽出'}));}
    let flyers=[];
    for(const asset of scraped.assets){
      if(Date.now()-startedAt>STORE_SOFT_LIMIT_MS){warnings.push('2分上限に近づいたため、残りのチラシOCRを省略しました');break;}
      const saved=await persistFlyer(store.id,asset.file,asset.url); const displayUrl=saved.viewerUrl||asset.url;
      const ocr=await ocrAsset(asset); if(ocr.error)warnings.push(`OCR: ${ocr.error}`);
      const dateCheck=analyzeFlyerDates(ocr.text,{now:new Date()});
      flyers.push({url:asset.url,savedUrl:saved.savedUrl,viewerUrl:saved.viewerUrl||null,type:asset.mime||'不明',score:asset.score,saveError:saved.saveError||null,dateCheck,ocrOk:!ocr.error});
      // 古いと判定できたチラシは商品抽出に使わない。日付不明は推測せず候補のまま扱う。
      if(ocr.text && dateCheck.status!=='stale'){
        items.push(...extractBabyItems(ocr.text,{sourceUrl:asset.referer||(scraped.selectedSource?.url||store.sources[0]?.url),flyerUrl:displayUrl,confidence:asset.file.endsWith('.pdf')?'PDF/OCR抽出':'画像OCR抽出'}));
      }
    }
    flyers=pickLatestFlyers(flyers);
    const current=flyers.filter(f=>f.dateCheck?.status==='current');
    const recent=flyers.filter(f=>f.dateCheck?.isRecent);
    const unknown=flyers.filter(f=>f.dateCheck?.status==='unknown');
    const chosen=(current.length?current:recent.length?recent:unknown.length?unknown:flyers).slice(0,4);
    const allowedUrls=new Set(chosen.map(f=>f.viewerUrl||f.url));
    items=dedupe(items).filter(x=>x.flyerUrl==='不明'||allowedUrls.has(x.flyerUrl)).slice(0,120);
    const freshness=current.length?'現在有効':recent.length?'最近のチラシ':unknown.length?'日付不明':'古い可能性';
    if(freshness==='日付不明')warnings.push('チラシ内の日付を確定できませんでした。最新とは断定していません');
    if(freshness==='古い可能性')warnings.push('取得したチラシは日付上、最近のものと確認できませんでした');
    const result={id:store.id,chain:store.chain,area:store.area,storeKeywords:store.storeKeywords,sourceUrl:(scraped.selectedSource?.url||store.sources[0]?.url),flyers:chosen,items,error:null,warnings,flyerFreshness:freshness,acquisition:scraped.acquisition||'不明',browserWarning:scraped.browserError||null,sourceProvider:scraped.selectedSource?.label||scraped.selectedSource?.provider||'不明',sourceAttempts:scraped.attempts||[],durationMs:Date.now()-startedAt,checkedAt:new Date().toISOString()};
    await saveStoreResult(result); return result;
  }catch(e){
    const result={id:store.id,chain:store.chain,area:store.area,storeKeywords:store.storeKeywords,sourceUrl:(scraped?.selectedSource?.url||store.sources[0]?.url),flyers:[],items:[],error:e.message,warnings,flyerFreshness:'不明',durationMs:Date.now()-startedAt,checkedAt:new Date().toISOString()};
    await saveStoreResult(result).catch(()=>{}); return result;
  }finally{await closeOcr().catch(()=>{});if(runDir)await fs.rm(runDir,{recursive:true,force:true}).catch(()=>{});}
}
