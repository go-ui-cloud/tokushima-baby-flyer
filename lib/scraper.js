import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { load } from 'cheerio';
import { analyzeFlyerDates } from './flyer-date.js';
import { TMP_ROOT, absUrl, extFrom, hash, isImageUrl, isPdfUrl, safeName } from './utils.js';

const FLYER_WORDS=['チラシ','ちらし','flyer','leaflet','sale','セール','特売','広告','digital','catalog','カタログ','クーポン','coupon','売出','お買得'];
const IGNORE=['logo','icon','favicon','sprite','qr','map','recruit','header','footer','tracking','analytics','banner_logo'];
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36';
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
async function preparePage(page){
  await page.setUserAgent(UA);
  await page.setCacheEnabled(false).catch(()=>{});
  await page.setExtraHTTPHeaders({'Cache-Control':'no-cache, no-store, max-age=0','Pragma':'no-cache','Accept-Language':'ja-JP,ja;q=0.9'}).catch(()=>{});
  try{const c=await page.createCDPSession();await c.send('Network.enable');await c.send('Network.clearBrowserCache');await c.detach();}catch{}
}
async function waitForVisualReady(page,{minWait=3200,maxWait=10000}={}){
  await sleep(minWait);
  const started=Date.now();
  while(Date.now()-started<Math.max(0,maxWait-minWait)){
    const state=await page.evaluate(()=>{
      const imgs=[...document.images].filter(i=>{const r=i.getBoundingClientRect();return r.width>=180&&r.height>=120;});
      const pending=imgs.filter(i=>!i.complete||i.naturalWidth<100||i.naturalHeight<80).length;
      const canv=[...document.querySelectorAll('canvas')].filter(c=>c.width>=300&&c.height>=300).length;
      const busy=document.readyState!=='complete';
      return {count:imgs.length,pending,canv,busy};
    }).catch(()=>({count:0,pending:1,canv:0,busy:true}));
    if(!state.busy && (state.count===0 || state.pending===0 || state.canv>0)){await sleep(1000);return state;}
    await sleep(700);
  }
  return null;
}
function norm(s=''){return String(s).replace(/[\s　・／/\-−ー丁目番地号]/g,'').toLowerCase();}
function pageMatchesStore(store,data){const hay=norm(`${data.title||''} ${data.body||''}`);const strong=[store.exactStoreName,store.address,...(store.storeKeywords||[])].map(norm).filter(x=>x.length>=4);return strong.some(k=>hay.includes(k));}
function flyerDateContext(text=''){const t=String(text);const lower=t.toLowerCase();const chunks=[];for(const word of FLYER_WORDS){let from=0,idx;while((idx=lower.indexOf(word.toLowerCase(),from))>=0){chunks.push(t.slice(Math.max(0,idx-220),Math.min(t.length,idx+420)));from=idx+word.length;if(chunks.length>=20)break;}if(chunks.length>=20)break;}return chunks.length?chunks.join(' '):t.slice(0,5000);}
function scoreAsset(a,source){const hay=`${a.url} ${a.alt||''} ${a.context||''}`.toLowerCase();let s=0;if(FLYER_WORDS.some(w=>hay.includes(w.toLowerCase())))s+=10;if(isPdfUrl(a.url))s+=8;if((a.width||0)>=650&&(a.height||0)>=650)s+=7;if((a.width||0)>=1000||(a.height||0)>=1000)s+=4;if(source?.provider==='official')s+=2;if(IGNORE.some(w=>hay.includes(w)))s-=15;if(/\.svg(?:\?|$)/i.test(a.url))s-=12;return s;}
async function launchBrowser(){const [{default:puppeteer},{default:chromium}]=await Promise.all([import('puppeteer-core'),import('@sparticuz/chromium')]);chromium.setGraphicsMode=false;let executablePath=process.env.CHROME_EXECUTABLE_PATH;if(!executablePath){const explicitBin=path.join(process.cwd(),'node_modules','@sparticuz','chromium','bin');executablePath=fsSync.existsSync(explicitBin)?await chromium.executablePath(explicitBin):await chromium.executablePath();}return puppeteer.launch({args:chromium.args,executablePath,headless:true,defaultViewport:{width:1440,height:1400,deviceScaleFactor:1.25}});}

