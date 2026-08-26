import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { load } from 'cheerio';
import { TMP_ROOT, absUrl, extFrom, hash, isImageUrl, isPdfUrl, safeName } from './utils.js';

const FLYER_WORDS=['チラシ','ちらし','flyer','leaflet','sale','セール','特売','広告','digital','catalog','カタログ','クーポン','coupon','売出','お買得'];
const IGNORE=['logo','icon','favicon','sprite','qr','map','recruit','header','footer','tracking','analytics','banner_logo'];
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36';

function norm(s=''){return String(s).replace(/[\s　・／/\-−ー丁目番地号]/g,'').toLowerCase();}
function pageMatchesStore(store,data){
  const hay=norm(`${data.title||''} ${data.body||''}`);
  const strong=[store.exactStoreName,store.address,...(store.storeKeywords||[])].map(norm).filter(x=>x.length>=4);
  return strong.some(k=>hay.includes(k));
}
function scoreAsset(a,source){
  const hay=`${a.url} ${a.alt||''} ${a.context||''}`.toLowerCase();
  let s=0;
  if(FLYER_WORDS.some(w=>hay.includes(w.toLowerCase()))) s+=10;
  if(isPdfUrl(a.url)) s+=8;
  if((a.width||0)>=650 && (a.height||0)>=650) s+=7;
  if((a.width||0)>=1000 || (a.height||0)>=1000) s+=4;
  if(source?.provider==='shufoo' && /shufoo|chirashi|leaflet|flyer|image/i.test(a.url)) s+=5;
  if(source?.provider==='official') s+=2;
  if(IGNORE.some(w=>hay.includes(w))) s-=15;
  if(/\.svg(?:\?|$)/i.test(a.url)) s-=12;
  return s;
}

async function launchBrowser(){
  const [{default:puppeteer},{default:chromium}]=await Promise.all([import('puppeteer-core'),import('@sparticuz/chromium')]);
  chromium.setGraphicsMode=false;
  let executablePath=process.env.CHROME_EXECUTABLE_PATH;
  if(!executablePath){const explicitBin=path.join(process.cwd(),'node_modules','@sparticuz','chromium','bin');executablePath=fsSync.existsSync(explicitBin)?await chromium.executablePath(explicitBin):await chromium.executablePath();}
  return puppeteer.launch({args:chromium.args,executablePath,headless:true,defaultViewport:{width:1440,height:1200,deviceScaleFactor:1}});
}

async function collectPageBrowser(page,url){
  const network=[];
  const handler=res=>{const ct=(res.headers()['content-type']||'').toLowerCase();if(ct.includes('image/')||ct.includes('application/pdf')) network.push({url:res.url(),alt:'',context:'network',width:0,height:0});};
  page.on('response',handler);
  try{
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:10000});
    await new Promise(r=>setTimeout(r,1000));
    // Some flyer viewers lazy-load after scrolling.
    await page.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=700){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,80));}window.scrollTo(0,0);});
    const data=await page.evaluate(()=>{
      const imgs=[...document.images].map(img=>({url:img.currentSrc||img.src,alt:img.alt||'',context:img.closest('a,figure,section,article,div')?.innerText?.slice(0,300)||'',width:img.naturalWidth||img.width||0,height:img.naturalHeight||img.height||0}));
      const links=[...document.querySelectorAll('a[href]')].map(a=>({url:a.href,alt:a.innerText||a.getAttribute('aria-label')||'',context:a.parentElement?.innerText?.slice(0,300)||'',width:0,height:0}));
      const frames=[...document.querySelectorAll('iframe[src]')].map(f=>f.src);
      return {imgs,links,frames,title:document.title,body:document.body?.innerText?.slice(0,70000)||''};
    });
    return {...data,assets:[...data.imgs,...data.links,...network],method:'browser'};
  }finally{page.off('response',handler);}
}

