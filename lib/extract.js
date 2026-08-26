import { BABY_TERMS, PROMO_TERMS, EXCLUDE_TEXT_TERMS } from './config.js';

const YEN = /(?:税込|税抜|本体価格)?\s*[¥￥]?\s*(\d{1,3}(?:,\d{3})+|\d{2,6})\s*円/;
const YEN_SYMBOL = /[¥￥]\s*(\d{1,3}(?:,\d{3})+|\d{2,6})/;
const DATE = /(?:(20\d{2})[年\/.\-])?\s*(1[0-2]|0?[1-9])[月\/.\-]\s*(3[01]|[12]\d|0?[1-9])日?/;
const DISCOUNT = /(?:\d{1,2}\s*%\s*OFF|\d{1,5}\s*円\s*(?:引|OFF)|半額|値下げ|値引き)/i;
const CLOTHING = ['ベビー服','ロンパース','カバーオール','肌着','スタイ','ベビーウェア','新生児服','子供服','こども服','トップス','ボトムス','パジャマ'];

function catOf(s){
  for(const [cat,terms] of Object.entries(BABY_TERMS)) if(terms.some(t=>s.includes(t))) return cat;
  return null;
}
function hasPromo(s){ return PROMO_TERMS.some(t=>s.includes(t)) || DISCOUNT.test(s); }
function excluded(s){ return EXCLUDE_TEXT_TERMS.some(t=>s.includes(t)) || CLOTHING.some(t=>s.includes(t)); }
function findDate(s){
  const m=s.match(DATE); if(!m) return '不明';
  const y=m[1]||new Date().getFullYear();
  return `${y}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
}
function priceOf(s){
  const m=s.match(YEN)||s.match(YEN_SYMBOL);
  return m ? `${m[1].replaceAll(',','')}円` : '不明';
}
function cleanName(s){
  return String(s||'')
    .replace(/(?:税込|税抜|本体価格)?\s*[¥￥]?\s*(?:\d{1,3}(?:,\d{3})+|\d{2,6})\s*円/g,' ')
    .replace(/\d{1,2}\s*%\s*OFF/gi,' ')
    .replace(/(?:特価|セール|SALE|値下げ?|値引き?|割引|クーポン|期間限定|目玉|広告の品|広告品|お買い得|お買得|売り出し|売出|よりどり|奉仕品|限定価格|会員価格|アプリ価格|今だけ|大特価|超特価)/gi,' ')
    .replace(/\s+/g,' ').trim().slice(0,90) || '商品名不明';
}
function chooseName(lines, i, cat){
  const candidates=[];
  for(let j=Math.max(0,i-1);j<=Math.min(lines.length-1,i+1);j++){
    const line=lines[j];
    if(excluded(line) || line.length>100) continue;
    const score=(catOf(line)===cat?5:0)+(priceOf(line)!=='不明'?1:0)+(hasPromo(line)?1:0)-(/\?|？/.test(line)?5:0);
    candidates.push({line,score});
  }
  candidates.sort((a,b)=>b.score-a.score || a.line.length-b.line.length);
  return cleanName(candidates[0]?.line || lines[i]);
}

export function extractBabyItems(text, meta={}){
  const raw=String(text||'').replaceAll('\r','').split('\n').map(s=>s.trim()).filter(Boolean);
  const items=[];
  for(let i=0;i<raw.length;i++){
    const lines=raw.slice(Math.max(0,i-2),Math.min(raw.length,i+3));
    const around=lines.join(' ');
    if(excluded(around)) continue;
    const cat=catOf(around); if(!cat) continue;

    // V2.4: 通常の商品一覧やFAQを出さない。明確な販促表現が必須。
    if(!hasPromo(around)) continue;

    // セール品としての確度を上げるため、価格・割引額/率のどちらもないものは除外。
    const price=priceOf(around);
    if(price==='不明' && !DISCOUNT.test(around)) continue;

    const name=chooseName(raw,i,cat);
    if(name==='商品名不明' || excluded(name) || /\?|？/.test(name)) continue;
    const key=`${cat}|${name}|${price}`;
    if(items.some(x=>x._key===key)) continue;
    items.push({
      _key:key,category:cat,product:name,price,
      startDate:findDate(around),endDate:'不明',
      sourceUrl:meta.sourceUrl||'不明',flyerUrl:meta.flyerUrl||'不明',
      confidence:meta.confidence||'販促情報抽出',notes:'特価・セール等の販促表現を確認'
    });
  }
  return items.slice(0,60).map(({_key,...x})=>x);
}
