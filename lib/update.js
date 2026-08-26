import fs from 'node:fs/promises';
import { STORES } from './config.js';
import { extractBabyItems } from './extract.js';
import { analyzeFlyerDates, pickLatestFlyers, verifyFreshnessTwoStage } from './flyer-date.js';
import { ocrAsset, closeOcr } from './ocr.js';
import { persistFlyer } from './blob.js';
import { saveStoreResult, saveProgress } from './db.js';
import { scrapeStore } from './scraper.js';
import { scrapeCostcoOnline } from './costco.js';

const BASE_LIMIT_MS=112000;
const EXTENDED_LIMIT_MS=285000;
function dedupe(items){const seen=new Set();return items.filter(x=>{const k=`${x.category}|${x.product}|${x.price}|${x.notes||''}`;if(seen.has(k))return false;seen.add(k);return true;});}
function looksHeavy(assets=[]){const bytes=assets.reduce((n,a)=>n+(a.size||0),0);return assets.length>=3||bytes>=4*1024*1024||assets.some(a=>String(a.file||'').toLowerCase().endsWith('.pdf'));}

export async function updateStore(storeId,batchId=null){
  const startedAt=Date.now();const store=STORES.find(x=>x.id===storeId);if(!store)throw new Error(`対象店舗が見つかりません: ${storeId}`);
  const progress=async(phase,detail='',extra={})=>{await saveProgress(store.id,phase,detail,batchId,{...extra,elapsedMs:Date.now()-startedAt}).catch(()=>{});};
  await progress('開始','更新処理を開始しました');

  if(store.type==='costco-online'){
    try{
      await progress('店舗ページ確認中','コストコオンライン公式を確認しています');
      const out=await scrapeCostcoOnline(store,progress);
      await progress('完了',`${out.items.length}件の「¥○○引き後」商品を確認しました`,{itemCount:out.items.length});
      const result={id:store.id,chain:store.chain,area:store.area,storeKeywords:store.storeKeywords,sourceUrl:store.sources[0]?.url,flyers:[],items:dedupe(out.items),error:null,warnings:out.items.length?[]:['「¥○○引き後」が明記された商品を確認できませんでした'],flyerFreshness:'オンライン商品ページ',acquisition:'costco-official-html',browserWarning:null,sourceProvider:'コストコオンライン公式',sourceAttempts:out.pages||[],durationMs:Date.now()-startedAt,extendedAnalysis:false,checkedAt:new Date().toISOString()};
      await saveStoreResult(result);return result;
    }catch(e){
      await progress('エラー',e.message);
      const result={id:store.id,chain:store.chain,area:store.area,storeKeywords:store.storeKeywords,sourceUrl:store.sources[0]?.url,flyers:[],items:[],error:e.message,warnings:[],flyerFreshness:'オンライン商品ページ',durationMs:Date.now()-startedAt,extendedAnalysis:false,checkedAt:new Date().toISOString()};
      await saveStoreResult(result).catch(()=>{});return result;
    }
  }

  let runDir,scraped=null;const warnings=[];let extended=false,deadline=startedAt+BASE_LIMIT_MS;
  try{
    await progress('チラシを検索中','公式サイトを優先して最新チラシを探しています');
    scraped=await scrapeStore(store,progress);runDir=scraped.runDir;if(scraped.browserError)warnings.push(`ブラウザ取得: ${scraped.browserError}`);
    if(scraped.noSale){
      const result={id:store.id,chain:store.chain,area:store.area,storeKeywords:store.storeKeywords,sourceUrl:(scraped.selectedSource?.url||store.sources[0]?.url),flyers:[],items:[],error:null,warnings:['現在、セール情報はありません。'],flyerFreshness:'セール情報なし',acquisition:'official-no-sale',browserWarning:null,sourceProvider:scraped.selectedSource?.label||'西松屋公式',sourceAttempts:scraped.attempts||[],durationMs:Date.now()-startedAt,extendedAnalysis:false,checkedAt:new Date().toISOString()};
      await saveStoreResult(result);await progress('完了','現在、セール情報はありません。OCRをスキップしました',{flyerCount:0,itemCount:0});return result;
    }
    if(scraped.assets?.length)await progress('チラシを発見',`解析対象のチラシを ${scraped.assets.length} 件取得しました`,{count:scraped.assets.length});
    else await progress('チラシ未発見','解析できるチラシ画像/PDFを取得できませんでした');
    if(looksHeavy(scraped.assets)){extended=true;deadline=startedAt+EXTENDED_LIMIT_MS;warnings.push('PDF/複数ページなど解析量が多いため、最大5分モードへ自動延長しました');await progress('5分モードへ延長','PDF/複数ページなど文字量が多いため最大5分まで延長します');}
    let items=[];let flyers=[];
    for(let assetIndex=0;assetIndex<scraped.assets.length;assetIndex++){
      const asset=scraped.assets[assetIndex];
      if(Date.now()>deadline){warnings.push(extended?'5分上限に近づいたため、残りのOCRを省略しました':'通常2分上限に達したため、残りのOCRを省略しました');await progress('時間上限','残りのOCRを省略します');break;}
      await progress('チラシ保存中',`チラシ ${assetIndex+1}/${scraped.assets.length} を保存しています`,{current:assetIndex+1,total:scraped.assets.length});
      const saved=await persistFlyer(store.id,asset.file,asset.url);const displayUrl=saved.viewerUrl||(/^https?:/i.test(asset.url)?asset.url:(asset.referer||scraped.selectedSource?.url||store.sources[0]?.url));
      await progress('OCRを実行中',`チラシ ${assetIndex+1}/${scraped.assets.length} の文字を読み取っています`,{current:assetIndex+1,total:scraped.assets.length});
      const ocr=await ocrAsset(asset);if(ocr.error)warnings.push(`OCR: ${ocr.error}`);
      if(!extended&&ocr.text?.length>=1800){extended=true;deadline=startedAt+EXTENDED_LIMIT_MS;warnings.push('文字量が多いため、最大5分モードへ自動延長しました');await progress('5分モードへ延長',`OCR文字量が多いため最大5分まで延長します`,{textLength:ocr.text.length});}
      await progress('日付確認中',`チラシ ${assetIndex+1}/${scraped.assets.length} の掲載日とチラシ内日付を照合しています`);
      const sourceDateCheck=asset.sourceDateCheck||analyzeFlyerDates('');
      const dateCheck=analyzeFlyerDates(ocr.text,{now:new Date()});
      const verification=verifyFreshnessTwoStage(sourceDateCheck,dateCheck);
      flyers.push({url:asset.url,savedUrl:saved.savedUrl,viewerUrl:saved.viewerUrl||null,type:asset.mime||'不明',score:asset.score,saveError:saved.saveError||null,dateCheck,sourceDateCheck,verification,ocrOk:!ocr.error,captureMethod:asset.captureMethod||'direct'});
      if(ocr.text&&!['stale','conflict'].includes(verification.status)){
        await progress('商品抽出中',`チラシ ${assetIndex+1}/${scraped.assets.length} から対象カテゴリ商品を抽出しています`);
        items.push(...extractBabyItems(ocr.text,{sourceUrl:asset.referer||(scraped.selectedSource?.url||store.sources[0]?.url),flyerUrl:displayUrl,confidence:asset.captureMethod==='screenshot'?'チラシ画面スクリーンショット/OCR':asset.file.endsWith('.pdf')?'PDF/OCR抽出':'画像OCR抽出'}));
      }
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
    await saveStoreResult(result);await progress('完了',`${chosen.length}件のチラシ、${items.length}件の商品を処理しました`,{flyerCount:chosen.length,itemCount:items.length});return result;
  }catch(e){await progress('エラー',e.message);const result={id:store.id,chain:store.chain,area:store.area,storeKeywords:store.storeKeywords,sourceUrl:(scraped?.selectedSource?.url||store.sources[0]?.url),flyers:[],items:[],error:e.message,warnings,flyerFreshness:'不明',durationMs:Date.now()-startedAt,extendedAnalysis:extended,checkedAt:new Date().toISOString()};await saveStoreResult(result).catch(()=>{});return result;}
  finally{await closeOcr().catch(()=>{});if(runDir)await fs.rm(runDir,{recursive:true,force:true}).catch(()=>{});}
}
