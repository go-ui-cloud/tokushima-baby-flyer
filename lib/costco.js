import { load } from 'cheerio';

const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36';
// V2.11: Costco is source-page driven. No item keyword/category gate.
// Only a literal "¥○○引き後" / "￥○○引き後" qualifies.
const DISCOUNT_AFTER=/[¥￥]\s*(\d{1,3}(?:,\d{3})*|\d{2,6})\s*引き後/;
function normalize(s=''){return String(s).replace(/\uFFFD/g,'').replace(/[\t\r]+/g,' ').replace(/\s+/g,' ').trim();}
function decodeBody(buffer,contentType=''){
  const m=String(contentType).match(/charset=([^;]+)/i);const charset=(m?.[1]||'utf-8').trim().replace(/["']/g,'');
  try{return new TextDecoder(charset,{fatal:false}).decode(buffer);}catch{return new TextDecoder('utf-8',{fatal:false}).decode(buffer);}
}
function candidateBlocks($){
  const sels=['.product-item','.product__listing .product-item','li.product__list--item','.product-listing-item','article','.product-tile','.product-item-container','.product-item-info','[class*="product"]'];
  const out=[];for(const sel of sels)$(sel).each((_,el)=>{const t=normalize($(el).text());if(t.length>=10)out.push({text:t,href:$(el).find('a[href]').first().attr('href')||'',name:normalize($(el).find('[class*="name"],h2,h3,h4,a').first().text())});});return out;
}
function fallbackBlocks(body){const out=[];let m;const r=new RegExp(DISCOUNT_AFTER.source,'g');while((m=r.exec(body))){out.push({text:normalize(body.slice(Math.max(0,m.index-300),Math.min(body.length,m.index+420))),href:'',name:''});if(out.length>120)break;}return out;}
function priceNear(text,discountIndex){
  const before=text.slice(Math.max(0,discountIndex-260),discountIndex);const after=text.slice(discountIndex,Math.min(text.length,discountIndex+260));
  const vals=[...before.matchAll(/[¥￥]\s*(\d{1,3}(?:,\d{3})+|\d{3,6})/g),...after.matchAll(/[¥￥]\s*(\d{1,3}(?:,\d{3})+|\d{3,6})/g)];
  const discount=text.match(DISCOUNT_AFTER)?.[1]?.replaceAll(',','');const candidates=vals.map(x=>x[1].replaceAll(',','')).filter(x=>x!==discount);
  return candidates.length?`¥${Number(candidates[candidates.length-1]).toLocaleString('ja-JP')}`:'不明';
}
function productName(block,dm){
  if(block.name&&block.name.length>=2)return block.name.slice(0,120);
  const text=block.text;const i=dm.index??0;
  let before=normalize(text.slice(Math.max(0,i-220),i));
  before=before.replace(/[¥￥]\s*\d[\d,]*/g,' ').replace(/(?:税込|通常価格|オンライン価格|割引|値引|OFF)\s*/gi,' ').replace(/\s+/g,' ').trim();
  const bits=before.split(/\s{2,}|[｜|]/).map(x=>x.trim()).filter(Boolean);
  return (bits.at(-1)||before||'商品名不明').slice(-120);
}
function categoryForUrl(url){
  if(/Diapers-Wipes\/c\/cos_8\.4/i.test(url))return 'おむつ・おしりふき';
  // This source page contains formula and kids snacks. We deliberately do not keyword-gate items.
  return '離乳食・ベビーフード';
}
function abs(href,base){try{return new URL(href,base).href;}catch{return base;}}
export async function scrapeCostcoOnline(store,progress=async()=>{}){
  const items=[];const pages=[];const seen=new Set();
  for(const url of store.categoryUrls||[]){
    await progress('店舗ページ確認中','指定したコストコオンラインページを確認しています',{url});
    const res=await fetch(url,{headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml','accept-language':'ja-JP,ja;q=0.9'},redirect:'follow',signal:AbortSignal.timeout(25000)});
    if(!res.ok){pages.push({url,error:`HTTP ${res.status}`});continue;}
    const buf=await res.arrayBuffer();const html=decodeBody(buf,res.headers.get('content-type')||'');const $=load(html);const body=normalize($('body').text());pages.push({url,title:normalize($('title').text()),bodyLength:body.length});
    await progress('商品抽出中','「¥○○引き後」が明記された商品をカテゴリ判定なしで抽出しています',{url});
    for(const b of [...candidateBlocks($),...fallbackBlocks(body)]){
      const text=normalize(b.text);if(!text)continue;const dm=text.match(DISCOUNT_AFTER);if(!dm)continue;
      const discount=`¥${Number(dm[1].replaceAll(',','')).toLocaleString('ja-JP')}引き後`;const price=priceNear(text,dm.index??0);const name=productName(b,dm);const category=categoryForUrl(url);const key=`${url}|${name}|${discount}|${price}`;if(seen.has(key))continue;seen.add(key);
      items.push({category,product:name,price,startDate:'不明',endDate:'不明',sourceUrl:url,flyerUrl:abs(b.href,url),confidence:'コストコ指定URL公式HTML抽出（カテゴリ判定なし）',notes:discount,discountAfter:discount});
    }
  }
  return {items:items.slice(0,160),pages};
}
