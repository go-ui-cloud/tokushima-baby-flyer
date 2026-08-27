import fs from 'node:fs/promises';
import { STORES } from './config.js';
import { extractBabyItems, extractAllFlyerItems } from './extract.js';
import { analyzeFlyerDates, pickLatestFlyers, verifyFreshnessTwoStage } from './flyer-date.js';
import { ocrAsset, ocrAssetBlocks, closeOcr } from './ocr.js';
import { persistFlyer } from './blob.js';
import { saveStoreResult, saveProgress, isSkipRequested } from './db.js';
import { scrapeStore } from './scraper.js';
import { scrapeCostcoOnline } from './costco.js';

const BASE_LIMIT_MS=112000;
const EXTENDED_LIMIT_MS=285000;
function dedupe(items){const seen=new Set();return items.filter(x=>{const k=`${x.category}|${x.product}|${x.price}|${x.notes||''}`;if(seen.has(k))return false;seen.add(k);return true;});}
function looksHeavy(assets=[]){const bytes=assets.reduce((n,a)=>n+(a.size||0),0);return assets.length>=3||bytes>=4*1024*1024||assets.some(a=>String(a.file||'').toLowerCase().endsWith('.pdf'));}

export async function updateStore(storeId,batchId=null){
  const startedAt=Date.now();const store=STORES.find(x=>x.id===storeId);if(!store)throw new Error(`対象店舗が見つかりません: ${storeId}`);
  const progress=async(phase,detail='',extra={})=>{
    if(await isSkipRequested(store.id,batchId).catch(()=>false)){ const e=new Error('ユーザー操作でこの店舗をスキップしました'); e.code='STORE_SKIPPED'; throw e; }
    await saveProgress(store.id,phase,detail,batchId,{...extra,elapsedMs:Date.now()-startedAt}).catch(()=>{});
  };
  await progress('開始','更新処理を開始しました');

  if(store.type==='costco-online'){
    try{
      await progress('店舗ページ確認中','コストコオンライン公式を確認しています');
      const out=await scrapeCostcoOnline(store,progress);
      await progress('完了',`${out.items.length}件の赤文字「引き後」商品を確認しました`,{itemCount:out.items.length});
      const result={id:store.id,chain:store.chain,area:store.area,storeKeywords:store.storeKeywords,sourceUrl:store.sources[0]?.url,sourceUrls:store.sources.map(x=>({label:x.label,url:x.url})),flyers:[],items:dedupe(out.items),error:null,warnings:out.items.length?[]:['赤文字の「引き後」が確認できる商品を確認できませんでした'],flyerFreshness:'オンライン商品ページ',acquisition:'costco-official-html',browserWarning:null,sourceProvider:'コストコオンライン公式',sourceAttempts:out.pages||[],durationMs:Date.now()-startedAt,extendedAnalysis:false,checkedAt:new Date().toISOString()};
      await saveStoreResult(result);return result;
    }catch(e){
      if(e.code==='STORE_SKIPPED'){ const result={id:store.id,chain:store.chain,area:store.area,storeKeywords:store.storeKeywords,sourceUrl:store.sources[0]?.url,sourceUrls:store.sources.map(x=>({label:x.label,url:x.url})),flyers:[],items:[],error:null,warnings:['ユーザー操作でスキップしました。保存済みの前回表示は変更しません'],flyerFreshness:'スキップ',durationMs:Date.now()-startedAt,extendedAnalysis:false,skipped:true,preservePrevious:true,checkedAt:new Date().toISOString()}; await saveProgress(store.id,'スキップ','ユーザー操作でこの店舗をスキップしました。前回表示を維持します',batchId,{elapsedMs:Date.now()-startedAt}).catch(()=>{}); return result; }
      await saveProgress(store.id,'エラー',e.message,batchId,{elapsedMs:Date.now()-startedAt}).catch(()=>{});
      const result={id:store.id,chain:store.chain,area:store.area,storeKeywords:store.storeKeywords,sourceUrl:store.sources[0]?.url,sourceUrls:store.sources.map(x=>({label:x.label,url:x.url})),flyers:[],items:[],error:e.message,warnings:[],flyerFreshness:'オンライン商品ページ',durationMs:Date.now()-startedAt,extendedAnalysis:false,checkedAt:new Date().toISOString()};
      await saveStoreResult(result).catch(()=>{});return result;
    }
  }

  let runDir,scraped=null;const warnings=[];let extended=false,deadline=startedAt+BASE_LIMIT_MS;
  try{
    await progress('チラシを検索中','指定された公式URLだけでチラシを確認しています');
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
      flyers.push({url:asset.url,savedUrl:saved.savedUrl,viewerUrl:saved.viewerUrl||null,type:asset.mime||'不明',score:asset.score,saveError:saved.saveError||null,dateCheck,sourceDateCheck,verification,ocrOk:!ocr.error,captureMethod:asset.captureMethod||'direct',sourceGroup:asset.sourceGroup||null});
      if(ocr.text&&!['stale','conflict'].includes(verification.status)){
        await progress('商品抽出中',`チラシ ${assetIndex+1}/${scraped.assets.length} から対象カテゴリ商品を抽出しています`);
        let extracted=[];
        // DOMの商品名・価格が取れる場合はOCRより先に採用する。
        // 日本語フォントが描画できなかったスクショでも商品名を救済できる。
        if(asset.domProducts?.length){
          await progress('商品情報をHTMLから取得中',`チラシ ${assetIndex+1}/${scraped.assets.length} の商品名・価格をページHTMLから確認しています`,{domProductCount:asset.domProducts.length});
          for(const dp of asset.domProducts){
            const rawPrice=String(dp.price||'').trim();
            const priceForText=/円|[¥￥]/.test(rawPrice)?rawPrice:(/\d/.test(rawPrice)?`${rawPrice}円`:'');
            const domText=`${dp.name||''}\n${priceForText}\n${dp.text||''}`;
            let domItems=asset.allItemsPage
              ? extractAllFlyerItems(domText,{sourceUrl:dp.href||asset.referer||(scraped.selectedSource?.url||store.sources[0]?.url),flyerUrl:displayUrl,confidence:'HTML商品情報'})
              : extractBabyItems(domText,{sourceUrl:dp.href||asset.referer||(scraped.selectedSource?.url||store.sources[0]?.url),flyerUrl:displayUrl,confidence:'HTML商品情報'});
            if(asset.allowedCategories?.length)domItems=domItems.filter(x=>asset.allowedCategories.includes(x.category));
            domItems=domItems.map(x=>({...x,imageUrl:dp.image||x.imageUrl||displayUrl,sourceGroup:asset.sourceGroup||x.sourceGroup||null}));
            extracted.push(...domItems);
          }
        }
        const useBlockOcr=asset.captureMethod==='screenshot' && !asset.file.endsWith('.pdf');
        if(useBlockOcr){
          await progress('商品ブロック解析中',`チラシ ${assetIndex+1}/${scraped.assets.length} を商品領域ごとに分けて読み取っています`);
          const blocks=await ocrAssetBlocks(asset);
          for(let bi=0;bi<blocks.length;bi++){
            const block=blocks[bi];
            let blockItems=asset.allItemsPage?extractAllFlyerItems(block.text,{sourceUrl:asset.referer||(scraped.selectedSource?.url||store.sources[0]?.url),flyerUrl:displayUrl,confidence:asset.nishimatsuyaBlock?'西松屋・商品ブロックOCR':'対象ページ商品ブロックOCR'}):extractBabyItems(block.text,{sourceUrl:asset.referer||(scraped.selectedSource?.url||store.sources[0]?.url),flyerUrl:displayUrl,confidence:'商品ブロックOCR'});
            // 紙おむつセールはページ自体が対象商品群。ブランド判定された商品を落とさない。
            if(asset.allowedCategories?.length)blockItems=blockItems.filter(x=>asset.allowedCategories.includes(x.category));
            if(!blockItems.length)continue;
            const blockSaved=await persistFlyer(store.id,block.file,`${asset.url}#block-${bi+1}`);
            const blockUrl=blockSaved.viewerUrl||displayUrl;
            blockItems=blockItems.map(x=>({...x,imageUrl:blockUrl,sourceGroup:asset.sourceGroup||null}));
            extracted.push(...blockItems);
          }
        }
        // Block OCR can miss tiny text; full-page OCR remains a fallback/complement.
        const fullItems=asset.allItemsPage?extractAllFlyerItems(ocr.text,{sourceUrl:asset.referer||(scraped.selectedSource?.url||store.sources[0]?.url),flyerUrl:displayUrl,confidence:asset.nishimatsuyaBlock?'西松屋・個別商品画像OCR':'対象ページ全商品OCR'}):extractBabyItems(ocr.text,{sourceUrl:asset.referer||(scraped.selectedSource?.url||store.sources[0]?.url),flyerUrl:displayUrl,confidence:asset.captureMethod==='screenshot'?'チラシ全体OCR':asset.file.endsWith('.pdf')?'PDF/OCR抽出':'画像OCR抽出'});
        extracted.push(...fullItems);
        if(asset.allowedCategories?.length)extracted=extracted.filter(x=>asset.allowedCategories.includes(x.category));
        extracted=dedupe(extracted);
        if(store.id==='akachan-aizumi')extracted=extracted.map(x=>({...x,sourceGroup:x.sourceGroup||asset.sourceGroup||'セール・チラシ情報',imageUrl:x.imageUrl||displayUrl}));
        items.push(...extracted);
      }
    }
    flyers=pickLatestFlyers(flyers);
    const verifiedCurrent=flyers.filter(f=>f.verification?.status==='verified-current');
    const verifiedRecent=flyers.filter(f=>f.verification?.status==='verified-recent');
    const flyerOnly=flyers.filter(f=>f.verification?.status==='flyer-only');
    const sourceOnly=flyers.filter(f=>f.verification?.status==='source-only');
    let chosen;
    if(store.id==='akachan-aizumi'){
      const pool=verifiedCurrent.length?verifiedCurrent:verifiedRecent.length?verifiedRecent:flyerOnly.length?flyerOnly:sourceOnly.length?sourceOnly:flyers;
      const seenGroups=new Set();chosen=[];
      for(const f of pool){const g=f.sourceGroup||f.viewerUrl||f.url;if(seenGroups.has(g))continue;seenGroups.add(g);chosen.push(f);if(chosen.length>=5)break;}
      // アカチャンホンポはアカトク最大2件＋紙おむつセール最大2件をOCRするため、代表画像だけに商品を絞り込まない。
      items=dedupe(items).slice(0,160);
    }else{
      chosen=(verifiedCurrent.length?verifiedCurrent:verifiedRecent.length?verifiedRecent:flyerOnly.length?flyerOnly:sourceOnly.length?sourceOnly:flyers).slice(0,4);
      const allowedUrls=new Set(chosen.map(f=>f.viewerUrl||(/^https?:/i.test(f.url)?f.url:null)).filter(Boolean));
      items=dedupe(items).filter(x=>x.flyerUrl==='不明'||allowedUrls.has(x.flyerUrl)).slice(0,120);
    }
    let freshness='確認不足';
    if(verifiedCurrent.length)freshness='2段階一致・現在有効';else if(verifiedRecent.length)freshness='2段階一致・最近';else if(flyerOnly.length)freshness='チラシ内日付のみ確認';else if(sourceOnly.length)freshness='掲載側日付のみ確認';else if(flyers.some(f=>f.verification?.status==='conflict'))freshness='日付不一致';else if(flyers.some(f=>f.verification?.status==='stale'))freshness='古い可能性';else freshness='2段階とも日付不明';
    if(!verifiedCurrent.length&&!verifiedRecent.length)warnings.push('最新性の2段階確認が完了していないため、「最新」とは断定していません');
    if(flyers.some(f=>f.captureMethod==='screenshot'))warnings.push('直接取得できないチラシは、チラシ表示領域のスクリーンショットをOCRしました');
    const result={id:store.id,chain:store.chain,area:store.area,storeKeywords:store.storeKeywords,sourceUrl:(scraped.selectedSource?.url||store.sources[0]?.url),flyers:chosen,items,error:null,warnings,flyerFreshness:freshness,acquisition:scraped.acquisition||'不明',browserWarning:scraped.browserError||null,sourceProvider:scraped.selectedSource?.label||scraped.selectedSource?.provider||'不明',sourceAttempts:scraped.attempts||[],durationMs:Date.now()-startedAt,extendedAnalysis:extended,checkedAt:new Date().toISOString()};
    await saveStoreResult(result);await progress('完了',`${chosen.length}件のチラシ、${items.length}件の商品を処理しました`,{flyerCount:chosen.length,itemCount:items.length});return result;
  }catch(e){if(e.code==='STORE_SKIPPED'){const result={id:store.id,chain:store.chain,area:store.area,storeKeywords:store.storeKeywords,sourceUrl:store.sources[0]?.url,flyers:[],items:[],error:null,warnings:['ユーザー操作でスキップしました。保存済みの前回表示は変更しません'],flyerFreshness:'スキップ',durationMs:Date.now()-startedAt,extendedAnalysis:extended,skipped:true,preservePrevious:true,checkedAt:new Date().toISOString()};await saveProgress(store.id,'スキップ','ユーザー操作でこの店舗をスキップしました。前回表示を維持します',batchId,{elapsedMs:Date.now()-startedAt}).catch(()=>{});return result;}await saveProgress(store.id,'エラー',e.message,batchId,{elapsedMs:Date.now()-startedAt}).catch(()=>{});const result={id:store.id,chain:store.chain,area:store.area,storeKeywords:store.storeKeywords,sourceUrl:(scraped?.selectedSource?.url||store.sources[0]?.url),flyers:[],items:[],error:e.message,warnings,flyerFreshness:'不明',durationMs:Date.now()-startedAt,extendedAnalysis:extended,checkedAt:new Date().toISOString()};await saveStoreResult(result).catch(()=>{});return result;}
  finally{await closeOcr().catch(()=>{});if(runDir)await fs.rm(runDir,{recursive:true,force:true}).catch(()=>{});}
}