async function collectPageBrowser(page,url){const network=[];const handler=res=>{const ct=(res.headers()['content-type']||'').toLowerCase();if(ct.includes('image/')||ct.includes('application/pdf'))network.push({url:res.url(),alt:'',context:'network',width:0,height:0});};page.on('response',handler);try{await page.goto(url,{waitUntil:'domcontentloaded',timeout:18000});await waitForVisualReady(page,{minWait:3200,maxWait:9000});await page.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=700){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,80));}window.scrollTo(0,0);});const data=await page.evaluate(()=>{const imgs=[...document.images].map(img=>({url:img.currentSrc||img.src,alt:img.alt||'',context:img.closest('a,figure,section,article,div')?.innerText?.slice(0,500)||'',width:img.naturalWidth||img.width||0,height:img.naturalHeight||img.height||0}));const links=[...document.querySelectorAll('a[href]')].map(a=>({url:a.href,alt:a.innerText||a.getAttribute('aria-label')||'',context:a.parentElement?.innerText?.slice(0,500)||'',width:0,height:0}));const frames=[...document.querySelectorAll('iframe[src]')].map(f=>f.src);return{imgs,links,frames,title:document.title,body:document.body?.innerText?.slice(0,70000)||''};});return{...data,assets:[...data.imgs,...data.links,...network],method:'browser'};}finally{page.off('response',handler);}}
async function collectPageHttp(url){const res=await fetch(url,{headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml'},redirect:'follow',signal:AbortSignal.timeout(12000)});if(!res.ok)throw new Error(`HTTP ${res.status}`);const ct=(res.headers.get('content-type')||'').toLowerCase();if(!ct.includes('text/html')&&!ct.includes('application/xhtml+xml'))throw new Error(`HTMLではありません (${ct||'content-type不明'})`);const html=await res.text(),$=load(html),imgs=[],links=[],frames=[];$('img').each((_,el)=>{const raws=[$(el).attr('src'),$(el).attr('data-src'),$(el).attr('data-original'),$(el).attr('data-lazy-src')].filter(Boolean);for(const raw of raws){const u=absUrl(raw,url);if(u)imgs.push({url:u,alt:$(el).attr('alt')||'',context:$(el).closest('a,figure,section,article,div').text().trim().slice(0,300),width:Number($(el).attr('width'))||0,height:Number($(el).attr('height'))||0});}});$('a[href]').each((_,el)=>{const u=absUrl($(el).attr('href'),url);if(u)links.push({url:u,alt:$(el).text().trim()||$(el).attr('aria-label')||'',context:$(el).parent().text().trim().slice(0,300),width:0,height:0});});$('iframe[src]').each((_,el)=>{const u=absUrl($(el).attr('src'),url);if(u)frames.push(u);});return{imgs,links,frames,title:$('title').first().text().trim(),body:$('body').text().replace(/\s+/g,' ').trim().slice(0,70000),assets:[...imgs,...links],method:'http'};}
async function download(url,referer,dir){try{const res=await fetch(url,{headers:{'user-agent':UA,'referer':referer||url},redirect:'follow',signal:AbortSignal.timeout(15000)});if(!res.ok)return null;const ct=(res.headers.get('content-type')||'').toLowerCase();if(!(ct.includes('image/')||ct.includes('pdf')||isImageUrl(url)||isPdfUrl(url)))return null;const buf=Buffer.from(await res.arrayBuffer());if(!buf.length||buf.length>35*1024*1024)return null;const file=path.join(dir,`${hash(url)}${extFrom(url,ct)}`);await fs.writeFile(file,buf);return{file,mime:ct,size:buf.length};}catch{return null;}}

function asRegexSource(patterns=[]){return patterns.map(x=>x instanceof RegExp?x.source:String(x).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));}
async function collectClickTargets(page,patterns,{scopeWords=[],hrefIncludes=[]}={}){
  const psrc=asRegexSource(patterns),ssrc=asRegexSource(scopeWords);
  return page.evaluate(({psrc,ssrc,hrefIncludes})=>{
    const regs=psrc.map(s=>new RegExp(s,'i'));const scopes=ssrc.map(s=>new RegExp(s,'i'));
    const norm=s=>(s||'').replace(/\s+/g,' ').trim();
    const candidates=[...document.querySelectorAll('a,button,[role="button"],img')];
    const out=[];
    for(const el0 of candidates){
      const el=el0.tagName==='IMG'?(el0.closest('a,button,[role="button"]')||el0):el0;
      const img=el.querySelector?.('img')|| (el.tagName==='IMG'?el:null);
      const text=norm(`${el.innerText||''} ${el.getAttribute?.('aria-label')||''} ${el.getAttribute?.('title')||''} ${img?.alt||''}`);
      const href=el.href||el.closest?.('a[href]')?.href||'';
      const context=norm(el.closest?.('section,article,li,div')?.innerText||el.parentElement?.innerText||'').slice(0,1200);
      const matched=regs.some(r=>r.test(text)||r.test(context)||r.test(href));
      const scopeOk=!scopes.length||scopes.some(r=>r.test(context));
      const hrefOk=!hrefIncludes.length||hrefIncludes.some(x=>href.includes(x));
      if((matched&&scopeOk)||hrefOk){const r=el.getBoundingClientRect();out.push({href,text,context,top:r.top+scrollY,width:r.width,height:r.height});}
    }
    const seen=new Set();return out.filter(x=>{const k=`${x.href}|${x.text.slice(0,120)}`;if(seen.has(k))return false;seen.add(k);return true;}).sort((a,b)=>a.top-b.top).slice(0,12);
  },{psrc,ssrc,hrefIncludes});
}

async function writeDataUrlPng(dataUrl,file){
  if(!dataUrl||!/^data:image\/png;base64,/i.test(dataUrl))return null;
  const buf=Buffer.from(dataUrl.replace(/^data:image\/png;base64,/i,''),'base64');
  if(buf.length<12000)return null;await fs.writeFile(file,buf);const st=await fs.stat(file);return{file,size:st.size};
}

async function captureRenderedMedia(page,runDir,tag,index=0){
  const out=[];
  // Canvas is often the real flyer surface in dynamic viewers. Export it without Page.captureScreenshot.
  const canvases=await page.evaluate(()=>[...document.querySelectorAll('canvas')].map((c,i)=>{const r=c.getBoundingClientRect();let data='';try{data=c.toDataURL('image/png');}catch{}return{i,w:Math.round(r.width),h:Math.round(r.height),data};}).filter(x=>x.w>=350&&x.h>=300&&x.data));
  for(const c of canvases.slice(0,6)){
    const file=path.join(runDir,`${tag}-${index}-canvas${c.i+1}.png`);const saved=await writeDataUrlPng(c.data,file);if(saved)out.push({...saved,width:c.w,height:c.h,tag:`${tag}-${index}-canvas${c.i+1}`});
  }
  if(out.length)return out;
  // If the viewer renders ordinary large images, download the rendered currentSrc directly.
  const imgs=await page.evaluate(()=>[...document.images].map((img,i)=>{const r=img.getBoundingClientRect();return{i,src:img.currentSrc||img.src||'',w:Math.round(r.width),h:Math.round(r.height),nw:img.naturalWidth||0,nh:img.naturalHeight||0,alt:img.alt||'',ctx:img.closest('a,figure,section,article,div')?.innerText?.slice(0,600)||''};}).filter(x=>x.src&&(x.w>=350&&x.h>=300||x.nw>=700&&x.nh>=700)).sort((a,b)=>(b.nw*b.nh)-(a.nw*a.nh)).slice(0,8));
  for(const im of imgs){
    if(/^data:image\/png;base64,/i.test(im.src)){
      const file=path.join(runDir,`${tag}-${index}-img${im.i+1}.png`);const saved=await writeDataUrlPng(im.src,file);if(saved)out.push({...saved,width:im.nw||im.w,height:im.nh||im.h,tag:`${tag}-${index}-img${im.i+1}`});
    }else if(/^https?:/i.test(im.src)){
      const d=await download(im.src,page.url(),runDir);if(d){out.push({file:d.file,size:d.size,width:im.nw||im.w,height:im.nh||im.h,tag:`${tag}-${index}-img${im.i+1}`});}
    }
    if(out.length>=6)break;
  }
  return out;
}

async function safeViewportScreenshot(page,file,{y=0,width=1365,height=1100}={}){
  try{
    const vp=page.viewport()||{width:1440,height:1200};
    const w=Math.max(800,Math.min(width,vp.width||1440));const h=Math.max(500,Math.min(height,vp.height||1200));
    await page.evaluate(v=>window.scrollTo(0,v),Math.max(0,y));await sleep(220);
    await page.screenshot({path:file,type:'png',captureBeyondViewport:false,clip:{x:0,y:0,width:w,height:h}});
    const st=await fs.stat(file);return st.size>=12000?{file,size:st.size,width:w,height:h}:null;
  }catch{return null;}
}

async function captureViewer(page,runDir,tag,index=0,{maxSegments=7,preferFull=false}={}){
  await waitForVisualReady(page,{minWait:3200,maxWait:10000});
  const blockedText=await page.evaluate(()=>document.body?.innerText?.slice(0,5000)||'').catch(()=> '');
  if(/Access Denied|permission to access|Forbidden|Request blocked|アクセスが拒否/i.test(blockedText))return [];
  const outputs=[];
  // 1) Avoid Chromium screenshot protocol entirely when the flyer is a canvas/large image.
  try{outputs.push(...await captureRenderedMedia(page,runDir,tag,index));}catch{}
  if(outputs.length&&!preferFull)return outputs;

  // 2) Try the actual flyer/viewer element, but never let Page.captureScreenshot abort the store.
  try{
    const info=await page.evaluate(()=>{
      const keys=['flyer','chirashi','leaflet','catalog','viewer','paper','page','canvas','チラシ','広告','tokubai'];
      const els=[...document.querySelectorAll('img,canvas,iframe,[class*="flyer" i],[id*="flyer" i],[class*="viewer" i],[id*="viewer" i],main,article')];
      const ranked=els.map((el,i)=>{const r=el.getBoundingClientRect();const meta=`${el.id||''} ${typeof el.className==='string'?el.className:''} ${el.getAttribute?.('aria-label')||''} ${el.getAttribute?.('title')||''}`.toLowerCase();let score=0;if(keys.some(k=>meta.includes(k)))score+=20;if(['IMG','CANVAS','IFRAME'].includes(el.tagName))score+=8;if(r.width>=500&&r.height>=500)score+=12;if(r.width>=800&&r.height>=1000)score+=8;if(r.width<350||r.height<300)score-=40;return{i,score,area:r.width*r.height};}).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||b.area-a.area);return ranked[0]||null;
    });
    if(info){const handles=await page.$$('img,canvas,iframe,[class*="flyer" i],[id*="flyer" i],[class*="viewer" i],[id*="viewer" i],main,article');const el=handles[info.i];if(el){const box=await el.boundingBox();if(box&&box.width>=350&&box.height>=300&&box.height<=9000){const file=path.join(runDir,`${tag}-${index}-viewer.png`);try{await el.screenshot({path:file,type:'png'});const st=await fs.stat(file);if(st.size>=12000)outputs.push({file,size:st.size,width:Math.round(box.width),height:Math.round(box.height),tag:`${tag}-${index}-viewer`});}catch{}}}}
  }catch{}
  if(outputs.length&&!preferFull)return outputs;

  // 3) Last resort: fixed viewport chunks. Never request a giant/full-page capture.
  let dims={w:1365,h:1200,vh:1100};
  try{dims=await page.evaluate(()=>({w:Math.max(800,Math.min(1440,document.documentElement.clientWidth||window.innerWidth||1365)),h:Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0),vh:Math.max(700,Math.min(1200,window.innerHeight||1000))}));}catch{}
  const step=Math.max(700,Math.min(1050,dims.vh||1000));const count=Math.min(maxSegments,Math.max(1,Math.ceil((dims.h||step)/step)));
  for(let i=0;i<count;i++){
    const file=path.join(runDir,`${tag}-${index}-seg${i+1}.png`);const shot=await safeViewportScreenshot(page,file,{y:i*step,width:dims.w,height:step});if(shot)outputs.push({...shot,tag:`${tag}-${index}-seg${i+1}`});
  }
  try{await page.evaluate(()=>scrollTo(0,0));}catch{}
  return outputs;
}
async function openTargetAndCapture(browser,startPage,target,runDir,tag,index,progress,{nextPatterns=[],turnPatterns=[],maxNext=0,preferFull=false}={}){
  let page=null;try{
    page=await browser.newPage();await preparePage(page);
    if(target.href&&/^https?:/i.test(target.href)){await progress('チラシページを開いています',target.text||target.href,{url:target.href});await page.goto(target.href,{waitUntil:'domcontentloaded',timeout:20000});await waitForVisualReady(page,{minWait:3500,maxWait:10000});}
    else{await page.goto(startPage.url(),{waitUntil:'domcontentloaded',timeout:18000});const clicked=await page.evaluate(({text,top})=>{const els=[...document.querySelectorAll('a,button,[role="button"],img')];const t=(text||'').slice(0,80);const e=els.find(x=>((x.innerText||x.alt||'').replace(/\s+/g,' ').trim().includes(t))||Math.abs((x.getBoundingClientRect().top+scrollY)-top)<10);if(!e)return false;(e.closest('a,button,[role="button"]')||e).click();return true;},{text:target.text,top:target.top});if(!clicked)return[];await waitForVisualReady(page,{minWait:4000,maxWait:11000});}
    await progress('チラシを発見','クリック先のチラシ表示を確認しました',{url:page.url()});
    let all=[];all.push(...await captureViewer(page,runDir,tag,index,{preferFull}));
    const repeat=[...nextPatterns,...turnPatterns];
    for(let n=0;n<maxNext;n++){
      const targets=await collectClickTargets(page,repeat);if(!targets.length)break;
      const t=targets[0];const before=page.url();
      try{if(t.href&&t.href!==before)await page.goto(t.href,{waitUntil:'domcontentloaded',timeout:15000});else await page.evaluate(({text,top})=>{const els=[...document.querySelectorAll('a,button,[role="button"],img')];const e=els.find(x=>((x.innerText||x.alt||'').replace(/\s+/g,' ').trim().includes((text||'').slice(0,80)))||Math.abs((x.getBoundingClientRect().top+scrollY)-top)<10);(e?.closest('a,button,[role="button"]')||e)?.click();},{text:t.text,top:t.top});await waitForVisualReady(page,{minWait:3500,maxWait:9000});await progress('次のチラシを発見',`${n+2}枚目を読み込みます`,{url:page.url()});all.push(...await captureViewer(page,runDir,`${tag}-next`,n,{preferFull}));}catch{break;}
    }
    return all;
  }finally{if(page)await page.close().catch(()=>{});}
}


