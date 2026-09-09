import { load } from 'cheerio';
import path from 'node:path';
import fsSync from 'node:fs';

const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36';
const normalize=(s='')=>String(s).replace(/\uFFFD/g,'').replace(/[\t\r]+/g,' ').replace(/\s+/g,' ').trim();
const abs=(href,base)=>{try{return new URL(href,base).href;}catch{return base;}};
const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));

async function launchBrowser(){
  const [{default:puppeteer},{default:chromium}]=await Promise.all([import('puppeteer-core'),import('@sparticuz/chromium')]);
  chromium.setGraphicsMode=false;let executablePath=process.env.CHROME_EXECUTABLE_PATH;
  if(!executablePath){const bin=path.join(process.cwd(),'node_modules','@sparticuz','chromium','bin');executablePath=fsSync.existsSync(bin)?await chromium.executablePath(bin):await chromium.executablePath();}
  return puppeteer.launch({args:chromium.args,executablePath,headless:true,defaultViewport:{width:1440,height:1100,deviceScaleFactor:1}});
}

async function browserPage(page,url){
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForSelector('.js_np-card-item',{timeout:15000});await sleep(700);
  return page.evaluate(()=>[...document.querySelectorAll('.js_np-card-item')].flatMap(card=>{
    const sale=card.querySelector('.np-price-sale');if(!sale)return[];
    const link=card.querySelector('a.js_np-card-link[href],a.np-card-link[href]');
    const name=(card.querySelector('.np-title')?.textContent||card.querySelector('img[alt]')?.alt||'').replace(/\s+/g,' ').trim();
    const tax=(sale.querySelector('.np-price-zeikomi .price-value')?.textContent||'').replace(/\s+/g,'').trim();
    const red=(sale.querySelector('.np-price-tanka .price-value')?.textContent||'').replace(/\s+/g,'').trim();
    const img=card.querySelector('.np-card-img img');const appeal=(card.querySelector('.np-appeal-point')?.textContent||'').replace(/\s+/g,' ').trim();
    if(!link?.href||!name||!(tax||red))return[];
    return [{href:link.href,name,tax,red,imageUrl:img?.currentSrc||img?.src||img?.getAttribute('data-src')||'',appeal}];
  }));
}

function pageUrl(sourceUrl,offset){const u=new URL(sourceUrl);u.searchParams.set('limit','60');u.searchParams.set('o',String(offset));return u.href;}