async function collectPageHttp(url){
  const res=await fetch(url,{headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml'},redirect:'follow',signal:AbortSignal.timeout(10000)});
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct=(res.headers.get('content-type')||'').toLowerCase();if(!ct.includes('text/html')&&!ct.includes('application/xhtml+xml')) throw new Error(`HTMLではありません (${ct||'content-type不明'})`);
  const html=await res.text();const $=load(html);const imgs=[],links=[],frames=[];
  $('img').each((_,el)=>{const raws=[$(el).attr('src'),$(el).attr('data-src'),$(el).attr('data-original'),$(el).attr('data-lazy-src')].filter(Boolean);for(const raw of raws){const u=absUrl(raw,url);if(u)imgs.push({url:u,alt:$(el).attr('alt')||'',context:$(el).closest('a,figure,section,article,div').text().trim().slice(0,300),width:Number($(el).attr('width'))||0,height:Number($(el).attr('height'))||0});}});
  $('a[href]').each((_,el)=>{const u=absUrl($(el).attr('href'),url);if(u)links.push({url:u,alt:$(el).text().trim()||$(el).attr('aria-label')||'',context:$(el).parent().text().trim().slice(0,300),width:0,height:0});});
  $('iframe[src]').each((_,el)=>{const u=absUrl($(el).attr('src'),url);if(u)frames.push(u);});
  $('source[srcset]').each((_,el)=>{const raw=($(el).attr('srcset')||'').split(',')[0]?.trim().split(/\s+/)[0];const u=absUrl(raw,url);if(u)imgs.push({url:u,alt:'',context:'source/srcset',width:0,height:0});});
  return {imgs,links,frames,title:$('title').first().text().trim(),body:$('body').text().replace(/\s+/g,' ').trim().slice(0,70000),assets:[...imgs,...links],method:'http'};
}

async function download(url,referer,dir){
  try{const res=await fetch(url,{headers:{'user-agent':UA,'referer':referer||url},redirect:'follow',signal:AbortSignal.timeout(10000)});if(!res.ok)return null;const ct=(res.headers.get('content-type')||'').toLowerCase();if(!(ct.includes('image/')||ct.includes('pdf')||isImageUrl(url)||isPdfUrl(url)))return null;const buf=Buffer.from(await res.arrayBuffer());if(!buf.length||buf.length>30*1024*1024)return null;const file=path.join(dir,`${hash(url)}${extFrom(url,ct)}`);await fs.writeFile(file,buf);return {file,mime:ct,size:buf.length};}catch{return null;}
}

async function inspectSource(store,source,runDir,collector,page=null){
  const visited=new Set(),queue=[{url:source.url,depth:0}],pages=[],collected=[];
  let sourceValidated=false;
  while(queue.length&&visited.size<4){
    const {url,depth}=queue.shift();if(visited.has(url))continue;visited.add(url);
    let d;try{d=await collector(page,url);}catch(e){pages.push({url,error:e.message,provider:source.provider});continue;}
    const matched=pageMatchesStore(store,d);if(depth===0)sourceValidated=matched;
    pages.push({url,title:d.title,body:d.body,method:d.method,provider:source.provider,matched});
    if(depth===0&&!matched) break; // exact-store safety: never follow assets from another store.
    for(const a of d.assets) if(a.url&&/^https?:/i.test(a.url)) collected.push({...a,referer:url,provider:source.provider,sourceLabel:source.label,score:scoreAsset(a,source)});
    if(depth<1){
      const interesting=d.links.filter(a=>{const txt=`${a.alt||''} ${a.context||''} ${a.url||''}`;return FLYER_WORDS.some(k=>txt.toLowerCase().includes(k.toLowerCase()));}).slice(0,8);
      for(const a of interesting){const u=absUrl(a.url,url);if(u)queue.push({url:u,depth:1});}
      for(const f of d.frames.slice(0,3)){const u=absUrl(f,url);if(u)queue.push({url:u,depth:1});}
    }
  }
  if(!sourceValidated)return {pages,assets:[],validated:false};
  const unique=[...new Map(collected.map(a=>[a.url,a])).values()].sort((a,b)=>b.score-a.score);
  // Only genuine flyer-like assets. We intentionally removed full-page screenshot OCR in V2.5.
  const candidates=unique.filter(a=>a.score>=8).slice(0,12);
  const assets=[];
  for(const a of candidates){const d=await download(a.url,a.referer,runDir);if(d){assets.push({...a,...d});if(assets.length>=4)break;}}
  return {pages,assets,validated:true};
}

async function scrapeByMethod(store,runDir,collector,page=null){
  const allPages=[],attempts=[];
  for(const source of store.sources){
    const r=await inspectSource(store,source,runDir,collector,page);allPages.push(...r.pages);attempts.push({provider:source.provider,label:source.label,url:source.url,validated:r.validated,assets:r.assets.length});
    if(r.assets.length){return {pages:allPages,assets:r.assets,selectedSource:source,attempts};}
  }
  return {pages:allPages,assets:[],selectedSource:store.sources[0],attempts};
}

export async function scrapeStore(store){
  const runDir=path.join(TMP_ROOT,`${Date.now()}-${safeName(store.id)}`);await fs.mkdir(runDir,{recursive:true});let browser=null,browserError=null;
  try{
    try{browser=await launchBrowser();const page=await browser.newPage();await page.setUserAgent(UA);const result=await scrapeByMethod(store,runDir,(_,url)=>collectPageBrowser(page,url),page);if(result.assets.length)return {store,...result,runDir,acquisition:'browser',browserError:null};}
    catch(e){browserError=e?.message||String(e);}finally{if(browser)await browser.close().catch(()=>{});}
    const result=await scrapeByMethod(store,runDir,(_unused,url)=>collectPageHttp(url));return {store,...result,runDir,acquisition:'http-fallback',browserError};
  }catch(e){e.message=`${e.message}${browserError?` / Chromium: ${browserError}`:''}`;throw e;}
}
