import fs from 'node:fs/promises';
import { STORES } from './config.js';
import { extractBabyItems, extractAllFlyerItems } from './extract.js';
import { analyzeFlyerDates, pickLatestFlyers, verifyFreshnessTwoStage } from './flyer-date.js';
import { ocrAsset, ocrAssetBlocks, ocrAssetRegion, closeOcr } from './ocr.js';
import { persistFlyer } from './blob.js';
import { saveStoreResult, saveProgress, isSkipRequested } from './db.js';
import { scrapeStore } from './scraper.js';
import { scrapeCostcoOnline } from './costco.js';

const BASE_LIMIT_MS=270000;
const EXTENDED_LIMIT_MS=270000;
function dedupe(items){const seen=new Set();return items.filter(x=>{const k=`${x.category}|${x.product}|${x.price}|${x.notes||''}`;if(seen.has(k))return false;seen.add(k);return true;});}
function nishimatsuyaFallbackFromOcr(text,meta={}){
  const lines=String(text||'').replace(/\r/g,'').split('\n').map(x=>x.trim()).filter(Boolean);
  const priceMatch=String(text||'').match(/(?:税込\s*)?[¥￥]?\s*(\d{1,3}(?:,\d{3})+|\d{2,6})\s*円|[¥￥]\s*(\d{1,3}(?:,\d{3})+|\d{2,6})/);
  const price=priceMatch?`${String(priceMatch[1]||priceMatch[2]).replaceAll(',','')}円`:'不明';
  const noise=/^(税込|税抜|本体価格|各|sale|セール|ポイント|オンラインストアはこちら|商品番号|※)/i;
  const name=lines.find(x=>!noise.test(x)&&!/^[¥￥]?\s*\d[\d,]*\s*円?$/.test(x)&&x.length>=2&&x.length<=80)||'商品名不明';
  return {
    category:'その他',
    product:name,
    price,
    startDate:'不明',
    endDate:'不明',
    sourceUrl:meta.sourceUrl||'不明',
    flyerUrl:meta.flyerUrl||'不明',
    confidence:'西松屋・商品ブロック画像（全件表示）',
    notes:'カテゴリを判定できなかったため「その他」に表示',
    imageUrl:meta.imageUrl||null,
    sourceGroup:meta.sourceGroup||null
  };
}
function nishimatsuyaExtractPrice(text){
  const s=String(text||'').normalize('NFKC');
  const candidates=[];
  const add=(raw,index,kind='normal',ctx='')=>{
    const digits=String(raw||'').replace(/[^\d]/g,'');
    if(!digits)return;
    const value=Number(digits);
    if(!Number.isFinite(value)||value<100||value>300000)return;
    let score=0;
    if(kind==='tax')score+=40;
    if(kind==='yen')score+=30;
    if(/税込/.test(ctx))score+=20;
    if(/各/.test(ctx))score+=5;
    if(/ポイント|倍|個|枚|cm|kg|g|ml|l|サイズ|月齢|才|歳/i.test(ctx))score-=25;
    candidates.push({value,index,score});
  };
  for(const m of s.matchAll(/[¥￥]\s*([0-9][0-9,]{2,8})/g)){
    add(m[1],m.index,'yen',s.slice(Math.max(0,m.index-24),m.index+m[0].length+24));
  }
  for(const m of s.matchAll(/([0-9][0-9,]{2,8})\s*円/g)){
    add(m[1],m.index,'normal',s.slice(Math.max(0,m.index-24),m.index+m[0].length+24));
  }
  for(const m of s.matchAll(/税込\s*[¥￥]?\s*([0-9][0-9,]{2,8})/g)){
    add(m[1],m.index,'tax',s.slice(Math.max(0,m.index-24),m.index+m[0].length+24));
  }
  if(!candidates.length)return '不明';
  candidates.sort((a,b)=>b.score-a.score||a.index-b.index||a.value-b.value);
  return `${candidates[0].value}円`;
}

