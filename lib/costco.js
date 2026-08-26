import path from 'node:path';
import fsSync from 'node:fs';
import { load } from 'cheerio';

const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36';
const AFTER_WORD=/(?:[¥￥]\s*)?\d[\d,]*\s*円?\s*引き後|引き後/i;
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
function normalize(s=''){return String(s).replace(/\uFFFD/g,'').replace(/[\t\r]+/g,' ').replace(/\s+/g,' ').trim();}
function decodeBody(buffer,contentType=''){const m=String(contentType).match(/charset=([^;]+)/i);const charset=(m?.[1]||'utf-8').trim().replace(/["']/g,'');try{return new TextDecoder(charset,{fatal:false}).decode(buffer);}catch{return new TextDecoder('utf-8',{fatal:false}).decode(buffer);}}
function abs(href,base){try{return new URL(href,base).href;}catch{return base;}}
function categoryForUrl(url){return /Diapers-Wipes\/c\/cos_8\.4/i.test(url)?'おむつ・おしりふき':'離乳食・ベビーフード';}
function displayMarker(text=''){const t=normalize(text);const m=t.match(/(?:[¥￥]\s*)?\d[\d,]*\s*円?\s*引き後/i);if(m)return m[0].replace('￥','¥').replace(/\s+/g,'');return t.includes('引き後')?'引き後':'不明';}
function likelyPrice(text=''){const vals=[...String(text).matchAll(/[¥￥]\s*(\d{1,3}(?:,\d{3})+|\d{3,6})(?!\s*円?\s*引き後)/g)].map(m=>m[1]);return vals.length?`¥${Number(vals.at(-1).replaceAll(',','')).toLocaleString('ja-JP')}`:'不明';}

async function launchBrowser(){const [{default:puppeteer},{default:chromium}]=await Promise.all([import('puppeteer-core'),import('@sparticuz/chromium')]);chromium.setGraphicsMode=false;let executablePath=process.env.CHROME_EXECUTABLE_PATH;if(!executablePath){const explicitBin=path.join(process.cwd(),'node_modules','@sparticuz','chromium','bin');executablePath=fsSync.existsSync(explicitBin)?await chromium.executablePath(explicitBin):await chromium.executablePath();}return puppeteer.launch({args:chromium.args,executablePath,headless:true,defaultViewport:{width:1440,height:1100,deviceScaleFactor:1}});}

async function browserRedAfter(url){
  let browser=null,page=null;
  try{
    browser=await launchBrowser();page=await browser.newPage();await page.setUserAgent(UA);await page.setCacheEnabled(false);await page.setExtraHTTPHeaders({'Cache-Control':'no-cache, no-store, max-age=0','Pragma':'no-cache','Accept-Language':'ja-JP,ja;q=0.9'});
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});await sleep(3500);
    await page.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=650){scrollTo(0,y);await new Promise(r=>setTimeout(r,180));}scrollTo(0,0);});await sleep(1800);
    return await page.evaluate(()=>{
      const norm=s=>(s||'').replace(/\s+/g,' ').trim();
      const rgbRed=(el)=>{try{const c=getComputedStyle(el).color||'';const m=c.match(/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/i);if(m){const r=+m[1],g=+m[2],b=+m[3];return r>=145&&r>g*1.15&&r>b*1.15;}const meta=`${el.className||''} ${el.id||''} ${el.getAttribute?.('style')||''}`.toLowerCase();return /(red|danger|discount|saving|sale|promo|special|price-discount|color\s*:\s*(red|#f|#e|rgb\(2))/i.test(meta);}catch{return false;}};
      const productSelectors='.product-item, li.product__list--item, .product-listing-item, article, .product-tile, .product-item-container, .product-item-info, [data-testid*="product" i], [class*="product-card" i], [class*="product-tile" i]';
      const tiles=[...document.querySelectorAll(productSelectors)];const out=[];const seen=new Set();
      for(const product of tiles){
        const full=norm(product.innerText);if(!full.includes('引き後')||full.length<8||full.length>8000)continue;
        const descendants=[product,...product.querySelectorAll('*')].filter(el=>norm(el.innerText).includes('引き後'));
        let markerEl=descendants.find(el=>rgbRed(el));
        if(!markerEl){markerEl=descendants.find(el=>{let p=el.parentElement;for(let i=0;p&&i<3;i++,p=p.parentElement)if(rgbRed(p))return true;return false;});}
        if(!markerEl)continue;
        const markerText=norm(markerEl.innerText);const mm=markerText.match(/(?:[¥￥]\s*)?\d[\d,]*\s*円?\s*引き後/i);const marker=mm?.[0]||'引き後';
        const link=product.querySelector('a[href]');
        const nameEl=product.querySelector('[class*="name" i],[class*="title" i],h2,h3,h4,a[title],a');
        let name=norm(nameEl?.innerText||nameEl?.getAttribute?.('title')||link?.getAttribute('aria-label')||'');
        if(!name||name==='引き後') name=full.split(/¥|￥|引き後/)[0].trim().slice(0,160)||'商品名不明';
        const href=link?.href||location.href;const key=`${name}|${marker}|${href}`;if(seen.has(key))continue;seen.add(key);
        out.push({name:name.slice(0,180),marker,text:full.slice(0,3000),href});
      }
      // Fallback for a layout where product tiles are not marked with predictable classes.
      if(!out.length){
        for(const el of [...document.querySelectorAll('body *')]){
          const txt=norm(el.innerText);if(!txt.includes('引き後')||txt.length>280||!rgbRed(el))continue;
          const product=el.closest('li,article,section,[class*="product" i],div');if(!product)continue;const full=norm(product.innerText);if(full.length<8||full.length>5000)continue;
          const link=product.querySelector('a[href]');const name=norm(product.querySelector('h2,h3,h4,[class*="name" i],a')?.innerText)||full.split(/¥|￥|引き後/)[0].slice(0,160)||'商品名不明';const mm=txt.match(/(?:[¥￥]\s*)?\d[\d,]*\s*円?\s*引き後/i);const marker=mm?.[0]||'引き後';const href=link?.href||location.href;const key=`${name}|${marker}|${href}`;if(!seen.has(key)){seen.add(key);out.push({name,marker,text:full.slice(0,3000),href});}
        }
      }
      return out.slice(0,160);
    });
  }catch{return [];}finally{if(page)await page.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});}
}