async function openTargetAndCaptureByRealClick(browser,sourceUrl,target,runDir,tag,index,progress,{preferFull=false}={}){
  let page=null,popup=null;
  try{
    page=await browser.newPage();await preparePage(page);
    await page.goto(sourceUrl,{waitUntil:'domcontentloaded',timeout:20000});await waitForVisualReady(page,{minWait:4500,maxWait:14000});
    await progress('チラシをクリック中','元の店舗ページ上で「拡大して見る」を実際にクリックします',{url:sourceUrl});
    const popupPromise=new Promise(resolve=>{const timer=setTimeout(()=>resolve(null),12000);page.once('popup',p=>{clearTimeout(timer);resolve(p);});});
    const navPromise=page.waitForNavigation({waitUntil:'domcontentloaded',timeout:12000}).catch(()=>null);
    const clicked=await page.evaluate(({text,top,href})=>{
      const norm=s=>(s||'').replace(/\s+/g,' ').trim();
      const els=[...document.querySelectorAll('a,button,[role="button"],img')];
      const t=norm(text).slice(0,90);
      let e=els.find(x=>{const root=x.tagName==='IMG'?(x.closest('a,button,[role="button"]')||x):x;const tx=norm(`${root.innerText||''} ${x.alt||''} ${root.getAttribute?.('aria-label')||''}`);const hr=root.href||root.closest?.('a[href]')?.href||'';return (t&&tx.includes(t))||(href&&hr===href)||Math.abs((root.getBoundingClientRect().top+scrollY)-top)<12;});
      if(!e)return false;e=e.tagName==='IMG'?(e.closest('a,button,[role="button"]')||e):e;e.scrollIntoView({block:'center'});e.click();return true;
    },{text:target.text,top:target.top,href:target.href});
    if(!clicked)return [];
    popup=await popupPromise;await navPromise;
    const active=popup||page;if(popup){await preparePage(popup).catch(()=>{});}
    await waitForVisualReady(active,{minWait:6000,maxWait:18000});
    const blocked=await active.evaluate(()=>document.body?.innerText?.slice(0,6000)||'').catch(()=>'');
    if(/Access Denied|permission to access|Forbidden|Request blocked|アクセスが拒否/i.test(blocked)){await progress('アクセス拒否を検出','クリック先がAccess Deniedのため、この画像は保存しません');return [];}
    await progress('チラシを発見','実クリック後のチラシ表示を確認しました',{url:active.url()});
    return await captureViewer(active,runDir,tag,index,{preferFull});
  }finally{if(popup)await popup.close().catch(()=>{});if(page)await page.close().catch(()=>{});}
}

