import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { load } from 'cheerio';
import { TMP_ROOT, absUrl, extFrom, hash, isImageUrl, isPdfUrl, safeName } from './utils.js';

const FLYER_WORDS=['チラシ','ちらし','flyer','leaflet','sale','セール','特売','広告','digital','catalog','カタログ','クーポン','coupon'];
const IGNORE=['logo','icon','favicon','sprite','qr','map','recruit','header','footer','tracking','analytics'];
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36';

function scoreAsset(a){
  const hay=`${a.url} ${a.alt||''} ${a.context||''}`.toLowerCase();
  let s=0;
  if(FLYER_WORDS.some(w=>hay.includes(w.toLowerCase()))) s+=8;
  if(isPdfUrl(a.url)) s+=7;
  if((a.width||0)>=700 && (a.height||0)>=700) s+=5;
  if((a.width||0)>=1000 || (a.height||0)>=1000) s+=3;
  if(IGNORE.some(w=>hay.includes(w))) s-=10;
  if(/\.svg(?:\?|$)/i.test(a.url)) s-=8;
  return s;
}

async function launchBrowser(){
  // Dynamic imports keep Puppeteer/Chromium out of unrelated server chunks.
  const [{default:puppeteer},{default:chromium}]=await Promise.all([
    import('puppeteer-core'),
    import('@sparticuz/chromium'),
  ]);
  chromium.setGraphicsMode=false;

  const configured=process.env.CHROME_EXECUTABLE_PATH;
  let executablePath=configured;
  if(!executablePath){
    // Vercel/Next file tracing can relocate JS while keeping the compressed
    // binaries under the project node_modules directory. Prefer the explicit
    // directory when it exists, then fall back to the package default.
    const explicitBin=path.join(process.cwd(),'node_modules','@sparticuz','chromium','bin');
    executablePath=fsSync.existsSync(explicitBin)
      ? await chromium.executablePath(explicitBin)
      : await chromium.executablePath();
  }

  return puppeteer.launch({
    args:chromium.args,
    executablePath,
    headless:true,
    defaultViewport:{width:1440,height:1100,deviceScaleFactor:1},
  });
}

async function collectPageBrowser(page,url){
  const network=[];
  const handler=res=>{
    const ct=(res.headers()['content-type']||'').toLowerCase();
    if(ct.includes('image/')||ct.includes('application/pdf')) network.push({url:res.url(),alt:'',context:'network',width:0,height:0});
  };
  page.on('response',handler);
  try{
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});
    await new Promise(r=>setTimeout(r,1200));
    const data=await page.evaluate(()=>{
      const imgs=[...document.images].map(img=>({url:img.currentSrc||img.src,alt:img.alt||'',context:img.closest('a,figure,section,article,div')?.innerText?.slice(0,220)||'',width:img.naturalWidth||img.width||0,height:img.naturalHeight||img.height||0}));
      const links=[...document.querySelectorAll('a[href]')].map(a=>({url:a.href,alt:a.innerText||a.getAttribute('aria-label')||'',context:a.parentElement?.innerText?.slice(0,220)||'',width:0,height:0}));
      const frames=[...document.querySelectorAll('iframe[src]')].map(f=>f.src);
      return {imgs,links,frames,title:document.title,body:document.body?.innerText?.slice(0,60000)||''};
    });
    return {...data,assets:[...data.imgs,...data.links,...network],method:'browser'};
  }finally{ page.off('response',handler); }
}