function staticRedAfter($){
  const out=[];const seen=new Set();
  $('*').each((_,el)=>{const $el=$(el);const own=normalize($el.text());if(!own.includes('引き後')||own.length>350)return;const meta=`${$el.attr('class')||''} ${$el.attr('id')||''} ${$el.attr('style')||''}`.toLowerCase();if(!/(red|danger|discount|saving|sale|promo|special|color\s*:\s*(red|#f|#e|rgb\(2))/i.test(meta))return;const p=$el.closest('.product-item,li,article,[class*="product"]');const box=p.length?p:$el.parent();const full=normalize(box.text());const name=normalize(box.find('[class*="name"],h2,h3,h4,a').first().text())||full.split(/¥|￥|引き後/)[0].slice(0,160)||'商品名不明';const href=box.find('a[href]').first().attr('href')||'';const mm=own.match(/(?:[¥￥]\s*)?\d[\d,]*\s*円?\s*引き後/i);const marker=mm?.[0]||'引き後';const key=`${name}|${marker}|${href}`;if(!seen.has(key)){seen.add(key);out.push({name,marker,text:full.slice(0,3000),href});}});return out;
}

export async function scrapeCostcoOnline(store,progress=async()=>{}){
  const items=[],pages=[],seen=new Set();
  for(const url of store.categoryUrls||[]){
    await progress('店舗ページ確認中','指定したコストコオンラインページを確認しています',{url});
    let rows=await browserRedAfter(url);let title='',bodyLength=0;
    if(!rows.length){
      try{const res=await fetch(url,{headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml','accept-language':'ja-JP,ja;q=0.9','cache-control':'no-cache'},redirect:'follow',signal:AbortSignal.timeout(25000)});if(!res.ok){pages.push({url,error:`HTTP ${res.status}`});continue;}const buf=await res.arrayBuffer();const html=decodeBody(buf,res.headers.get('content-type')||'');const $=load(html);title=normalize($('title').text());bodyLength=normalize($('body').text()).length;rows=staticRedAfter($);}catch(e){pages.push({url,error:e.message});continue;}
    }
    pages.push({url,title,bodyLength,redAfterCount:rows.length});
    await progress('商品抽出中',`赤文字の「引き後」を確認しています (${rows.length}件)`,{url,count:rows.length});
    for(const r of rows){if(!AFTER_WORD.test(r.marker))continue;const marker=displayMarker(r.marker);const name=normalize(r.name)||'商品名不明';const price=likelyPrice(r.text);const key=`${url}|${name}|${marker}|${price}`;if(seen.has(key))continue;seen.add(key);items.push({category:categoryForUrl(url),product:name,price,startDate:'不明',endDate:'不明',sourceUrl:url,flyerUrl:abs(r.href,url),confidence:'コストコ指定URL・赤文字「引き後」抽出',notes:marker,discountAfter:marker});}
  }
  return{items:items.slice(0,200),pages};
}