function assetsFromShots(shots,sourceUrl,sourceDateCheck,label){return shots.map((s,i)=>({url:`screenshot://${hash(`${sourceUrl}-${s.tag}-${i}`)}`,referer:sourceUrl,file:s.file,mime:'image/png',size:s.size,score:100,width:s.width,height:s.height,context:'store-specific-click-flow',captureMethod:'screenshot',provider:'official',sourceLabel:label,sourceDateCheck}));}


async function collectAkachanDealTargetsByText(page,progress){
  await progress('セール情報を確認中','「セール・チラシ情報」内の表示文字から「アカトク」と「紙おむつセール」を探しています');
  await page.evaluate(()=>document.querySelector('#deals')?.scrollIntoView({block:'start'})).catch(()=>{});
  await sleep(2200);
  const targets=await page.evaluate(()=>{
    const root=document.querySelector('#deals')||document;
    const norm=s=>(s||'').normalize('NFKC').replace(/\s+/g,' ').trim();
    const all=[...root.querySelectorAll('a[href],button,[role="button"]')];
    const picked=[];
    let akCount=0, diaperCount=0;
    for(let domIndex=0;domIndex<all.length;domIndex++){
      const el=all[domIndex];
      const img=el.querySelector('img');
      const text=norm(`${el.innerText||''} ${el.textContent||''} ${el.getAttribute('aria-label')||''} ${el.getAttribute('title')||''} ${img?.alt||''}`);
      let kind=null,occurrence=0;
      if(/アカ\s*トク/i.test(text)){ kind='アカトク'; occurrence=++akCount; }
      else if(/紙\s*[おオ]?むつ\s*(?:SALE|セール)|紙オムツ\s*(?:SALE|セール)/i.test(text)){ kind='紙おむつセール'; occurrence=++diaperCount; }
      if(!kind)continue;
      const r=el.getBoundingClientRect();
      if(r.width<40||r.height<20)continue;
      picked.push({
        kind,occurrence,domIndex,
        href:el.href||'',
        text:kind==='アカトク'?`アカトク${occurrence}`:`紙おむつセール${occurrence>1?occurrence:''}`,
        context:text.slice(0,1000),
        top:r.top+scrollY,width:r.width,height:r.height
      });
    }
    return picked;
  }).catch(()=>[]);
  const ak=targets.filter(x=>x.kind==='アカトク').slice(0,4);
  const diaper=targets.filter(x=>x.kind==='紙おむつセール').slice(0,1);
  const out=[...diaper,...ak];
  for(const t of out){
    await progress('対象バナーを発見',`${t.text} をページ内の表示文字から確認しました`,{target:t.text,url:t.href,occurrence:t.occurrence});
  }
  if(ak.length<4)await progress('対象バナー確認',`アカトクは ${ak.length}/4 件確認できました。見つからない分は推測してクリックしません`,{found:ak.length,expected:4});
  if(!diaper.length)await progress('対象バナー確認','紙おむつセールは現在のページ内で確認できませんでした');
  return out;
}