function nishimatsuyaExtractName(text){
  const lines=String(text||'').normalize('NFKC').replace(/\r/g,'').split('\n').map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean);
  const bad=/^(税込|税抜|本体価格|各|sale|セール|ポイント|オンラインストアはこちら|商品番号|デジタルチラシ|home|掲載商品一覧|円|¥|￥|サイズ|カラー|色|品番|期間|お買い得)/i;
  const priceish=/^[¥￥]?\s*\d[\d,]*\s*(?:円|税込)?$/;
  const numericHeavy=/^\d[\d\s,./\-×xX]*$/;
  const priorityBrands=['パンパース','ムーニー','メリーズ','グーン','マミーポコ','ピジョン','コンビ','アップリカ','リッチェル','和光堂','雪印メグミルク','明治','森永','キユーピー','ビーンスターク','アンパンマン'];
  const joined=lines.join(' ');
  for(const b of priorityBrands){
    if(joined.includes(b)){
      const candidate=lines.find(x=>x.includes(b)&&x.length<=100);
      if(candidate)return candidate;
    }
  }
  return lines.find(x=>x.length>=2&&x.length<=100&&!bad.test(x)&&!priceish.test(x)&&!numericHeavy.test(x))||'商品名不明';
}

function nishimatsuyaClassify(text){
  const s=String(text||'').normalize('NFKC').toLowerCase();
  const has=(arr)=>arr.some(x=>s.includes(x.toLowerCase()));
  if(has(['パンパース','pampers','ムーニー','moony','メリーズ','merries','グーン','goon','goo.n','マミーポコ','mamypoko','おむつ','オムツ','紙おむつ','紙オムツ','おしりふき','お尻ふき'])) return 'おむつ・おしりふき';
  if(has(['ほほえみ','はいはい','ぐんぐん','ぴゅあ','たっち','すこやか','はぐくみ','e赤ちゃん','アイクレオ','ミルク','粉ミルク','液体ミルク','明治','森永','雪印メグミルク','ビーンスターク'])) return '粉ミルク・液体ミルク';
  if(has(['離乳食','ベビーフード','和光堂','wakodo','キユーピー','キューピー','ピジョン 食育','栄養マルシェ','グーグーキッチン','赤ちゃんのおやつ','ベビーおやつ'])) return '離乳食・ベビーフード';
  if(has(['おもちゃ','玩具','ラトル','ガラガラ','メリー','知育','アンパンマン','積み木','つみき','トイ','toy'])) return 'おもちゃ';
  if(has(['ベビーソープ','ベビーローション','ベビーオイル','綿棒','哺乳瓶','乳首','消毒','洗浄','スキンケア','保湿','ケア'])) return 'ベビーケア・その他';
  return 'その他';
}

function nishimatsuyaItemFromSingleImage(text,meta={}){
  return {
    category:nishimatsuyaClassify(text),
    product:nishimatsuyaExtractName(text),
    price:nishimatsuyaExtractPrice(text),
    startDate:'不明',
    endDate:'不明',
    sourceUrl:meta.sourceUrl||'不明',
    flyerUrl:meta.flyerUrl||'不明',
    confidence:'西松屋・1画像1商品OCR',
    notes:'西松屋の読み取り画像1枚を1商品として個別OCR',
    imageUrl:meta.imageUrl||null,
    sourceGroup:meta.sourceGroup||null
  };
}

function nishimatsuyaTaxIncludedPrice(text){
  const s=String(text||'').normalize('NFKC').replace(/\s+/g,' ');
  const candidates=[];
  const add=(raw,index)=>{
    const digits=String(raw||'').replace(/[^\d]/g,'');
    const value=Number(digits);
    if(Number.isFinite(value)&&value>=100&&value<=300000)candidates.push({value,index});
  };
  // 税込表示に直接結び付いた数字だけを候補にし、赤い本体価格は採用しない。
  for(const m of s.matchAll(/税込(?:価格)?\s*[):：]?[¥￥]?\s*([0-9][0-9,]{2,8})\s*円?/g))add(m[1],m.index);
  for(const m of s.matchAll(/[¥￥]?\s*([0-9][0-9,]{2,8})\s*円?\s*[（(]?\s*税込\s*[）)]?/g))add(m[1],m.index);
  if(!candidates.length)return null;
  candidates.sort((a,b)=>a.index-b.index);
  return `${candidates[0].value}円`;
}

