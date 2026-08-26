import { BABY_TERMS, EXCLUDE_TEXT_TERMS } from './config.js';

const YEN = /(?:税込|税抜|本体価格)?\s*[¥￥]?\s*(\d{1,3}(?:,\d{3})+|\d{2,6})\s*円/;
const YEN_SYMBOL = /[¥￥]\s*(\d{1,3}(?:,\d{3})+|\d{2,6})/;
const DATE = /(?:(20\d{2})[年\/.\-])?\s*(1[0-2]|0?[1-9])[月\/.\-]\s*(3[01]|[12]\d|0?[1-9])日?/;
const CLOTHING = ['ベビー服','ロンパース','カバーオール','肌着','スタイ','ベビーウェア','新生児服','子供服','こども服','トップス','ボトムス','パジャマ','ワンピース','スカート','ズボン','パンツ','シャツ','トレーナー','アウター'];

// OCRの全角/半角、空白、中黒、大小文字の揺れを吸収する。
function norm(s){
  return String(s||'').normalize('NFKC').toLowerCase().replace(/[\s・･._\-ー]/g,'');
}
function matchTerms(s, cat){
  const n=norm(s);
  return (BABY_TERMS[cat]||[]).filter(t=>n.includes(norm(t)));
}
function catMatch(s){
  let best=null;
  for(const cat of Object.keys(BABY_TERMS)){
    const matched=matchTerms(s,cat);
    if(!matched.length) continue;
    // 長い固有語を優先。複数一致も加点する。
    const score=Math.max(...matched.map(t=>norm(t).length))+Math.min(matched.length,3)*2;
    if(!best || score>best.score) best={cat,matched,score};
  }
  return best;
}
function catOf(s){ return catMatch(s)?.cat||null; }
function excluded(s){ return EXCLUDE_TEXT_TERMS.some(t=>s.includes(t)) || CLOTHING.some(t=>s.includes(t)); }
function findDate(s){
  const m=s.match(DATE); if(!m) return '不明';
  const y=m[1]||new Date().getFullYear();
  return `${y}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
}
function priceOf(s){ const m=s.match(YEN)||s.match(YEN_SYMBOL); return m ? `${m[1].replaceAll(',','')}円` : '不明'; }
function cleanName(s){
  return String(s||'').replace(/(?:税込|税抜|本体価格)?\s*[¥￥]?\s*(?:\d{1,3}(?:,\d{3})+|\d{2,6})\s*円/g,' ')
    .replace(/\d{1,2}\s*%\s*OFF/gi,' ').replace(/(?:特価|セール|SALE|値下げ?|値引き?|割引|クーポン|期間限定|目玉|広告の品|広告品|お買い得|お買得|売り出し|売出|よりどり|奉仕品|限定価格|会員価格|アプリ価格|今だけ|大特価|超特価)/gi,' ')
    .replace(/^[・●■◆★☆\-ー\s]+|[・●■◆★☆\-ー\s]+$/g,' ').replace(/\s+/g,' ').trim().slice(0,90) || '商品名不明';
}
function chooseName(lines,i,cat){
  const candidates=[];
  for(let j=Math.max(0,i-1);j<=Math.min(lines.length-1,i+1);j++){
    const line=lines[j]; if(excluded(line)||line.length>110)continue;
    const matched=matchTerms(line,cat); const sameCat=catOf(line)===cat;
    const score=(sameCat?8:0)+(matched.length*3)+(matched.reduce((a,t)=>a+Math.min(norm(t).length,12),0)/4)-(/\?|？/.test(line)?8:0)-(line.length>75?2:0);
    candidates.push({line,score});
  }
  candidates.sort((a,b)=>b.score-a.score||a.line.length-b.line.length);
  return cleanName(candidates[0]?.line||lines[i]);
}
function nearbyPrice(lines,i){
  for(let d=0;d<=3;d++){const j=i+d;if(j>=lines.length)break;if(d>0&&catOf(lines[j]))break;const p=priceOf(lines[j]);if(p!=='不明')return p;}
  for(let d=1;d<=2;d++){const j=i-d;if(j<0)break;if(catOf(lines[j]))break;const p=priceOf(lines[j]);if(p!=='不明')return p;}
  return '不明';
}
export function extractBabyItems(text,meta={}){
  const raw=String(text||'').replaceAll('\r','').split('\n').map(s=>s.trim()).filter(Boolean); const items=[];
  for(let i=0;i<raw.length;i++){
    const line=raw[i]; if(excluded(line))continue;
    const detected=catMatch(line); if(!detected)continue; const cat=detected.cat;
    const name=chooseName(raw,i,cat); if(name==='商品名不明'||excluded(name)||/\?|？/.test(name))continue;
    const price=nearbyPrice(raw,i); const around=raw.slice(Math.max(0,i-2),Math.min(raw.length,i+4)).join(' ');
    const key=`${cat}|${name}|${price}`; if(items.some(x=>x._key===key))continue;
    items.push({_key:key,category:cat,product:name,price,startDate:findDate(around),endDate:'不明',sourceUrl:meta.sourceUrl||'不明',flyerUrl:meta.flyerUrl||'不明',confidence:meta.confidence||'チラシ内商品OCR抽出',notes:`判別語: ${detected.matched.slice(0,3).join(' / ')}`});
  }
  return items.slice(0,100).map(({_key,...x})=>x);
}
