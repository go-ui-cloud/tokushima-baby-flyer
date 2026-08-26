import fs from 'node:fs/promises';
import { STORES } from './config.js';
import { extractBabyItems } from './extract.js';
import { analyzeFlyerDates, pickLatestFlyers, verifyFreshnessTwoStage } from './flyer-date.js';
import { ocrAsset, closeOcr } from './ocr.js';
import { persistFlyer } from './blob.js';
import { saveStoreResult } from './db.js';
import { scrapeStore } from './scraper.js';

const BASE_LIMIT_MS=112000;
const EXTENDED_LIMIT_MS=285000;
function dedupe(items){const seen=new Set();return items.filter(x=>{const k=`${x.category}|${x.product}|${x.price}`;if(seen.has(k))return false;seen.add(k);return true;});}
function looksHeavy(assets=[]){const bytes=assets.reduce((n,a)=>n+(a.size||0),0);return assets.length>=3||bytes>=4*1024*1024||assets.some(a=>String(a.file||'').toLowerCase().endsWith('.pdf'));}

export async function updateStore(storeId){
  const startedAt=Date.now();const store=STORES.find(x=>x.id===storeId);if(!store)throw new Error(`対象店舗が見つかりません: ${storeId}`);
  let runDir,scraped=null;const warnings=[];let extended=false,deadline=startedAt+BASE_LIMIT_MS;
  try{
    scraped=await scrapeStore(store);runDir=scraped.runDir;if(scraped.browserError)warnings.push(`ブラウザ取得: ${scraped.browserError}`);
    if(looksHeavy(scraped.assets)){extended=true;deadline=startedAt+EXTENDED_LIMIT_MS;warnings.push('PDF/複数ページなど解析量が多いため、最大5分モードへ自動延長しました');}
    let items=[];
    // WEB本文は商品抽出ではなく、最新性チェック第1段階の参考にだけ使う。
    let flyers=[];
    for(const asset of scraped.assets){
      if(Date.now()>deadline){warnings.push(extended?'5分上限に近づいたため、残りのOCRを省略しました':'通常2分上限に達したため、残りのOCRを省略しました');break;}
      const saved=await persistFlyer(store.id,asset.file,asset.url);const displayUrl=saved.viewerUrl||(/^https?:/i.test(asset.url)?asset.url:(asset.referer||scraped.selectedSource?.url||store.sources[0]?.url));
      const ocr=await ocrAsset(asset);if(ocr.error)warnings.push(`OCR: ${ocr.error}`);
      if(!extended&&ocr.text?.length>=1800){extended=true;deadline=startedAt+EXTENDED_LIMIT_MS;warnings.push('文字量が多いため、最大5分モードへ自動延長しました');}
      const sourceDateCheck=asset.sourceDateCheck||analyzeFlyerDates('');
      const dateCheck=analyzeFlyerDates(ocr.text,{now:new Date()});
      const verification=verifyFreshnessTwoStage(sourceDateCheck,dateCheck);
      flyers.push({url:asset.url,savedUrl:saved.savedUrl,viewerUrl:saved.viewerUrl||null,type:asset.mime||'不明',score:asset.score,saveError:saved.saveError||null,dateCheck,sourceDateCheck,verification,ocrOk:!ocr.error,captureMethod:asset.captureMethod||'direct'});
      // 明確に古い・日付不一致のチラシは商品抽出に使わない。
      if(ocr.text&&!['stale','conflict'].includes(verification.status))items.push(...extractBabyItems(ocr.text,{sourceUrl:asset.referer||(scraped.selectedSource?.url||store.sources[0]?.url),flyerUrl:displayUrl,confidence:asset.captureMethod==='screenshot'?'チラシ画面スクリーンショット/OCR':asset.file.endsWith('.pdf')?'PDF/OCR抽出':'画像OCR抽出'}));
    }
    flyers=pickLatestFlyers(flyers);
    const verifiedCurrent=flyers.filter(f=>f.verification?.status==='verified-current');
    const verifiedRecent=flyers.filter(f=>f.verification?.status==='verified-recent');
    const flyerOnly=flyers.filter(f=>f.verification?.status==='flyer-only');
    const sourceOnly=flyers.filter(f=>f.verification?.status==='source-only');
    const chosen=(verifiedCurrent.length?verifiedCurrent:verifiedRecent.length?verifiedRecent:flyerOnly.length?flyerOnly:sourceOnly.length?sourceOnly:flyers).slice(0,4);
    const allowedUrls=new Set(chosen.map(f=>f.viewerUrl||(/^https?:/i.test(f.url)?f.url:null)).filter(Boolean));
    items=dedupe(items).filter(x=>x.flyerUrl==='不明'||allowedUrls.has(x.flyerUrl)).slice(0,120);
    let freshness='確認不足';
    if(verifiedCurrent.length)freshness='2段階一致・現在有効';else if(verifiedRecent.length)freshness='2段階一致・最近';else if(flyerOnly.length)freshness='チラシ内日付のみ確認';else if(sourceOnly.length)freshness='掲載側日付のみ確認';else if(flyers.some(f=>f.verification?.status==='conflict'))freshness='日付不一致';else if(flyers.some(f=>f.verification?.status==='stale'))freshness='古い可能性';else freshness='2段階とも日付不明';
    if(!verifiedCurrent.length&&!verifiedRecent.length)warnings.push('最新性の2段階確認が完了していないため、「最新」とは断定していません');
    if(flyers.some(f=>f.captureMethod==='screenshot'))warnings.push('直接取得できないチラシは、チラシ表示領域のスクリーンショットをOCRしました');
    const result={id:store.id,chain:store.chain,area:store.area,storeKeywords:store.storeKeywords,sourceUrl:(scraped.selectedSource?.url||store.sources[0]?.url),flyers:chosen,items,error:null,warnings,flyerFreshness:freshness,acquisition:scraped.acquisition||'不明',browserWarning:scraped.browserError||null,sourceProvider:scraped.selectedSource?.label||scraped.selectedSource?.provider||'不明',sourceAttempts:scraped.attempts||[],durationMs:Date.now()-startedAt,extendedAnalysis:extended,checkedAt:new Date().toISOString()};
    await saveStoreResult(result);return result;
  }catch(e){const result={id:store.id,chain:store.chain,area:store.area,storeKeywords:store.storeKeywords,sourceUrl:(scraped?.selectedSource?.url||store.sources[0]?.url),flyers:[],items:[],error:e.message,warnings,flyerFreshness:'不明',durationMs:Date.now()-startedAt,extendedAnalysis:extended,checkedAt:new Date().toISOString()};await saveStoreResult(result).catch(()=>{});return result;}
  finally{await closeOcr().catch(()=>{});if(runDir)await fs.rm(runDir,{recursive:true,force:true}).catch(()=>{});}
}