export function nishimatsuyaEndDate(appeal=''){
  const match=normalize(appeal).match(/お買い?得価格\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*まで/);
  if(!match)return '不明';
  const now=new Date();let year=now.getFullYear();let date=new Date(year,Number(match[1])-1,Number(match[2]));
  if(date.getTime()<now.getTime()-180*86400000){year++;date=new Date(year,Number(match[1])-1,Number(match[2]));}
  return `${year}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

export function nishimatsuyaOnlineCategory(url='',name=''){
  if(/EXCRETION/i.test(url)||/おむつ|オムツ|パンパース|ムーニー|メリーズ|グーン|おしりふき/i.test(name))return 'おむつ・おしりふき';
  if(/粉ミルク|液体ミルク|ほほえみ|はぐくみ|すこやか|アイクレオ|チルミル|ぴゅあ|たっち|はいはい|ぐんぐん/i.test(name))return '粉ミルク・液体ミルク';
  if(/離乳食|ベビーフード|和光堂|栄養マルシェ|グーグーキッチン|食育レシピ|赤ちゃんのおやつ/i.test(name))return '離乳食・ベビーフード';
  if(/哺乳びん|哺乳瓶|乳首|マグ|食器|エプロン|おしゃぶり/i.test(name))return 'ベビーケア・その他';
  return /MEAL/i.test(url)?'離乳食・ベビーフード':'その他';
}

function parsePage(html,url){
  const $=load(html),items=[],pages=[];
  $('.js_np-card-item').each((_,node)=>{
    const card=$(node),sale=card.find('.np-price-sale').first();
    if(!sale.length)return;
    const link=card.find('a.js_np-card-link[href], a.np-card-link[href]').first();
    const href=abs(link.attr('href')||'',url);
    if(!/\/item\/[^/]+\.html/i.test(href))return;
    const name=normalize(card.find('.np-title').first().text()||card.find('img[alt]').first().attr('alt'));
    const tax=normalize(sale.find('.np-price-zeikomi .price-value').first().text());
    const red=normalize(sale.find('.np-price-tanka .price-value').first().text());
    const digits=(tax||red).match(/\d{1,3}(?:,\d{3})*|\d+/)?.[0];
    if(!name||!digits)return;
    const img=card.find('.np-card-img img').first();
    const rawImage=img.attr('data-src')||img.attr('data-original')||img.attr('src')||'';
    const appeal=normalize(card.find('.np-appeal-point').first().text());
    items.push({category:nishimatsuyaOnlineCategory(url,name),product:name,price:`${Number(digits.replaceAll(',','')).toLocaleString('ja-JP')}円`,startDate:'不明',endDate:nishimatsuyaEndDate(appeal),sourceUrl:url,sourceUrls:[url],flyerUrl:href,confidence:'西松屋公式・赤文字価格',notes:appeal,discountAfter:appeal||'赤文字価格',imageUrl:rawImage?abs(rawImage,url):null});
  });
  $('a[href]').each((_,node)=>{
    const href=abs($(node).attr('href')||'',url);
    if(/\/category\/(?:MEAL|EXCRETION)\/(?:\?[^#]*)?$/i.test(href)&&/[?&](?:p|page|i|o)=\d+/i.test(href))pages.push(href);
  });
  return {items,pages:[...new Set(pages)]};
}

async function fetchPage(url){
  const res=await fetch(url,{headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml','accept-language':'ja-JP,ja;q=0.9'},redirect:'follow',signal:AbortSignal.timeout(30000)});
  if(!res.ok)throw new Error(`HTTP ${res.status}`);
  return parsePage(await res.text(),url);
}

export async function scrapeNishimatsuyaOnline(store,progress=async()=>{}){
  const merged=new Map(),pages=[];let browser,page;
  try{
    browser=await launchBrowser();page=await browser.newPage();await page.setUserAgent(UA);await page.setCacheEnabled(false);
    for(const source of store.sources||[]){
      await progress('店舗ページ確認中',`西松屋オンライン「${source.label}」を確認しています`,{url:source.url});
      try{
        let sourceCount=0,pageCount=0;
        for(const offset of [0,60,120,180]){
          const url=pageUrl(source.url,offset),rows=await browserPage(page,url);pageCount++;
          for(const row of rows){
            const digits=(row.tax||row.red).match(/\d{1,3}(?:,\d{3})*|\d+/)?.[0];if(!digits)continue;
            const item={category:nishimatsuyaOnlineCategory(source.url,row.name),product:row.name,price:`${Number(digits.replaceAll(',','')).toLocaleString('ja-JP')}円`,startDate:'不明',endDate:nishimatsuyaEndDate(row.appeal),sourceUrl:source.url,sourceUrls:[source.url],flyerUrl:row.href,confidence:'西松屋公式・赤文字価格',notes:row.appeal,discountAfter:row.appeal||'赤文字価格',imageUrl:row.imageUrl?abs(row.imageUrl,source.url):null};
            const previous=merged.get(item.flyerUrl);if(!previous)sourceCount++;
            merged.set(item.flyerUrl,previous?{...previous,sourceUrls:[...new Set([...(previous.sourceUrls||[]),item.sourceUrl])],imageUrl:previous.imageUrl||item.imageUrl}:item);
          }
          if(rows.length<60)break;
        }
        pages.push({url:source.url,label:source.label,pageCount,redPriceCount:sourceCount,method:'browser'});
        await progress('商品抽出中',`${source.label}: 赤文字価格を${sourceCount}件確認しました`,{url:source.url,count:sourceCount});
      }catch(e){pages.push({url:source.url,label:source.label,error:e.message});}
    }
  }catch(browserError){
    for(const source of store.sources||[]){try{const result=await fetchPage(source.url);for(const item of result.items)merged.set(item.flyerUrl,item);pages.push({url:source.url,label:source.label,pageCount:1,redPriceCount:result.items.length,method:'html'});}catch(e){pages.push({url:source.url,label:source.label,error:`${browserError.message} / ${e.message}`});}}
  }finally{if(page)await page.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});}
  return {items:[...merged.values()].slice(0,500),pages,deduped:true};
}
