import path from 'node:path';
import fsSync from 'node:fs';
import { load } from 'cheerio';

const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36';
const AFTER_WORD=/[¥￥]?\s*\d[\d,]*\s*引き後|引き後/i;
function normalize(s=''){return String(s).replace(/\uFFFD/g,'').replace(/[\t\r]+/g,' ').replace(/\s+/g,' ').trim();}
function decodeBody(buffer,contentType=''){const m=String(contentType).match(/charset=([^;]+)/i);const charset=(m?.[1]||'utf-8').trim().replace(/["']/g,'');try{return new TextDecoder(charset,{fatal:false}).decode(buffer);}catch{return new TextDecoder('utf-8',{fatal:false}).decode(buffer);}}
function abs(href,base){try{return new URL(href,base).href;}catch{return base;}}
function categoryForUrl(url){return /Diapers-Wipes\/c\/cos_8\.4/i.test(url)?'おむつ・おしりふき':'離乳食・ベビーフード';}
function displayMarker(text=''){const t=normalize(text);const m=t.match(/[¥￥]\s*\d[\d,]*\s*引き後/i);if(m)return m[0].replace('￥','¥').replace(/\s+/g,'');return t.includes('引き後')?t.slice(0,80):'引き後';}
function likelyPrice(text=''){const vals=[...String(text).matchAll(/[¥￥]\s*(\d{1,3}(?:,\d{3})+|\d{3,6})(?!\s*引き後)/g)].map(m=>m[1]);return vals.length?`¥${Number(vals.at(-1).replaceAll(',','')).toLocaleString('ja-JP')}`:'不明';}

async function launchBrowser(){const [{default:puppeteer},{default:chromium}]=await Promise.all([import('puppeteer-core'),import('@sparticuz/chromium')]);chromium.setGraphicsMode=false;let executablePath=process.env.CHROME_EXECUTABLE_PATH;if(!executablePath){const explicitBin=path.join(process.cwd(),'node_modules','@sparticuz','chromium','bin');executablePath=fsSync.existsSync(explicitBin)?await chromium.executablePath(explicitBin):await chromium.executablePath();}return puppeteer.launch({args:chromium.args,executablePath,headless:true,defaultViewport:{width:1440,height:1100,deviceScaleFactor:1}});}

async function browserRedAfter(url){
  let browser=null,page=null;
  try{
    browser=await launchBrowser();page=await browser.newPage();await page.setUserAgent(UA);await page.goto(url,{waitUntil:'domcontentloaded',timeout:22000});
    await page.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=800){scrollTo(0,y);await new Promise(r=>setTimeout(r,90));}scrollTo(0,0);});
    return await page.evaluate(()=>{
      const norm=s=>(s||'').replace(/\s+/g,' ').trim();
      const isRed=(el)=>{const c=getComputedStyle(el).color||'';const m=c.match(/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/i);if(m){const r=+m[1],g=+m[2],b=+m[3];if(r>=140&&r>=g*1.25&&r>=b*1.25)return true;}const meta=`${el.className||''} ${el.id||''}`.toLowerCase();return /(red|danger|discount|saving|sale|promo|special)/.test(meta);};
      const selectors='.product-item, li.product__list--item, .product-listing-item, article, .product-tile, .product-item-container, .product-item-info, [class*="product"]';
      const out=[];const seen=new Set();
      for(const el of document.querySelectorAll('body *')){
        const own=norm([...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join(' '));const txt=own||((el.children.length<=2&&norm(el.innerText).length<=100)?norm(el.innerText):'');
        if(!txt||!txt.includes('引き後')||!isRed(el))continue;
        const product=el.closest(selectors)||el.closest('li,article,section,div');if(!product)continue;const full=norm(product.innerText);if(full.length<8||full.length>5000)continue;
        const link=product.querySelector('a[href]');const nameEl=product.querySelector('[class*="name"],h2,h3,h4,a');const name=norm(nameEl?.innerText||link?.getAttribute('aria-label')||'商品名不明');const href=link?.href||location.href;const key=`${name}|${txt}|${href}`;if(seen.has(key))continue;seen.add(key);out.push({name:name.slice(0,160),marker:txt.slice(0,100),text:full.slice(0,2500),href});
      }
      return out.slice(0,120);
    });
  }catch{return [];}finally{if(page)await page.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});}
}

function staticRedAfter($){
  const out=[];const seen=new Set();
  $('*').each((_,el)=>{const $el=$(el);const own=normalize($el.clone().children().remove().end().text());if(!own.includes('引き後'))return;const meta=`${$el.attr('class')||''} ${$el.attr('id')||''} ${$el.attr('style')||''}`.toLowerCase();if(!/(red|danger|discount|saving|sale|promo|special|color\s*:\s*(red|#f|#e|rgb\(2[0-9]{2}))/i.test(meta))return;const p=$el.closest('.product-item,li,article,[class*="product"]');const full=normalize((p.length?p:$el.parent()).text());const name=normalize((p.length?p:$el.parent()).find('[class*="name"],h2,h3,h4,a').first().text())||'商品名不明';const href=(p.length?p:$el.parent()).find('a[href]').first().attr('href')||'';const key=`${name}|${own}|${href}`;if(!seen.has(key)){seen.add(key);out.push({name:name.slice(0,160),marker:own.slice(0,100),text:full.slice(0,2500),href});}});return out;
}

export async function scrapeCostcoOnline(store,progress=async()=>{}){
  const items=[],pages=[],seen=new Set();
  for(const url of store.categoryUrls||[]){
    await progress('店舗ページ確認中','指定したコストコオンラインページを確認しています',{url});
    let rows=await browserRedAfter(url);
    let title='',bodyLength=0;
    if(!rows.length){
      try{const res=await fetch(url,{headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml','accept-language':'ja-JP,ja;q=0.9'},redirect:'follow',signal:AbortSignal.timeout(25000)});if(!res.ok){pages.push({url,error:`HTTP ${res.status}`});continue;}const buf=await res.arrayBuffer();const html=decodeBody(buf,res.headers.get('content-type')||'');const $=load(html);title=normalize($('title').text());bodyLength=normalize($('body').text()).length;rows=staticRedAfter($);}catch(e){pages.push({url,error:e.message});continue;}
    }
    pages.push({url,title,bodyLength,redAfterCount:rows.length});
    await progress('商品抽出中',`赤文字の「引き後」を確認しています (${rows.length}件)`,{url,count:rows.length});
    for(const r of rows){if(!AFTER_WORD.test(r.marker))continue;const marker=displayMarker(r.marker);const name=normalize(r.name)||'商品名不明';const price=likelyPrice(r.text);const key=`${url}|${name}|${marker}|${price}`;if(seen.has(key))continue;seen.add(key);items.push({category:categoryForUrl(url),product:name,price,startDate:'不明',endDate:'不明',sourceUrl:url,flyerUrl:abs(r.href,url),confidence:'コストコ指定URL・赤文字「引き後」抽出',notes:marker,discountAfter:marker});}
  }
  return{items:items.slice(0,160),pages};
}