async function openAkachanTargetAndCapture(browser,sourceUrl,target,runDir,index,progress){
  let page=null,popup=null;
  try{
    page=await browser.newPage();await preparePage(page);
    await page.goto(sourceUrl,{waitUntil:'domcontentloaded',timeout:22000});
    await waitForVisualReady(page,{minWait:5000,maxWait:16000});
    await page.evaluate(()=>document.querySelector('#deals')?.scrollIntoView({block:'start'})).catch(()=>{});
    await sleep(1800);
    await progress('対象バナーをクリック中',`${target.text} をページ上でクリックしています`,{target:target.text,url:sourceUrl});
    const popupPromise=new Promise(resolve=>{const timer=setTimeout(()=>resolve(null),14000);page.once('popup',p=>{clearTimeout(timer);resolve(p);});});
    const navPromise=page.waitForNavigation({waitUntil:'domcontentloaded',timeout:14000}).catch(()=>null);
    const clicked=await page.evaluate(({kind,occurrence})=>{
      const root=document.querySelector('#deals')||document;
      const norm=s=>(s||'').normalize('NFKC').replace(/\s+/g,' ').trim();
      const all=[...root.querySelectorAll('a[href],button,[role="button"]')];
      let n=0;
      for(const el of all){
        const img=el.querySelector('img');
        const text=norm(`${el.innerText||''} ${el.textContent||''} ${el.getAttribute('aria-label')||''} ${el.getAttribute('title')||''} ${img?.alt||''}`);
        const ok=kind==='アカトク'?/アカ\s*トク/i.test(text):/紙\s*[おオ]?むつ\s*(?:SALE|セール)|紙オムツ\s*(?:SALE|セール)/i.test(text);
        if(!ok)continue;
        n++;
        if(n!==occurrence)continue;
        el.scrollIntoView({block:'center'});el.click();return true;
      }
      return false;
    },{kind:target.kind,occurrence:target.occurrence});
    if(!clicked){await progress('クリック失敗',`${target.text} のクリック対象を再特定できませんでした`);return[];}
    popup=await popupPromise;await navPromise;
    const active=popup||page;if(popup)await preparePage(popup).catch(()=>{});
    await waitForVisualReady(active,{minWait:7000,maxWait:22000});
    const blocked=await active.evaluate(()=>document.body?.innerText?.slice(0,8000)||'').catch(()=>'');
    if(/Access Denied|permission to access|Forbidden|Request blocked|アクセスが拒否/i.test(blocked)){await progress('アクセス拒否を検出',`${target.text} のクリック先がアクセス拒否のため保存しません`);return[];}
    await progress('チラシを発見',`${target.text} のクリック先を確認しました`,{url:active.url()});
    const isAkatoku=target.kind==='アカトク';
    if(isAkatoku){
      await progress('縦長ページを精査中',`${target.text} を上から下まで分割してスクリーンショットします`);
    }
    const shots=await captureViewer(active,runDir,`akachan-${target.kind==='アカトク'?`akatoku${target.occurrence}`:'diaper-sale'}`,index,{preferFull:false,maxSegments:isAkatoku?18:8});
    return shots.map(s=>({...s,sourceGroup:target.text,allowedCategories:isAkatoku?['粉ミルク・液体ミルク','離乳食・ベビーフード']:['おむつ・おしりふき']}));
  }finally{if(popup)await popup.close().catch(()=>{});if(page)await page.close().catch(()=>{});}
}

