import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWorker } from 'tesseract.js';

const OCR_INIT_TIMEOUT_MS=18000;
const OCR_PAGE_TIMEOUT_MS=32000;
const PDF_MAX_PAGES=6;
let workerPromise;

function withTimeout(promise,ms,label){
  let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${label} が ${Math.round(ms/1000)} 秒でタイムアウトしました`)),ms);});
  return Promise.race([promise,timeout]).finally(()=>clearTimeout(timer));
}

async function createOcrWorker(){
  const corePath=path.join(process.cwd(),'node_modules','tesseract.js-core');
  return createWorker('jpn+eng',1,{corePath});
}
async function getWorker(){
  if(!workerPromise) workerPromise=withTimeout(createOcrWorker(),OCR_INIT_TIMEOUT_MS,'OCR初期化');
  try{return await workerPromise;}catch(e){workerPromise=null;throw e;}
}
async function ocrBuffer(buffer){
  const worker=await getWorker();
  const {data}=await withTimeout(worker.recognize(buffer),OCR_PAGE_TIMEOUT_MS,'画像OCR');
  return data.text||'';
}
async function getCanvasApi(){
  const mod=await import('@napi-rs/canvas');
  const {createCanvas,DOMMatrix,ImageData,Path2D}=mod;
  if(!globalThis.DOMMatrix&&DOMMatrix)globalThis.DOMMatrix=DOMMatrix;
  if(!globalThis.ImageData&&ImageData)globalThis.ImageData=ImageData;
  if(!globalThis.Path2D&&Path2D)globalThis.Path2D=Path2D;
  return {createCanvas};
}
async function loadPdfJs(){
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
  // pdfjs may still attempt a fake worker even with disableWorker in some builds.
  // Point it to the traced worker file explicitly on Vercel.
  const workerFile=path.join(process.cwd(),'node_modules','pdfjs-dist','legacy','build','pdf.worker.mjs');
  try{pdfjs.GlobalWorkerOptions.workerSrc=pathToFileURL(workerFile).href;}catch{}
  return pdfjs;
}
async function ocrPdf(file){
  const pdfjs=await loadPdfJs();
  const bytes=new Uint8Array(await fs.readFile(file));
  const pdf=await withTimeout(pdfjs.getDocument({data:bytes,disableWorker:true,useWorkerFetch:false,isEvalSupported:false}).promise,15000,'PDF読込');
  let text=''; const maxPages=Math.min(pdf.numPages,PDF_MAX_PAGES);
  for(let i=1;i<=maxPages;i++){
    const page=await withTimeout(pdf.getPage(i),10000,`PDF ${i}ページ目読込`);
    const content=await page.getTextContent().catch(()=>null);
    const embedded=(content?.items||[]).map(x=>x.str).join(' ').trim();
    if(embedded.length>120){text+=`\n${embedded}`;continue;}
    try{
      const {createCanvas}=await getCanvasApi();
      const viewport=page.getViewport({scale:1.45});
      const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
      const ctx=canvas.getContext('2d');
      await withTimeout(page.render({canvasContext:ctx,viewport}).promise,16000,`PDF ${i}ページ目描画`);
      text+=`\n${await ocrBuffer(canvas.toBuffer('image/png'))}`;
    }catch(e){if(embedded)text+=`\n${embedded}`;text+=`\n[PDF画像OCR失敗: ${e?.message||String(e)}]`;}
  }
  return text;
}
export async function ocrAsset(asset){
  try{const ext=path.extname(asset.file).toLowerCase();const text=ext==='.pdf'?await ocrPdf(asset.file):await ocrBuffer(await fs.readFile(asset.file));return {text,error:null};}
  catch(e){return {text:'',error:e?.message||String(e)};}
}
export async function ocrAssetRegion(asset,region={}){
  try{
    const ext=path.extname(asset.file).toLowerCase();
    if(ext==='.pdf')return {text:'',error:'PDF region OCR unsupported'};
    const mod=await import('@napi-rs/canvas');
    const img=await mod.loadImage(await fs.readFile(asset.file));
    const W=img.width,H=img.height;
    const x=Math.max(0,Math.min(W-1,Math.round((region.x??0)*W)));
    const y=Math.max(0,Math.min(H-1,Math.round((region.y??0)*H)));
    const w=Math.max(1,Math.min(W-x,Math.round((region.width??1)*W)));
    const h=Math.max(1,Math.min(H-y,Math.round((region.height??1)*H)));
    const scale=region.scale||2.4;
    const canvas=mod.createCanvas(Math.round(w*scale),Math.round(h*scale));
    const ctx=canvas.getContext('2d');
    ctx.drawImage(img,x,y,w,h,0,0,canvas.width,canvas.height);
    const text=await ocrBuffer(canvas.toBuffer('image/png'));
    return {text,error:null};
  }catch(e){return {text:'',error:e?.message||String(e)};}
}
export async function closeOcr(){if(workerPromise){try{await withTimeout((await workerPromise).terminate(),5000,'OCR終了');}catch{}workerPromise=null;}}

async function imageBlocks(file){
  const mod=await import('@napi-rs/canvas');
  const img=await mod.loadImage(await fs.readFile(file));
  const W=img.width,H=img.height;
  if(W<300||H<300)return [];
  // Flyer/product pages are commonly vertically stacked. Split into overlapping
  // product-sized bands so names/prices stay together, without exploding OCR cost.
  const bandH=Math.max(420,Math.min(900,Math.round(W*0.95)));
  const step=Math.max(320,Math.round(bandH*0.78));
  const blocks=[];
  for(let y=0,idx=0;y<H && idx<14;y+=step,idx++){
    const h=Math.min(bandH,H-y);
    if(h<220)break;
    const canvas=mod.createCanvas(W,h),ctx=canvas.getContext('2d');
    ctx.drawImage(img,0,y,W,h,0,0,W,h);
    const fileOut=file.replace(/(\.[^.]+)$/i,`-block${String(idx+1).padStart(2,'0')}.png`);
    await fs.writeFile(fileOut,canvas.toBuffer('image/png'));
    blocks.push({file:fileOut,x:0,y,width:W,height:h});
    if(y+h>=H)break;
  }
  return blocks;
}
export async function ocrAssetBlocks(asset){
  const ext=path.extname(asset.file).toLowerCase();
  if(ext==='.pdf')return [];
  try{
    const blocks=await imageBlocks(asset.file),out=[];
    for(const b of blocks){
      try{
        const text=await ocrBuffer(await fs.readFile(b.file));
        out.push({...b,text,error:null});
      }catch(e){out.push({...b,text:'',error:e?.message||String(e)});}
    }
    return out;
  }catch{return [];}
}
