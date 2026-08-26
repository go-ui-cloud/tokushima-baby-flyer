import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { TMP_ROOT, absUrl, extFrom, hash, isImageUrl, isPdfUrl, safeName } from './utils.js';

const FLYER_WORDS=['チラシ','ちらし','flyer','leaflet','sale','セール','特売','広告','digital','catalog','カタログ','クーポン','coupon'];
const IGNORE=['logo','icon','favicon','sprite','qr','map','recruit','header','footer','tracking','analytics'];

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
  chromium.setGraphicsMode=false;
  const executablePath=process.env.CHROME_EXECUTABLE_PATH || await chromium.executablePath();
  return puppeteer.launch({
    args:chromium.args,
    executablePath,
    headless:true,
    defaultViewport:{width:1440,height:1100,deviceScaleFactor:1},
  });
}

async function collectPage(page,url){
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
    return {...data,assets:[...data.imgs,...data.links,...network]};
  }finally{ page.off('response',handler); }
}

async function download(url,referer,dir){
  try{
    const res=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36','referer':referer||url},redirect:'follow',signal:AbortSignal.timeout(25000)});
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

export async function scrapeStore(store){
  const runDir=path.join(TMP_ROOT,`${Date.now()}-${safeName(store.id)}`);
  await fs.mkdir(runDir,{recursive:true});
  const browser=await launchBrowser();
  const page=await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36');
  const visited=new Set();
  const queue=store.sources.map(url=>({url,depth:0}));
  const pages=[]; const collected=[];
  try{
    while(queue.length && visited.size<7){
      const {url,depth}=queue.shift(); if(visited.has(url)) continue; visited.add(url);
      let d; try{d=await collectPage(page,url);}catch(e){pages.push({url,error:e.message});continue;}
      pages.push({url,title:d.title,body:d.body});
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
    const candidates=unique.filter(a=>a.score>=3).slice(0,4);
    const assets=[];
    for(const a of candidates){
      const d=await download(a.url,a.referer,runDir);
      if(d) assets.push({...a,...d});
      if(assets.length>=3) break;
    }
    if(!assets.length && pages.some(p=>!p.error)){
      const p=pages.find(p=>!p.error);
      try{
        await page.goto(p.url,{waitUntil:'domcontentloaded',timeout:25000});
        await new Promise(r=>setTimeout(r,1000));
        const file=path.join(runDir,`${hash(p.url)}-page.png`);
        await page.screenshot({path:file,fullPage:true});
        assets.push({url:p.url,referer:p.url,score:1,context:'ページ画像フォールバック',file,mime:'image/png'});
      }catch{}
    }
    return {store,pages,assets,runDir};
  }finally{await browser.close();}
}
