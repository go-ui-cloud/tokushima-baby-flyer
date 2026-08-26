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
function norm(s=''){return String(s).replace(/[\s　・／/\-−ー丁目番地号]/g,'').toLowerCase();}
function pageMatchesStore(store,data){const hay=norm(`${data.title||''} ${data.body||''}`);const strong=[store.exactStoreName,store.address,...(store.storeKeywords||[])].map(norm).filter(x=>x.length>=4);return strong.some(k=>hay.includes(k));}
function flyerDateContext(text=''){const t=String(text);const lower=t.toLowerCase();const chunks=[];for(const word of FLYER_WORDS){let from=0,idx;while((idx=lower.indexOf(word.toLowerCase(),from))>=0){chunks.push(t.slice(Math.max(0,idx-220),Math.min(t.length,idx+420)));from=idx+word.length;if(chunks.length>=20)break;}if(chunks.length>=20)break;}return chunks.length?chunks.join(' '):t.slice(0,5000);}
function scoreAsset(a,source){const hay=`${a.url} ${a.alt||''} ${a.context||''}`.toLowerCase();let s=0;if(FLYER_WORDS.some(w=>hay.includes(w.toLowerCase())))s+=10;if(isPdfUrl(a.url))s+=8;if((a.width||0)>=650&&(a.height||0)>=650)s+=7;if((a.width||0)>=1000||(a.height||0)>=1000)s+=4;if(source?.provider==='shufoo'&&/shufoo|chirashi|leaflet|flyer|image/i.test(a.url))s+=5;if(source?.provider==='official')s+=2;if(IGNORE.some(w=>hay.includes(w)))s-=15;if(/\.svg(?:\?|$)/i.test(a.url))s-=12;return s;}
async function launchBrowser(){const [{default:puppeteer},{default:chromium}]=await Promise.all([import('puppeteer-core'),import('@sparticuz/chromium')]);chromium.setGraphicsMode=false;let executablePath=process.env.CHROME_EXECUTABLE_PATH;if(!executablePath){const explicitBin=path.join(process.cwd(),'node_modules','@sparticuz','chromium','bin');executablePath=fsSync.existsSync(explicitBin)?await chromium.executablePath(explicitBin):await chromium.executablePath();}return puppeteer.launch({args:chromium.args,executablePath,headless:true,defaultViewport:{width:1440,height:1400,deviceScaleFactor:1.25}});}

async function collectPageBrowser(page,url){const network=[];const handler=res=>{const ct=(res.headers()['content-type']||'').toLowerCase();if(ct.includes('image/')||ct.includes('application/pdf'))network.push({url:res.url(),alt:'',context:'network',width:0,height:0});};page.on('response',handler);try{await page.goto(url,{waitUntil:'domcontentloaded',timeout:15000});await sleep(1400);await page.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=700){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,80));}window.scrollTo(0,0);});const data=await page.evaluate(()=>{const imgs=[...document.images].map(img=>({url:img.currentSrc||img.src,alt:img.alt||'',context:img.closest('a,figure,section,article,div')?.innerText?.slice(0,500)||'',width:img.naturalWidth||img.width||0,height:img.naturalHeight||img.height||0}));const links=[...document.querySelectorAll('a[href]')].map(a=>({url:a.href,alt:a.innerText||a.getAttribute('aria-label')||'',context:a.parentElement?.innerText?.slice(0,500)||'',width:0,height:0}));const frames=[...document.querySelectorAll('iframe[src]')].map(f=>f.src);return{imgs,links,frames,title:document.title,body:document.body?.innerText?.slice(0,70000)||''};});return{...data,assets:[...data.imgs,...data.links,...network],method:'browser'};}finally{page.off('response',handler);}}
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

