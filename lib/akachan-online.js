import { load } from 'cheerio';

const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36';
const normalize=(s='')=>String(s).replace(/\uFFFD/g,'').replace(/[\t\r]+/g,' ').replace(/\s+/g,' ').trim();
const abs=(href,base)=>{try{return new URL(href,base).href;}catch{return base;}};

export function akachanCategory(url='',name=''){
  if(/\/c\/cb32(?:7|8)/i.test(url)||/(?:紙)?おむつ|オムツ|パンパース|ムーニー|メリーズ|グーン/i.test(name))return 'おむつ・おしりふき';
  if(/\/c\/cb162/i.test(url)||/粉ミルク|液体ミルク|乳児用ミルク|ほほえみ|はぐくみ|すこやか|アイクレオ/i.test(name))return '粉ミルク・液体ミルク';
  return '離乳食・ベビーフード';
}

function parsePage(html,url){
  const $=load(html),items=[],pages=[];
  $('.block-thumbnail-t--goods').each((_,node)=>{
    const card=$(node),sale=card.find('.block-thumbnail-t--price.sale').first();
    if(!sale.length)return;
    const link=card.find('a[href*="/shop/g/g"]').first();
    const href=abs(link.attr('href')||'',url);
    if(!/\/shop\/g\/g[^/]+\/?/i.test(href))return;
    const name=normalize(card.find('.block-thumbnail-t--goods-name').first().text()||link.attr('title'));
    const digits=normalize(sale.text()).match(/(\d{1,3}(?:,\d{3})+|\d{2,7})\s*円?/);
    if(!name||!digits)return;
    const img=card.find('img').first();
    const rawImage=img.attr('data-src')||img.attr('data-original')||img.attr('src')||'';
    items.push({category:akachanCategory(url,name),product:name,price:`${Number(digits[1].replaceAll(',','')).toLocaleString('ja-JP')}円`,startDate:'不明',endDate:'不明',sourceUrl:url,sourceUrls:[url],flyerUrl:href,confidence:'アカチャンホンポ公式・赤文字価格',notes:'赤文字価格',discountAfter:'赤文字価格',imageUrl:rawImage?abs(rawImage,url):null});
  });
  $('.pager a[href]').each((_,node)=>{
    const href=abs($(node).attr('href')||'',url);
    if(/\/shop\/c\/cb\d+(?:_ssld)?_p\d+\//i.test(href))pages.push(href);
  });
  return {items,pages:[...new Set(pages)]};
}

async function fetchPage(url){
  const res=await fetch(url,{headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml','accept-language':'ja-JP,ja;q=0.9'},redirect:'follow',signal:AbortSignal.timeout(30000)});
  if(!res.ok)throw new Error(`HTTP ${res.status}`);
  return parsePage(await res.text(),url);
}

export async function scrapeAkachanOnline(store,progress=async()=>{}){
  const merged=new Map(),pages=[];
  for(const source of store.sources||[]){
    const urls=[source.url];
    await progress('店舗ページ確認中',`アカチャンホンポオンライン「${source.label}」を確認しています`,{url:source.url});
    try{
      const first=await fetchPage(source.url);urls.push(...first.pages.slice(0,4));
      const results=[first];
      for(const pageUrl of urls.slice(1))results.push(await fetchPage(pageUrl));
      const pageItems=results.flatMap(x=>x.items);
      pages.push({url:source.url,label:source.label,pageCount:results.length,redPriceCount:pageItems.length});
      await progress('商品抽出中',`${source.label}: 赤文字価格を${pageItems.length}件確認しました`,{url:source.url,count:pageItems.length});
      for(const item of pageItems){
        const key=item.flyerUrl;
        const previous=merged.get(key);
        if(!previous){merged.set(key,item);continue;}
        merged.set(key,{...previous,sourceUrls:[...new Set([...(previous.sourceUrls||[]),item.sourceUrl])],imageUrl:previous.imageUrl||item.imageUrl});
      }
    }catch(e){pages.push({url:source.url,label:source.label,error:e.message});}
  }
  return {items:[...merged.values()].slice(0,300),pages,deduped:true};
}
