import fs from 'node:fs/promises';
import path from 'node:path';
import { createWorker } from 'tesseract.js';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
if(!globalThis.DOMMatrix && DOMMatrix) globalThis.DOMMatrix=DOMMatrix;
if(!globalThis.ImageData && ImageData) globalThis.ImageData=ImageData;
if(!globalThis.Path2D && Path2D) globalThis.Path2D=Path2D;

let workerPromise;
async function getWorker(){
  if(!workerPromise) workerPromise=createWorker('jpn+eng');
  return workerPromise;
}
async function ocrBuffer(buffer){
  const worker=await getWorker();
  const {data}=await worker.recognize(buffer);
  return data.text || '';
}
async function ocrPdf(file){
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const bytes=new Uint8Array(await fs.readFile(file));
  const pdf=await pdfjs.getDocument({data:bytes,disableWorker:true}).promise;
  let text='';
  const maxPages=Math.min(pdf.numPages,4);
  for(let i=1;i<=maxPages;i++){
    const page=await pdf.getPage(i);
    const content=await page.getTextContent().catch(()=>null);
    const embedded=(content?.items||[]).map(x=>x.str).join(' ').trim();
    if(embedded.length>120){ text += `\n${embedded}`; continue; }
    const viewport=page.getViewport({scale:1.6});
    const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
    const ctx=canvas.getContext('2d');
    await page.render({canvasContext:ctx,viewport}).promise;
    const png=canvas.toBuffer('image/png');
    text += `\n${await ocrBuffer(png)}`;
  }
  return text;
}
export async function ocrAsset(asset){
  try{
    const ext=path.extname(asset.file).toLowerCase();
    const text=ext==='.pdf' ? await ocrPdf(asset.file) : await ocrBuffer(await fs.readFile(asset.file));
    return {text,error:null};
  }catch(e){ return {text:'',error:e.message}; }
}
export async function closeOcr(){
  if(workerPromise){ try{await (await workerPromise).terminate();}catch{} workerPromise=null; }
}