async function storeSpecificFlow(store,browser,runDir,progress){
  const source=store.sources[0];const page=await browser.newPage();await preparePage(page);const attempts=[];
  try{
    await progress('店舗ページ確認中',`${source.label} の指定URLを開いています`,{url:source.url});
    await page.goto(source.url,{waitUntil:'domcontentloaded',timeout:20000});await waitForVisualReady(page,{minWait:3000,maxWait:9000});
    const body=await page.evaluate(()=>document.body?.innerText?.slice(0,80000)||'');const title=await page.title();const sourceDateCheck=analyzeFlyerDates(flyerDateContext(body));
    const pages=[{url:source.url,title,body,method:'store-specific-browser',provider:'official',matched:pageMatchesStore(store,{title,body}),metadataDateCheck:sourceDateCheck}];
    let targets=[];let opts={maxNext:0,nextPatterns:[],turnPatterns:[]};
    if(store.id==='nishimatsuya'&&/現在[、,]?\s*セール情報はありません[。.]?/i.test(body)){
      await progress('セール情報なし','西松屋公式ページに「現在、セール情報はありません。」と表示されているため処理をスキップします');
      attempts.push({provider:'official',label:source.label,url:source.url,validated:true,assets:0,method:'store-specific-no-sale',note:'現在、セール情報はありません。'});
      return{pages,assets:[],selectedSource:source,attempts,noSale:true};
    }
    if(store.id==='nishimatsuya'){
      targets=await collectClickTargets(page,[/徳島南矢三店のセール情報はこちら/i,/チラシ/i,/子育て応援SALE/i],{scopeWords:[/セール情報はこちら/i]});
      // The heading itself is not clickable; nearby sale links/images are preferred.
      if(!targets.length)targets=await collectClickTargets(page,[/チラシ.*セール/i,/SALE/i]);
    }else if(store.id==='birthday-aizumi'){
      targets=await collectClickTargets(page,[/拡大して見る/i],{scopeWords:[/チラシ/i,/売出し期間/i]});
    }else if(store.id==='akachan-aizumi'){
      targets=await collectAkachanDealTargetsByText(page,progress);
    }else if(store.id==='direx'){
      targets=await collectClickTargets(page,[/田宮店チラシ/i,/チラシ/i],{scopeWords:[/田宮店/i,/チラシ/i]});opts={maxNext:2,nextPatterns:[/次へ/i,/裏面/i,/次のページ/i,/2\s*\/\s*2/i],turnPatterns:[]};
    }else if(store.id==='doramori'){
      targets=await collectClickTargets(page,[/チラシをみる/i,/チラシを見る/i,/チラシ/i]);opts={maxNext:3,nextPatterns:[/次のチラシ/i,/次へ/i],turnPatterns:[]};
    }else if(store.id==='cosmos'){
      targets=await collectClickTargets(page,[/最新のチラシ/i,/チラシを見る/i]);opts={maxNext:3,nextPatterns:[],turnPatterns:[/チラシをめくる/i,/次へ/i]};
    }else if(store.id==='lady'){
      targets=await collectClickTargets(page,[/トクバイ/i,/チラシ/i],{hrefIncludes:['tokubai']});opts={maxNext:3,nextPatterns:[/次のチラシ/i,/次へ/i],turnPatterns:[]};
    }else if(store.id==='aoki'){
      targets=await collectClickTargets(page,[/チラシを表示/i,/チラシ/i]);opts={maxNext:1,nextPatterns:[/次へ/i,/裏面/i],turnPatterns:[],preferFull:true};
    }else if(store.id==='donki'){
      targets=await collectClickTargets(page,[/WEBチラシ/i,/ウェブチラシ/i,/チラシ/i],{scopeWords:[/WEBチラシ/i,/チラシ/i]});opts={maxNext:2,nextPatterns:[/次へ/i,/次のチラシ/i,/裏面/i],turnPatterns:[]};
    }else return null;
    // Keep only likely clickable destinations / image buttons and cap duplicates.
    const seen=new Set();targets=targets.filter(t=>{const k=store.id==='akachan-aizumi'?`${t.kind||t.text}|${t.occurrence||0}|${t.href||''}|${Math.round(t.top||0)}`:(t.href||`${t.text}|${Math.round(t.top)}`);if(seen.has(k))return false;seen.add(k);return true;}).slice(0,store.id==='donki'?6:store.id==='akachan-aizumi'?5:4);
    if(!targets.length){attempts.push({provider:'official',label:source.label,url:source.url,validated:true,assets:0,method:'store-specific-click',note:'指定クリック対象を発見できず'});return{pages,assets:[],selectedSource:source,attempts};}
    await progress('チラシを発見',`指定ページでクリック対象を ${targets.length} 件発見しました`,{count:targets.length});
    const assets=[];
    for(let i=0;i<targets.length;i++){
      await progress('チラシをクリック中',`${i+1}/${targets.length} のチラシを開いています`,{target:targets[i].text,url:targets[i].href});
      const shots=store.id==='akachan-aizumi'?await openAkachanTargetAndCapture(browser,source.url,targets[i],runDir,i,progress):(store.id==='birthday-aizumi'||store.id==='lady')?await openTargetAndCaptureByRealClick(browser,source.url,targets[i],runDir,store.id,i,progress,opts):await openTargetAndCapture(browser,page,targets[i],runDir,store.id,i,progress,opts);
      if(shots.length){const shotAssets=assetsFromShots(shots,targets[i].href||source.url,sourceDateCheck,source.label).map((a,si)=>({...a,sourceGroup:shots[si]?.sourceGroup||targets[i].text,allowedCategories:shots[si]?.allowedCategories||null}));assets.push(...shotAssets);await progress('スクリーンショット取得完了',`${targets[i].text}: ${shots.length} 枚をOCR対象に追加しました`,{count:shots.length,target:targets[i].text});}
      if(assets.length>=(store.id==='akachan-aizumi'?80:12))break;
    }
    attempts.push({provider:'official',label:source.label,url:source.url,validated:true,assets:assets.length,method:'store-specific-click-screenshot'});
    return{pages,assets:assets.slice(0,store.id==='akachan-aizumi'?80:12),selectedSource:source,attempts};
  }finally{await page.close().catch(()=>{});}
}

