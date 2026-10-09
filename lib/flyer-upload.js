import { BABY_TERMS } from './config.js';

const CATEGORIES=[...Object.keys(BABY_TERMS),'その他'];

function clean(value=''){
  return String(value).normalize('NFKC').replace(/[|｜]/g,' ').replace(/\s+/g,' ').trim();
}
function isNoise(value=''){
  return !value||value.length<2||/^(税込|税抜|本体|各|円|¥|￥|価格|広告|チラシ)$/u.test(value)||/^\d{1,2}[\/月.-]\d{1,2}/u.test(value);
}
function priceFrom(value=''){
  const text=clean(value).replace(/[Oo]/g,'0');
  const matches=[...text.matchAll(/[¥￥]?\s*([0-9][0-9,\.]{1,7})\s*円?/gu)];
  const candidates=matches.map(m=>Number(m[1].replace(/[,.]/g,''))).filter(n=>Number.isFinite(n)&&n>=50&&n<=999999);
  if(!candidates.length)return null;
  const amount=Math.max(...candidates);
  return `${amount.toLocaleString('ja-JP')}円`;
}
function categoryFor(text=''){
  const normalized=clean(text).toLocaleLowerCase('ja-JP');
  for(const [category,terms] of Object.entries(BABY_TERMS)){
    if(terms.some(term=>normalized.includes(String(term).normalize('NFKC').toLocaleLowerCase('ja-JP'))))return category;
  }
  return 'その他';
}
function endDateFrom(text=''){
  const now=new Date();
  const match=clean(text).match(/(?:(20\d{2})[年/.\-])?\s*(\d{1,2})[月/.\-](\d{1,2})日?\s*(?:まで|迄|終了)?/u);
  if(!match)return '';
  let year=Number(match[1]||now.getFullYear()),month=Number(match[2]),day=Number(match[3]);
  if(!match[1]&&month<now.getMonth()+1-6)year++;
  const date=new Date(year,month-1,day);
  if(date.getFullYear()!==year||date.getMonth()!==month-1||date.getDate()!==day)return '';
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
function overlapsHorizontally(a,b){
  if(!a?.bbox||!b?.bbox)return true;
  const overlap=Math.min(a.bbox.x1,b.bbox.x1)-Math.max(a.bbox.x0,b.bbox.x0);
  const width=Math.max(1,Math.min(a.bbox.x1-a.bbox.x0,b.bbox.x1-b.bbox.x0));
  return overlap/width>.15||Math.abs((a.bbox.x0+a.bbox.x1-b.bbox.x0-b.bbox.x1)/2)<Math.max(a.bbox.x1-a.bbox.x0,180);
}

export function extractFlyerItems(detail={}){
  const lines=(detail.lines||[]).map((line,index)=>({...line,index,text:clean(line.text)})).filter(line=>line.text);
  const globalEndDate=endDateFrom(detail.text||'');
  const results=[];
  for(const priceLine of lines){
    const price=priceFrom(priceLine.text);if(!price)continue;
    const candidates=lines.filter(line=>line.index<priceLine.index&&priceLine.index-line.index<=7&&overlapsHorizontally(line,priceLine)&&!priceFrom(line.text)&&!isNoise(line.text));
    const nameLines=candidates.slice(-2);
    const product=clean(nameLines.map(line=>line.text).join(' ')).slice(0,120);
    if(isNoise(product)||/^\d/u.test(product))continue;
    const around=lines.slice(Math.max(0,priceLine.index-5),Math.min(lines.length,priceLine.index+4)).map(line=>line.text).join(' ');
    results.push({selected:true,product,price,endDate:endDateFrom(around)||globalEndDate,category:categoryFor(`${product} ${around}`),sourceType:'チラシ'});
  }
  const seen=new Set();
  return results.filter(item=>{
    const key=`${item.product}|${item.price}`;if(seen.has(key))return false;seen.add(key);return true;
  }).slice(0,40);
}

export function validFlyerCategory(value){return CATEGORIES.includes(value);}