async function collectPageHttp(url){
  const res=await fetch(url,{headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml'},redirect:'follow',signal:AbortSignal.timeout(25000)});
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct=(res.headers.get('content-type')||'').toLowerCase();
  if(!ct.includes('text/html')&&!ct.includes('application/xhtml+xml')) throw new Error(`HTMLではありません (${ct||'content-type不明'})`);
  const html=await res.text();
  const $=load(html);
  const imgs=[]; const links=[]; const frames=[];
  $('img').each((_,el)=>{
    const raw=$(el).attr('src')||$(el).attr('data-src')||$(el).attr('data-original')||'';
    const u=absUrl(raw,url); if(!u)return;
    const w=Number($(el).attr('width'))||0, h=Number($(el).attr('height'))||0;
    imgs.push({url:u,alt:$(el).attr('alt')||'',context:$(el).closest('a,figure,section,article,div').text().trim().slice(0,220),width:w,height:h});
  });
  $('a[href]').each((_,el)=>{
    const u=absUrl($(el).attr('href'),url); if(!u)return;
    links.push({url:u,alt:$(el).text().trim()||$(el).attr('aria-label')||'',context:$(el).parent().text().trim().slice(0,220),width:0,height:0});
  });
  $('iframe[src]').each((_,el)=>{const u=absUrl($(el).attr('src'),url);if(u)frames.push(u);});
  $('source[srcset]').each((_,el)=>{
    const raw=($(el).attr('srcset')||'').split(',')[0]?.trim().split(/\s+/)[0];
    const u=absUrl(raw,url); if(u)imgs.push({url:u,alt:'',context:'source/srcset',width:0,height:0});
  });
  const body=$('body').text().replace(/\s+/g,' ').trim().slice(0,60000);
  const title=$('title').first().text().trim();
  return {imgs,links,frames,title,body,assets:[...imgs,...links],method:'http'};
}

async function download(url,referer,dir){
  try{
    const res=await fetch(url,{headers:{'user-agent':UA,'referer':referer||url},redirect:'follow',signal:AbortSignal.timeout(25000)});
    if(!res.ok) return null;
    const ct=(res.headers.get('content-type')||'').toLowerCase();
    if(!(ct.includes('image/')||ct.includes('pdf')||isImageUrl(url)||isPdfUrl(url))) return null;
    const buf=Buffer.from(await res.arrayBuffer());
    if(!buf.length || buf.length>25*1024*1024) return null;
    const file=path.join(dir,`${hash(url)}${extFrom(url,ct)}`);
    await fs.writeFile(file,buf);
    return {file,mime:ct,size:buf.length};
  }catch{return null;}
}

async function scrapeWithCollector(store,runDir,collector,page=null){
  const visited=new Set();
  const queue=store.sources.map(url=>({url,depth:0}));
  const pages=[]; const collected=[];
  while(queue.length && visited.size<7){
    const {url,depth}=queue.shift(); if(visited.has(url)) continue; visited.add(url);
    let d;
    try{d=await collector(page,url);}catch(e){pages.push({url,error:e.message});continue;}
    pages.push({url,title:d.title,body:d.body,method:d.method});
    for(const a of d.assets) if(a.url && /^https?:/i.test(a.url)) collected.push({...a,referer:url,score:scoreAsset(a)});
    if(depth<1){
      const interesting=d.links.filter(a=>{
        const txt=`${a.alt||''} ${a.context||''}`;
        return store.storeKeywords.some(k=>txt.includes(k))||FLYER_WORDS.some(k=>txt.toLowerCase().includes(k.toLowerCase()));
      }).slice(0,8);
      for(const a of interesting){const u=absUrl(a.url,url);if(u)queue.push({url:u,depth:1});}
      for(const f of d.frames.slice(0,3)){const u=absUrl(f,url);if(u)queue.push({url:u,depth:1});}
    }
  }
  const unique=[...new Map(collected.map(a=>[a.url,a])).values()].sort((a,b)=>b.score-a.score);
  const candidates=unique.filter(a=>a.score>=3).slice(0,5);
  const assets=[];
  for(const a of candidates){
    const d=await download(a.url,a.referer,runDir);
    if(d) assets.push({...a,...d});
    if(assets.length>=3) break;
  }
  return {pages,assets};
}

export async function scrapeStore(store){
  const runDir=path.join(TMP_ROOT,`${Date.now()}-${safeName(store.id)}`);
  await fs.mkdir(runDir,{recursive:true});
  let browser=null; let browserError=null;
  try{
    try{
      browser=await launchBrowser();
      const page=await browser.newPage();
      await page.setUserAgent(UA);
      const result=await scrapeWithCollector(store,runDir,(_,url)=>collectPageBrowser(page,url),page);
      if(!result.assets.length && result.pages.some(p=>!p.error)){
        const p=result.pages.find(p=>!p.error);
        try{
          await page.goto(p.url,{waitUntil:'domcontentloaded',timeout:25000});
          await new Promise(r=>setTimeout(r,1000));
          const file=path.join(runDir,`${hash(p.url)}-page.png`);
          await page.screenshot({path:file,fullPage:true});
          result.assets.push({url:p.url,referer:p.url,score:1,context:'ページ画像フォールバック',file,mime:'image/png'});
        }catch{}
      }
      return {store,...result,runDir,acquisition:'browser',browserError:null};
    }catch(e){
      browserError=e?.message||String(e);
    }finally{
      if(browser) await browser.close().catch(()=>{});
    }

    // Chromium failure must not make every store fail. Static HTML still
    // exposes useful flyer/PDF URLs for many retailers.
    const result=await scrapeWithCollector(store,runDir,(_unused,url)=>collectPageHttp(url));
    return {store,...result,runDir,acquisition:'http-fallback',browserError};
  }catch(e){
    e.message=`${e.message}${browserError?` / Chromium: ${browserError}`:''}`;
    throw e;
  }
}