async function captureFlyerArea(page,url,runDir,index=0){
  try{await page.goto(url,{waitUntil:'domcontentloaded',timeout:18000});await waitForVisualReady(page,{minWait:3500,maxWait:9000});const shots=await captureViewer(page,runDir,'generic',index);if(!shots.length)return null;const s=shots[0];return{url:`screenshot://${hash(url)}-${index}`,referer:url,file:s.file,mime:'image/png',size:s.size,score:30,width:s.width,height:s.height,context:'flyer-area-screenshot',captureMethod:'screenshot'};}catch{return null;}
}
async function inspectSource(store,source,runDir,collector,page=null,progress=async()=>{}){const visited=new Set(),queue=[{url:source.url,depth:0}],pages=[],collected=[];let sourceValidated=false;while(queue.length&&visited.size<5){const{url,depth}=queue.shift();if(visited.has(url))continue;visited.add(url);let d;try{await progress('店舗ページ確認中',`${source.label||source.provider} を確認しています`,{url,provider:source.provider});d=await collector(page,url);}catch(e){pages.push({url,error:e.message,provider:source.provider});continue;}const matched=pageMatchesStore(store,d);if(depth===0)sourceValidated=matched;const metadataDateCheck=analyzeFlyerDates(flyerDateContext(d.body||''));pages.push({url,title:d.title,body:d.body,method:d.method,provider:source.provider,matched,metadataDateCheck});if(depth===0&&!matched)break;for(const a of d.assets)if(a.url&&/^https?:/i.test(a.url))collected.push({...a,referer:url,provider:source.provider,sourceLabel:source.label,score:scoreAsset(a,source),sourceDateCheck:metadataDateCheck});if(depth<1){const interesting=d.links.filter(a=>{const txt=`${a.alt||''} ${a.context||''} ${a.url||''}`;return FLYER_WORDS.some(k=>txt.toLowerCase().includes(k.toLowerCase()));}).slice(0,10);for(const a of interesting){const u=absUrl(a.url,url);if(u)queue.push({url:u,depth:1});}for(const f of d.frames.slice(0,4)){const u=absUrl(f,url);if(u)queue.push({url:u,depth:1});}}}
  if(!sourceValidated)return{pages,assets:[],validated:false};const unique=[...new Map(collected.map(a=>[a.url,a])).values()].sort((a,b)=>b.score-a.score),candidates=unique.filter(a=>a.score>=8).slice(0,14),assets=[];if(candidates.length)await progress('チラシを発見',`${source.label||source.provider} でチラシ候補を ${candidates.length} 件発見しました`,{count:candidates.length});for(const a of candidates){await progress('チラシをダウンロード中','チラシ画像/PDFを取得しています',{assetUrl:a.url});const d=await download(a.url,a.referer,runDir);if(d){assets.push({...a,...d,captureMethod:'direct'});if(assets.length>=4)break;}}
  if(!assets.length&&page){await progress('スクリーンショット準備中','直接DLできないためチラシ表示領域を探しています');const shotTargets=[...new Set(pages.filter(p=>p.matched||FLYER_WORDS.some(k=>(p.url||'').toLowerCase().includes(k.toLowerCase()))).map(p=>p.url))].slice(0,3);for(let i=0;i<shotTargets.length;i++){await progress('スクリーンショット取得中',`チラシ表示領域 ${i+1}/${shotTargets.length} を撮影しています`,{url:shotTargets[i]});const shot=await captureFlyerArea(page,shotTargets[i],runDir,i);if(shot){const p=pages.find(x=>x.url===shotTargets[i]);assets.push({...shot,provider:source.provider,sourceLabel:source.label,sourceDateCheck:p?.metadataDateCheck||analyzeFlyerDates('')});}}}
  return{pages,assets,validated:true};}