async function captureViewer(page,runDir,tag,index=0,{maxSegments=7,preferFull=false}={}){
  await sleep(1200);
  // First try the actual flyer/canvas/image area. This is intentionally not a full page screenshot unless needed.
  const info=await page.evaluate(()=>{
    const keys=['flyer','chirashi','leaflet','catalog','viewer','paper','page','canvas','チラシ','広告','tokubai'];
    const els=[...document.querySelectorAll('img,canvas,iframe,[class*="flyer" i],[id*="flyer" i],[class*="viewer" i],[id*="viewer" i],main,article')];
    const ranked=els.map((el,i)=>{const r=el.getBoundingClientRect();const meta=`${el.id||''} ${typeof el.className==='string'?el.className:''} ${el.getAttribute?.('aria-label')||''} ${el.getAttribute?.('title')||''}`.toLowerCase();let score=0;if(keys.some(k=>meta.includes(k)))score+=20;if(['IMG','CANVAS','IFRAME'].includes(el.tagName))score+=8;if(r.width>=500&&r.height>=500)score+=12;if(r.width>=800&&r.height>=1000)score+=8;if(r.width<350||r.height<300)score-=40;return{i,score,area:r.width*r.height,tag:el.tagName};}).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||b.area-a.area);return ranked[0]||null;
  });
  const outputs=[];
  if(info){
    const handles=await page.$$('img,canvas,iframe,[class*="flyer" i],[id*="flyer" i],[class*="viewer" i],[id*="viewer" i],main,article');const el=handles[info.i];
    if(el){const box=await el.boundingBox();if(box&&box.width>=350&&box.height>=300&&box.height<=12000){const file=path.join(runDir,`${tag}-${index}-viewer.png`);try{await el.screenshot({path:file,type:'png'});const st=await fs.stat(file);if(st.size>=12000)outputs.push({file,size:st.size,width:Math.round(box.width),height:Math.round(box.height),tag:`${tag}-${index}-viewer`});}catch{}}}
  }
  if(outputs.length&&!preferFull)return outputs;
  // Long viewer fallback: split the rendered page into viewport-sized screenshots so OCR keeps readable text size.
  const dims=await page.evaluate(()=>({w:Math.max(document.documentElement.clientWidth,document.body?.clientWidth||0),h:Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0),vh:window.innerHeight}));
  const step=Math.max(900,Math.min(1350,dims.vh||1200));const count=Math.min(maxSegments,Math.max(1,Math.ceil(dims.h/step)));
  for(let i=0;i<count;i++){await page.evaluate(y=>scrollTo(0,y),i*step);await sleep(250);const file=path.join(runDir,`${tag}-${index}-seg${i+1}.png`);await page.screenshot({path:file,type:'png'});const st=await fs.stat(file);if(st.size>=12000)outputs.push({file,size:st.size,width:dims.w,height:step,tag:`${tag}-${index}-seg${i+1}`});}
  await page.evaluate(()=>scrollTo(0,0));return outputs;
}

async function openTargetAndCapture(browser,startPage,target,runDir,tag,index,progress,{nextPatterns=[],turnPatterns=[],maxNext=0,preferFull=false}={}){
  let page=null;try{
    page=await browser.newPage();await page.setUserAgent(UA);
    if(target.href&&/^https?:/i.test(target.href)){await progress('チラシページを開いています',target.text||target.href,{url:target.href});await page.goto(target.href,{waitUntil:'domcontentloaded',timeout:18000});}
    else{await page.goto(startPage.url(),{waitUntil:'domcontentloaded',timeout:18000});const clicked=await page.evaluate(({text,top})=>{const els=[...document.querySelectorAll('a,button,[role="button"],img')];const t=(text||'').slice(0,80);const e=els.find(x=>((x.innerText||x.alt||'').replace(/\s+/g,' ').trim().includes(t))||Math.abs((x.getBoundingClientRect().top+scrollY)-top)<10);if(!e)return false;(e.closest('a,button,[role="button"]')||e).click();return true;},{text:target.text,top:target.top});if(!clicked)return[];await sleep(1500);}
    await progress('チラシを発見','クリック先のチラシ表示を確認しました',{url:page.url()});
    let all=[];all.push(...await captureViewer(page,runDir,tag,index,{preferFull}));
    const repeat=[...nextPatterns,...turnPatterns];
    for(let n=0;n<maxNext;n++){
      const targets=await collectClickTargets(page,repeat);if(!targets.length)break;
      const t=targets[0];const before=page.url();
      try{if(t.href&&t.href!==before)await page.goto(t.href,{waitUntil:'domcontentloaded',timeout:15000});else await page.evaluate(({text,top})=>{const els=[...document.querySelectorAll('a,button,[role="button"],img')];const e=els.find(x=>((x.innerText||x.alt||'').replace(/\s+/g,' ').trim().includes((text||'').slice(0,80)))||Math.abs((x.getBoundingClientRect().top+scrollY)-top)<10);(e?.closest('a,button,[role="button"]')||e)?.click();},{text:t.text,top:t.top});await sleep(1000);await progress('次のチラシを発見',`${n+2}枚目を読み込みます`,{url:page.url()});all.push(...await captureViewer(page,runDir,`${tag}-next`,n,{preferFull}));}catch{break;}
    }
    return all;
  }finally{if(page)await page.close().catch(()=>{});}
}