// updateStore から常に参照できるモジュール共通スコープに置く。
export function nishimatsuyaItemFromRegions(nameText,priceText,fullText,meta={}){
  const price=nishimatsuyaTaxIncludedPrice(priceText);
  if(!price)return null;
  const product=nishimatsuyaExtractName(nameText);
  const classificationText=`${product}\n${nameText||''}\n${fullText||''}`;
  return {
    category:nishimatsuyaClassify(classificationText),
    product,
    price,
    startDate:'不明',
    endDate:'不明',
    sourceUrl:meta.sourceUrl||'不明',
    flyerUrl:meta.flyerUrl||'不明',
    confidence:'西松屋・左下商品名／右下税込価格OCR',
    notes:'左下のグレー文字を商品名、右下の税込表示を価格として個別OCR',
    imageUrl:meta.imageUrl||null,
    sourceGroup:meta.sourceGroup||null
  };
}

function dedupeNishimatsuyaByImage(items=[]){
  const seen=new Set();
  return items.filter(x=>{
    const k=x.imageUrl||`${x.sourceGroup||''}|${x.product||''}|${x.price||''}`;
    if(seen.has(k))return false;
    seen.add(k);
    return true;
  });
}
function looksHeavy(assets=[]){const bytes=assets.reduce((n,a)=>n+(a.size||0),0);return assets.length>=3||bytes>=4*1024*1024||assets.some(a=>String(a.file||'').toLowerCase().endsWith('.pdf'));}

