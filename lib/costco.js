import { load } from 'cheerio';
import { BABY_TERMS, EXCLUDE_TEXT_TERMS } from './config.js';

const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36';
const CLOTHING=['ベビー服','ロンパース','カバーオール','肌着','スタイ','ベビーウェア','新生児服','子供服','こども服','キッズ服','水着'];
// V2.10: Costco is deliberately strict. Only literal "¥○○引き後" / "￥○○引き後" is accepted.
const DISCOUNT_AFTER=/[¥￥]\s*(\d{1,3}(?:,\d{3})*|\d{2,6})\s*引き後/;
const PRICE=/(?:[¥￥]\s*|税込\s*)?(\d{1,3}(?:,\d{3})+|\d{3,6})\s*円?/;
function categoryOf(s){for(const [cat,terms] of Object.entries(BABY_TERMS))if(terms.some(t=>s.includes(t)))return cat;return null;}
function excluded(s){return EXCLUDE_TEXT_TERMS.some(t=>s.includes(t))||CLOTHING.some(t=>s.includes(t));}
function normalize(s=''){return String(s).replace(/\uFFFD/g,'').replace(/[\t\r]+/g,' ').replace(/\s+/g,' ').trim();}
function decodeBody(buffer,contentType=''){
  const m=String(contentType).match(/charset=([^;]+)/i);const charset=(m?.[1]||'utf-8').trim().replace(/["']/g,'');
  try{return new TextDecoder(charset,{fatal:false}).decode(buffer);}catch{return new TextDecoder('utf-8',{fatal:false}).decode(buffer);}
}
function candidateBlocks($){
  const sels=['.product-item','.product__listing .product-item','li.product__list--item','.product-listing-item','article','.product-tile','.product-item-container','.product-item-info','[class*="product"]'];
  const out=[];for(const sel of sels)$(sel).each((_,el)=>{const t=normalize($(el).text());if(t.length>=15)out.push({text:t,href:$(el).find('a[href]').first().attr('href')||''});});return out;
}
function fallbackBlocks(body){const out=[];let m;const r=new RegExp(DISCOUNT_AFTER.source,'g');while((m=r.exec(body))){out.push({text:normalize(body.slice(Math.max(0,m.index-260),Math.min(body.length,m.index+360))),href:''});if(out.length>100)break;}return out;}
function priceNear(text,discountIndex){
  const before=text.slice(Math.max(0,discountIndex-220),discountIndex);const after=text.slice(discountIndex,Math.min(text.length,discountIndex+240));
  const vals=[...before.matchAll(/[¥￥]\s*(\d{1,3}(?:,\d{3})+|\d{3,6})/g),...after.matchAll(/[¥￥]\s*(\d{1,3}(?:,\d{3})+|\d{3,6})/g)];
  const discount=text.match(DISCOUNT_AFTER)?.[1]?.replaceAll(',','');const candidates=vals.map(x=>x[1].replaceAll(',','')).filter(x=>x!==discount);
  return candidates.length?`¥${candidates[candidates.length-1].replace(/\B(?=(\d{3})+(?!\d))/g,',')}`:'不明';
}
function productName(text,cat){const terms=BABY_TERMS[cat]||[];let best='';for(const term of terms){const i=text.indexOf(term);if(i<0)continue;const chunk=normalize(text.slice(Math.max(0,i-100),Math.min(text.length,i+150))).replace(DISCOUNT_AFTER,' ').replace(/[¥￥]\s*\d[\d,]*/g,' ').replace(/\s+/g,' ').trim();if(chunk.length>best.length)best=chunk;}return(best||text).slice(0,120);}
function abs(href,base){try{return new URL(href,base).href;}catch{return base;}}
export async function scrapeCostcoOnline(store,progress=async()=>{}){
  const items=[];const pages=[];const seen=new Set();
  for(const url of store.categoryUrls||[]){
    await progress('店舗ページ確認中','指定したコストコオンラインカテゴリを確認しています',{url});
    const res=await fetch(url,{headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml','accept-language':'ja-JP,ja;q=0.9'},redirect:'follow',signal:AbortSignal.timeout(25000)});
    if(!res.ok){pages.push({url,error:`HTTP ${res.status}`});continue;}
    const buf=await res.arrayBuffer();const html=decodeBody(buf,res.headers.get('content-type')||'');const $=load(html);const body=normalize($('body').text());pages.push({url,title:normalize($('title').text()),bodyLength:body.length});
    await progress('商品抽出中','「¥○○引き後」が明記された対象商品だけを抽出しています',{url});
    for(const b of [...candidateBlocks($),...fallbackBlocks(body)]){
      const text=normalize(b.text);if(!text||excluded(text))continue;const dm=text.match(DISCOUNT_AFTER);if(!dm)continue;const cat=categoryOf(text);if(!cat)continue;
      const discount=`¥${Number(dm[1].replaceAll(',','')).toLocaleString('ja-JP')}引き後`;const price=priceNear(text,dm.index??0);const name=productName(text,cat);const key=`${cat}|${name}|${discount}|${price}`;if(seen.has(key))continue;seen.add(key);
      items.push({category:cat,product:name,price,startDate:'不明',endDate:'不明',sourceUrl:url,flyerUrl:abs(b.href,url),confidence:'コストコ指定カテゴリ公式HTML抽出',notes:discount,discountAfter:discount});
    }
  }
  return {items:items.slice(0,120),pages};
}