function assetsFromShots(shots,sourceUrl,sourceDateCheck,label){return shots.map((s,i)=>({url:`screenshot://${hash(`${sourceUrl}-${s.tag}-${i}`)}`,referer:sourceUrl,file:s.file,mime:'image/png',size:s.size,score:100,width:s.width,height:s.height,context:'store-specific-click-flow',captureMethod:'screenshot',provider:'official',sourceLabel:label,sourceDateCheck}));}

async function storeSpecificFlow(store,browser,runDir,progress){
  const source=store.sources[0];const page=await browser.newPage();await page.setUserAgent(UA);const attempts=[];
  try{
    await progress('店舗ページ確認中',`${source.label} の指定URLを開いています`,{url:source.url});
    await page.goto(source.url,{waitUntil:'domcontentloaded',timeout:18000});await sleep(1200);
    const body=await page.evaluate(()=>document.body?.innerText?.slice(0,80000)||'');const title=await page.title();const sourceDateCheck=analyzeFlyerDates(flyerDateContext(body));
    const pages=[{url:source.url,title,body,method:'store-specific-browser',provider:'official',matched:pageMatchesStore(store,{title,body}),metadataDateCheck:sourceDateCheck}];
    let targets=[];let opts={maxNext:0,nextPatterns:[],turnPatterns:[]};
    if(store.id==='nishimatsuya'){
      targets=await collectClickTargets(page,[/徳島南矢三店のセール情報はこちら/i,/チラシ/i,/子育て応援SALE/i],{scopeWords:[/セール情報はこちら/i]});
      // The heading itself is not clickable; nearby sale links/images are preferred.
      if(!targets.length)targets=await collectClickTargets(page,[/チラシ.*セール/i,/SALE/i]);
    }else if(store.id==='birthday-aizumi'){
      targets=await collectClickTargets(page,[/拡大して見る/i],{scopeWords:[/チラシ/i,/売出し期間/i]});
    }else if(store.id==='akachan-aizumi'){
      targets=await collectClickTargets(page,[/\d{1,2}月.*アカトク/i,/アカトク/i,/紙おむつ.*SALE/i,/紙オムツ.*SALE/i],{scopeWords:[/セール.*チラシ情報/i,/SALE/i]});
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
    const seen=new Set();targets=targets.filter(t=>{const k=t.href||`${t.text}|${Math.round(t.top)}`;if(seen.has(k))return false;seen.add(k);return true;}).slice(0,store.id==='donki'?6:store.id==='akachan-aizumi'?4:4);
    if(!targets.length){attempts.push({provider:'official',label:source.label,url:source.url,validated:true,assets:0,method:'store-specific-click',note:'指定クリック対象を発見できず'});return{pages,assets:[],selectedSource:source,attempts};}
    await progress('チラシを発見',`指定ページでクリック対象を ${targets.length} 件発見しました`,{count:targets.length});
    const assets=[];
    for(let i=0;i<targets.length;i++){
      await progress('チラシをクリック中',`${i+1}/${targets.length} のチラシを開いています`,{target:targets[i].text,url:targets[i].href});
      const shots=await openTargetAndCapture(browser,page,targets[i],runDir,store.id,i,progress,opts);
      if(shots.length){assets.push(...assetsFromShots(shots,targets[i].href||source.url,sourceDateCheck,source.label));await progress('スクリーンショット取得完了',`${shots.length} 枚をOCR対象に追加しました`,{count:shots.length});}
      if(assets.length>=12)break;
    }
    attempts.push({provider:'official',label:source.label,url:source.url,validated:true,assets:assets.length,method:'store-specific-click-screenshot'});
    return{pages,assets:assets.slice(0,12),selectedSource:source,attempts};
  }finally{await page.close().catch(()=>{});}
}

async function captureFlyerArea(page,url,runDir,index=0){
  try{await page.goto(url,{waitUntil:'domcontentloaded',timeout:15000});await sleep(1800);const shots=await captureViewer(page,runDir,'generic',index);if(!shots.length)return null;const s=shots[0];return{url:`screenshot://${hash(url)}-${index}`,referer:url,file:s.file,mime:'image/png',size:s.size,score:30,width:s.width,height:s.height,context:'flyer-area-screenshot',captureMethod:'screenshot'};}catch{return null;}
}
async function inspectSource(store,source,runDir,collector,page=null,progress=async()=>{}){const visited=new Set(),queue=[{url:source.url,depth:0}],pages=[],collected=[];let sourceValidated=false;while(queue.length&&visited.size<5){const{url,depth}=queue.shift();if(visited.has(url))continue;visited.add(url);let d;try{await progress('店舗ページ確認中',`${source.label||source.provider} を確認しています`,{url,provider:source.provider});d=await collector(page,url);}catch(e){pages.push({url,error:e.message,provider:source.provider});continue;}const matched=pageMatchesStore(store,d);if(depth===0)sourceValidated=matched;const metadataDateCheck=analyzeFlyerDates(flyerDateContext(d.body||''));pages.push({url,title:d.title,body:d.body,method:d.method,provider:source.provider,matched,metadataDateCheck});if(depth===0&&!matched)break;for(const a of d.assets)if(a.url&&/^https?:/i.test(a.url))collected.push({...a,referer:url,provider:source.provider,sourceLabel:source.label,score:scoreAsset(a,source),sourceDateCheck:metadataDateCheck});if(depth<1){const interesting=d.links.filter(a=>{const txt=`${a.alt||''} ${a.context||''} ${a.url||''}`;return FLYER_WORDS.some(k=>txt.toLowerCase().includes(k.toLowerCase()));}).slice(0,10);for(const a of interesting){const u=absUrl(a.url,url);if(u)queue.push({url:u,depth:1});}for(const f of d.frames.slice(0,4)){const u=absUrl(f,url);if(u)queue.push({url:u,depth:1});}}}
  if(!sourceValidated)return{pages,assets:[],validated:false};const unique=[...new Map(collected.map(a=>[a.url,a])).values()].sort((a,b)=>b.score-a.score),candidates=unique.filter(a=>a.score>=8).slice(0,14),assets=[];if(candidates.length)await progress('チラシを発見',`${source.label||source.provider} でチラシ候補を ${candidates.length} 件発見しました`,{count:candidates.length});for(const a of candidates){await progress('チラシをダウンロード中','チラシ画像/PDFを取得しています',{assetUrl:a.url});const d=await download(a.url,a.referer,runDir);if(d){assets.push({...a,...d,captureMethod:'direct'});if(assets.length>=4)break;}}
  if(!assets.length&&page){await progress('スクリーンショット準備中','直接DLできないためチラシ表示領域を探しています');const shotTargets=[...new Set(pages.filter(p=>p.matched||FLYER_WORDS.some(k=>(p.url||'').toLowerCase().includes(k.toLowerCase()))).map(p=>p.url))].slice(0,3);for(let i=0;i<shotTargets.length;i++){await progress('スクリーンショット取得中',`チラシ表示領域 ${i+1}/${shotTargets.length} を撮影しています`,{url:shotTargets[i]});const shot=await captureFlyerArea(page,shotTargets[i],runDir,i);if(shot){const p=pages.find(x=>x.url===shotTargets[i]);assets.push({...shot,provider:source.provider,sourceLabel:source.label,sourceDateCheck:p?.metadataDateCheck||analyzeFlyerDates('')});}}}
  return{pages,assets,validated:true};}
async function scrapeByMethod(store,runDir,collector,page=null,progress=async()=>{}){const allPages=[],attempts=[];for(const source of store.sources){const r=await inspectSource(store,source,runDir,collector,page,progress);allPages.push(...r.pages);attempts.push({provider:source.provider,label:source.label,url:source.url,validated:r.validated,assets:r.assets.length,method:r.assets.some(a=>a.captureMethod==='screenshot')?'screenshot':'direct'});if(r.assets.length)return{pages:allPages,assets:r.assets,selectedSource:source,attempts};}return{pages:allPages,assets:[],selectedSource:store.sources[0],attempts};}
export async function scrapeStore(store,progress=async()=>{}){const runDir=path.join(TMP_ROOT,`${Date.now()}-${safeName(store.id)}`);await fs.mkdir(runDir,{recursive:true});let browser=null,browserError=null;try{try{browser=await launchBrowser();const exact=await storeSpecificFlow(store,browser,runDir,progress);if(exact?.assets?.length)return{store,...exact,runDir,acquisition:'store-specific-click-screenshot',browserError:null};const page=await browser.newPage();await page.setUserAgent(UA);const result=await scrapeByMethod(store,runDir,(_,url)=>collectPageBrowser(page,url),page,progress);await page.close().catch(()=>{});if(result.assets.length)return{store,...result,runDir,acquisition:result.assets.some(a=>a.captureMethod==='screenshot')?'browser-screenshot':'browser-direct',browserError:null};}catch(e){browserError=e?.message||String(e);}finally{if(browser)await browser.close().catch(()=>{});}const result=await scrapeByMethod(store,runDir,(_unused,url)=>collectPageHttp(url),null,progress);return{store,...result,runDir,acquisition:'http-fallback',browserError};}catch(e){e.message=`${e.message}${browserError?` / Chromium: ${browserError}`:''}`;throw e;}}