async function scrapeByMethod(store,runDir,collector,page=null,progress=async()=>{}){const allPages=[],attempts=[];for(const source of store.sources){const r=await inspectSource(store,source,runDir,collector,page,progress);allPages.push(...r.pages);attempts.push({provider:source.provider,label:source.label,url:source.url,validated:r.validated,assets:r.assets.length,method:r.assets.some(a=>a.captureMethod==='screenshot')?'screenshot':'direct'});if(r.assets.length)return{pages:allPages,assets:r.assets,selectedSource:source,attempts};}return{pages:allPages,assets:[],selectedSource:store.sources[0],attempts};}
export async function scrapeStore(store,progress=async()=>{}){const runDir=path.join(TMP_ROOT,`${Date.now()}-${safeName(store.id)}`);await fs.mkdir(runDir,{recursive:true});let browser=null,browserError=null;try{try{browser=await launchBrowser();const exact=await storeSpecificFlow(store,browser,runDir,progress);if(exact?.noSale)return{store,...exact,runDir,acquisition:'official-no-sale',browserError:null,noSale:true};if(exact?.assets?.length)return{store,...exact,runDir,acquisition:'store-specific-click-screenshot',browserError:null};const page=await browser.newPage();await preparePage(page);const result=await scrapeByMethod(store,runDir,(_,url)=>collectPageBrowser(page,url),page,progress);await page.close().catch(()=>{});if(result.assets.length)return{store,...result,runDir,acquisition:result.assets.some(a=>a.captureMethod==='screenshot')?'browser-screenshot':'browser-direct',browserError:null};}catch(e){browserError=e?.message||String(e);}finally{if(browser)await browser.close().catch(()=>{});}const result=await scrapeByMethod(store,runDir,(_unused,url)=>collectPageHttp(url),null,progress);return{store,...result,runDir,acquisition:'http-fallback',browserError};}catch(e){e.message=`${e.message}${browserError?` / Chromium: ${browserError}`:''}`;throw e;}}