export async function updateStore(storeId,batchId=null,options={}){
  const startedAt=Date.now();const store=STORES.find(x=>x.id===storeId);if(!store)throw new Error(`対象店舗が見つかりません: ${storeId}`);
  const startAssetIndex=Math.max(0,Number(options?.startAssetIndex)||0);
  const previousResult=options?.previousResult&&options.previousResult.id===storeId?options.previousResult:null;
  const continuationPass=Math.max(1,Number(options?.continuationPass)||1);
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
    if(looksHeavy(scraped.assets)){extended=true;warnings.push('解析量が多いため、必要なら5分処理を最大2回に分割して合計約10分まで継続します');await progress('10分継続モード','Vercelの300秒上限に合わせ、必要な場合は5分×最大2回に分割して処理します',{continuationPass});}
    let items=[...(previousResult?.items||[])];let flyers=[...(previousResult?.flyers||[])];
    let didHitTimeLimit=false;let nextAssetIndex=null;
    for(let assetIndex=startAssetIndex;assetIndex<scraped.assets.length;assetIndex++){
      const asset=scraped.assets[assetIndex];
      if(Date.now()>deadline){didHitTimeLimit=true;nextAssetIndex=assetIndex;warnings.push('Vercelの300秒制限前に安全停止しました。残りは次の5分処理へ継続します');await progress('継続待ち',`残りを次の処理へ引き継ぎます（${assetIndex+1}/${scraped.assets.length} から）`,{nextAssetIndex:assetIndex,continuationPass});break;}
      await progress('チラシ保存中',`チラシ ${assetIndex+1}/${scraped.assets.length} を保存しています`,{current:assetIndex+1,total:scraped.assets.length});
      const saved=await persistFlyer(store.id,asset.file,asset.url);const displayUrl=saved.viewerUrl||(/^https?:/i.test(asset.url)?asset.url:(asset.referer||scraped.selectedSource?.url||store.sources[0]?.url));
      await progress('OCRを実行中',`チラシ ${assetIndex+1}/${scraped.assets.length} の文字を読み取っています`,{current:assetIndex+1,total:scraped.assets.length});
      const ocr=await ocrAsset(asset);if(ocr.error)warnings.push(`OCR: ${ocr.error}`);
      if(!extended&&ocr.text?.length>=1800){extended=true;warnings.push('文字量が多いため、必要なら5分×最大2回の継続処理へ切り替えます');await progress('10分継続モード',`OCR文字量が多いため、必要なら次の5分処理へ継続します`,{textLength:ocr.text.length,continuationPass});}
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
        if(asset.domProducts?.length && store.id!=='akachan-aizumi'){
          await progress('商品情報をHTMLから取得中',`チラシ ${assetIndex+1}/${scraped.assets.length} の商品名・価格をページHTMLから確認しています`,{domProductCount:asset.domProducts.length});
          for(const dp of asset.domProducts){
            const rawPrice=String(dp.price||'').trim();
            const priceForText=/円|[¥￥]/.test(rawPrice)?rawPrice:(/\d/.test(rawPrice)?`${rawPrice}円`:'');
            const domText=`${dp.name||''}\n${priceForText}\n${dp.text||''}`;
            let domItems=asset.allItemsPage
              ? extractAllFlyerItems(domText,{sourceUrl:dp.href||asset.referer||(scraped.selectedSource?.url||store.sources[0]?.url),flyerUrl:displayUrl,confidence:'HTML商品情報',fallbackCategory:store.id==='nishimatsuya'?'その他':undefined})
              : extractBabyItems(domText,{sourceUrl:dp.href||asset.referer||(scraped.selectedSource?.url||store.sources[0]?.url),flyerUrl:displayUrl,confidence:'HTML商品情報'});
            if(asset.allowedCategories?.length)domItems=domItems.filter(x=>asset.allowedCategories.includes(x.category));
            domItems=domItems.map(x=>({...x,imageUrl:dp.image||x.imageUrl||displayUrl,sourceGroup:asset.sourceGroup||x.sourceGroup||null}));
            extracted.push(...domItems);
          }
        }
        const useBlockOcr=asset.captureMethod==='screenshot' && !asset.file.endsWith('.pdf') && !(store.id==='nishimatsuya'&&asset.nishimatsuyaBlock);
        if(useBlockOcr){
          await progress('商品ブロック解析中',`チラシ ${assetIndex+1}/${scraped.assets.length} を商品領域ごとに分けて読み取っています`);
          const blocks=await ocrAssetBlocks(asset);
          for(let bi=0;bi<blocks.length;bi++){
            const block=blocks[bi];
            let blockItems=asset.allItemsPage?extractAllFlyerItems(block.text,{sourceUrl:asset.referer||(scraped.selectedSource?.url||store.sources[0]?.url),flyerUrl:displayUrl,confidence:asset.nishimatsuyaBlock?'西松屋・商品ブロックOCR':'対象ページ商品ブロックOCR',fallbackCategory:store.id==='nishimatsuya'?'その他':undefined}):extractBabyItems(block.text,{sourceUrl:asset.referer||(scraped.selectedSource?.url||store.sources[0]?.url),flyerUrl:displayUrl,confidence:'商品ブロックOCR'});
            // 紙おむつセールはページ自体が対象商品群。ブランド判定された商品を落とさない。
            if(asset.allowedCategories?.length)blockItems=blockItems.filter(x=>asset.allowedCategories.includes(x.category));
            if(store.id==='akachan-aizumi'){
              // アカチャンホンポは画像ブロック内に価格表記がある商品だけ表示する。
              blockItems=blockItems.filter(x=>x.price&&x.price!=='不明');
            }
            if(!blockItems.length)continue;
            const blockSaved=await persistFlyer(store.id,block.file,`${asset.url}#block-${bi+1}`);
            const blockUrl=blockSaved.viewerUrl||displayUrl;
            blockItems=blockItems.map(x=>({...x,imageUrl:blockUrl,sourceGroup:asset.sourceGroup||null,confidence:store.id==='akachan-aizumi'?'アカチャンホンポ・商品ブロックOCR（価格確認済み）':x.confidence}));
            extracted.push(...blockItems);
          }
        }
        // Block OCR can miss tiny text; full-page OCR remains a fallback/complement.
        if(store.id==='nishimatsuya'&&asset.nishimatsuyaBlock){
          // 西松屋の商品ブロックはレイアウトが固定:
          // 左下 = 商品名（グレー文字）
          // 右下 = 価格。下段の税込表示だけを採用する。
          const nameRegion=await ocrAssetRegion(asset,{x:0.00,y:0.58,width:0.68,height:0.42,scale:2.8});
          const priceRegion=await ocrAssetRegion(asset,{x:0.58,y:0.58,width:0.42,height:0.42,scale:3.2});
          const item=nishimatsuyaItemFromRegions(
            nameRegion.text,
            priceRegion.text,
            ocr.text,
            {
              sourceUrl:asset.referer||(scraped.selectedSource?.url||store.sources[0]?.url),
              flyerUrl:displayUrl,
              imageUrl:displayUrl,
              sourceGroup:asset.sourceGroup||null
            }
          );
          // 右下の税込価格が取れない商品画像は表示しない。
          extracted=item?[item]:[];
        }else{
          const fullItems=asset.allItemsPage?extractAllFlyerItems(ocr.text,{sourceUrl:asset.referer||(scraped.selectedSource?.url||store.sources[0]?.url),flyerUrl:displayUrl,confidence:'対象ページ全商品OCR'}):extractBabyItems(ocr.text,{sourceUrl:asset.referer||(scraped.selectedSource?.url||store.sources[0]?.url),flyerUrl:displayUrl,confidence:asset.birthdayBlock?'バースデイ・商品ブロックOCR':asset.captureMethod==='screenshot'?'チラシ全体OCR':asset.file.endsWith('.pdf')?'PDF/OCR抽出':'画像OCR抽出'});
          if(store.id!=='akachan-aizumi')extracted.push(...fullItems);
          if(asset.allowedCategories?.length)extracted=extracted.filter(x=>asset.allowedCategories.includes(x.category));
          extracted=dedupe(extracted);
          if(store.id==='akachan-aizumi')extracted=extracted.map(x=>({...x,sourceGroup:x.sourceGroup||asset.sourceGroup||'セール・チラシ情報',imageUrl:x.imageUrl||displayUrl}));
        }
        items.push(...extracted);
      }
    }
    const readImages=[...(previousResult?.readImages||[]),...flyers
      .filter(f=>f.viewerUrl||(/^https?:/i.test(f.url||'')&&String(f.type||'').startsWith('image/')))
      .map((f,i)=>({
        index:i+1,
        viewerUrl:f.viewerUrl||f.url,
        sourceGroup:f.sourceGroup||null,
        captureMethod:f.captureMethod||'不明',
        ocrOk:Boolean(f.ocrOk),
        type:f.type||'不明'
      }))].filter((x,i,a)=>x?.viewerUrl&&a.findIndex(y=>y?.viewerUrl===x.viewerUrl)===i).map((x,i)=>({...x,index:i+1}));
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
      items=dedupe(items).filter(x=>x.price&&x.price!=='不明'&&x.imageUrl).slice(0,160);
    }else if(store.id==='nishimatsuya'){
      // 西松屋 /04/ /05/ /06/ は取得した商品ブロック自体が表示対象。
      // 代表チラシURLだけで絞ると、個別ブロック画像の flyerUrl が一致せず
      // OCR済み商品が最終段階で消えるため、ここではURLフィルターを行わない。
      chosen=(verifiedCurrent.length?verifiedCurrent:verifiedRecent.length?verifiedRecent:flyerOnly.length?flyerOnly:sourceOnly.length?sourceOnly:flyers).slice(0,4);
      items=dedupeNishimatsuyaByImage(items).filter(x=>x.imageUrl).slice(0,240);
    }else{
      chosen=(verifiedCurrent.length?verifiedCurrent:verifiedRecent.length?verifiedRecent:flyerOnly.length?flyerOnly:sourceOnly.length?sourceOnly:flyers).slice(0,4);
      const allowedUrls=new Set(chosen.map(f=>f.viewerUrl||(/^https?:/i.test(f.url)?f.url:null)).filter(Boolean));
      items=dedupe(items).filter(x=>x.flyerUrl==='不明'||allowedUrls.has(x.flyerUrl)).slice(0,120);
    }
    let freshness='確認不足';
    if(verifiedCurrent.length)freshness='2段階一致・現在有効';else if(verifiedRecent.length)freshness='2段階一致・最近';else if(flyerOnly.length)freshness='チラシ内日付のみ確認';else if(sourceOnly.length)freshness='掲載側日付のみ確認';else if(flyers.some(f=>f.verification?.status==='conflict'))freshness='日付不一致';else if(flyers.some(f=>f.verification?.status==='stale'))freshness='古い可能性';else freshness='2段階とも日付不明';
    if(!verifiedCurrent.length&&!verifiedRecent.length)warnings.push('最新性の2段階確認が完了していないため、「最新」とは断定していません');
    if(flyers.some(f=>f.captureMethod==='screenshot'))warnings.push(store.id==='birthday-aizumi'?'バースデイはPDF直接解析を使わず、ブラウザで表示したチラシをスクリーンショットしてOCRしました':'直接取得できないチラシは、チラシ表示領域のスクリーンショットをOCRしました');
    const result={id:store.id,chain:store.chain,area:store.area,storeKeywords:store.storeKeywords,sourceUrl:(scraped.selectedSource?.url||store.sources[0]?.url),flyers:chosen,readImages,items,error:null,warnings,flyerFreshness:freshness,needsContinuation:Boolean(didHitTimeLimit&&nextAssetIndex!=null&&continuationPass<2),nextAssetIndex:(didHitTimeLimit?nextAssetIndex:null),continuationPass,acquisition:scraped.acquisition||'不明',browserWarning:scraped.browserError||null,sourceProvider:scraped.selectedSource?.label||scraped.selectedSource?.provider||'不明',sourceAttempts:scraped.attempts||[],durationMs:Date.now()-startedAt,extendedAnalysis:extended,checkedAt:new Date().toISOString()};
    await saveStoreResult(result);await progress('完了',`${chosen.length}件のチラシ、${items.length}件の商品を処理しました`,{flyerCount:chosen.length,itemCount:items.length});return result;
  }catch(e){if(e.code==='STORE_SKIPPED'){const result={id:store.id,chain:store.chain,area:store.area,storeKeywords:store.storeKeywords,sourceUrl:store.sources[0]?.url,flyers:[],items:[],error:null,warnings:['ユーザー操作でスキップしました。保存済みの前回表示は変更しません'],flyerFreshness:'スキップ',durationMs:Date.now()-startedAt,extendedAnalysis:extended,skipped:true,preservePrevious:true,checkedAt:new Date().toISOString()};await saveProgress(store.id,'スキップ','ユーザー操作でこの店舗をスキップしました。前回表示を維持します',batchId,{elapsedMs:Date.now()-startedAt}).catch(()=>{});return result;}await saveProgress(store.id,'エラー',e.message,batchId,{elapsedMs:Date.now()-startedAt}).catch(()=>{});const result={id:store.id,chain:store.chain,area:store.area,storeKeywords:store.storeKeywords,sourceUrl:(scraped?.selectedSource?.url||store.sources[0]?.url),flyers:[],items:[],error:e.message,warnings,flyerFreshness:'不明',durationMs:Date.now()-startedAt,extendedAnalysis:extended,checkedAt:new Date().toISOString()};await saveStoreResult(result).catch(()=>{});return result;}
  finally{await closeOcr().catch(()=>{});if(runDir)await fs.rm(runDir,{recursive:true,force:true}).catch(()=>{});}
}
