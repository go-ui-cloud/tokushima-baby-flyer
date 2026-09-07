import path from 'node:path';
import fsSync from 'node:fs';
import { load } from 'cheerio';

const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36';
const PROMO=/(値下げ|期間限定価格)/;
const normalize=(s='')=>String(s).replace(/\uFFFD/g,'').replace(/[\t\r]+/g,' ').replace(/\s+/g,' ').trim();
const abs=(href,base)=>{try{return new URL(href,base).href;}catch{return base;}};
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

function priceFrom(text=''){
  const m=normalize(text).match(/[¥￥]\s*(\d{1,3}(?:,\d{3})+|\d{2,6})/);
  return m?`¥${Number(m[1].replaceAll(',','')).toLocaleString('ja-JP')}`:'不明';
}
function endDateFrom(text=''){
  const m=normalize(text).match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*まで\s*期間限定価格/);
  if(!m)return'不明';
  const now=new Date();let year=now.getFullYear();let date=new Date(year,Number(m[1])-1,Number(m[2]));
  if(date.getTime()<now.getTime()-180*86400000){year++;date=new Date(year,Number(m[1])-1,Number(m[2]));}
  return `${year}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function cleanName(text=''){
  return normalize(text).replace(/^(?:ベストセラー\s*)?(?:BABY|KIDS)\s*,?\s*/i,'').replace(/[¥￥]\s*\d[\d,]*[\s\S]*$/,'').replace(/^\d{1,3}(?:-\d{1,3})?cm\s*/i,'').trim().slice(0,180)||'商品名不明';
}
function markerFrom(text,red){if(/期間限定価格/.test(text))return text.match(/\d{1,2}\s*\/\s*\d{1,2}\s*まで\s*期間限定価格/)?.[0]||'期間限定価格';if(/値下げ/.test(text))return'値下げ';return red?'赤文字':'不明';}
function isProductHref(href=''){return /\/products\/|\/product\//i.test(href);}

async function launchBrowser(){
  const [{default:puppeteer},{default:chromium}]=await Promise.all([import('puppeteer-core'),import('@sparticuz/chromium')]);
  chromium.setGraphicsMode=false;let executablePath=process.env.CHROME_EXECUTABLE_PATH;
  if(!executablePath){const bin=path.join(process.cwd(),'node_modules','@sparticuz','chromium','bin');executablePath=fsSync.existsSync(bin)?await chromium.executablePath(bin):await chromium.executablePath();}
  return puppeteer.launch({args:chromium.args,executablePath,headless:true,defaultViewport:{width:1440,height:1100,deviceScaleFactor:1}});
}

async function browserPromotions(url){
  let browser,page;
  try{
    browser=await launchBrowser();page=await browser.newPage();await page.setUserAgent(UA);await page.setCacheEnabled(false);
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});await sleep(3000);
    await page.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=700){scrollTo(0,y);await new Promise(r=>setTimeout(r,130));}});await sleep(1200);
    return await page.evaluate(()=>{
      const norm=s=>(s||'').replace(/\s+/g,' ').trim();
      const red=el=>{try{const c=getComputedStyle(el).color||'';const m=c.match(/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/i);if(m){const r=+m[1],g=+m[2],b=+m[3];return r>=145&&r>g*1.2&&r>b*1.2;}return /red|sale|discount|limited|price.*(sale|promo)/i.test(`${el.className||''} ${el.getAttribute?.('style')||''}`);}catch{return false;}};
      const out=[],seen=new Set();
      for(const link of [...document.querySelectorAll('a[href*="/products/"],a[href*="/product/"]')]){
        const box=link.closest('li,article,[class*="product-card" i],[class*="product-tile" i],[data-testid*="product" i]')||link;
        const text=norm(box.innerText||link.innerText);if(!text||text.length>2500)continue;
        const redPrice=[...box.querySelectorAll('*')].some(el=>red(el)&&/[¥￥]\s*\d/.test(norm(el.innerText)));
        if(!/(値下げ|期間限定価格)/.test(text)&&!redPrice)continue;
        const href=link.href;if(seen.has(href))continue;seen.add(href);
        const nameEl=box.querySelector('[class*="name" i],[class*="title" i],h2,h3,h4');
        const img=box.querySelector('img');
        out.push({href,text,name:norm(nameEl?.innerText||''),imageUrl:img?.currentSrc||img?.src||img?.getAttribute('data-src')||'',red:redPrice});
      }
      return out;
    });
  }catch{return [];}finally{if(page)await page.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});}
}

function staticPromotions(html,url){
  const $=load(html),out=[],seen=new Set();
  $('a[href]').each((_,el)=>{
    const href=abs($(el).attr('href')||'',url);if(!isProductHref(href)||seen.has(href))return;
    const link=$(el),box=link.closest('li,article,[class*="product-card"],[class*="product-tile"]');const root=box.length?box:link;
    const text=normalize(root.text());if(text.length>2500)return;
    let redPrice=false;root.find('*').each((__,node)=>{const el=$(node),meta=`${el.attr('class')||''} ${el.attr('style')||''}`.toLowerCase();if(/[¥￥]\s*\d/.test(normalize(el.text()))&&/(red|sale|discount|limited|price.*(sale|promo)|color\s*:\s*(red|#e|#f|rgb\(2))/i.test(meta))redPrice=true;});
    if(!PROMO.test(text)&&!redPrice)return;
    const image=root.find('img').first();const rawImage=image.attr('src')||image.attr('data-src')||image.attr('data-original')||String(image.attr('srcset')||'').split(',')[0]?.trim().split(/\s+/)[0]||'';const imageUrl=rawImage?abs(rawImage,url):'';
    seen.add(href);out.push({href,text,name:normalize(root.find('[class*="name"],[class*="title"],h2,h3,h4').first().text()),imageUrl,red:redPrice});
  });
  return out;
}

export async function scrapeUniqloOnline(store,progress=async()=>{}){
  const url=store.sources[0].url;await progress('店舗ページ確認中','UNIQLOオンラインチラシを確認しています',{url});
  let rows=await browserPromotions(url),method='browser';
  if(!rows.length){
    const res=await fetch(url,{headers:{'user-agent':UA,'accept-language':'ja-JP,ja;q=0.9'},redirect:'follow',signal:AbortSignal.timeout(30000)});
    if(!res.ok)throw new Error(`UNIQLO公式ページを取得できませんでした（HTTP ${res.status}）`);
    rows=staticPromotions(await res.text(),url);method='html';
  }
  await progress('商品抽出中',`対象表示のある商品を ${rows.length} 件確認しました`,{count:rows.length});
  const seen=new Set(),items=[];
  for(const row of rows){
    const href=abs(row.href,url);if(seen.has(href))continue;seen.add(href);
    const marker=markerFrom(row.text,row.red);
    if(marker==='不明')continue;
    items.push({category:'ウェア',product:cleanName(row.name||row.text),price:priceFrom(row.text),startDate:'不明',endDate:endDateFrom(row.text),sourceUrl:url,sourceUrls:[url],flyerUrl:href,confidence:`UNIQLO公式・${marker}抽出`,notes:marker,discountAfter:marker,imageUrl:row.imageUrl?abs(row.imageUrl,url):null});
  }
  return {items:items.slice(0,200),pages:[{url,method,promotionCount:items.length}]};
}
