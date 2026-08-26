import { BABY_TERMS } from './config.js';

const YEN = /(?:税込|税抜)?\s*[¥￥]?\s*(\d{2,6}(?:,\d{3})?)\s*円?/;
const DATE = /(?:(20\d{2})[年\/.\-])?\s*(1[0-2]|0?[1-9])[月\/.\-]\s*(3[01]|[12]\d|0?[1-9])日?/;
function catOf(line){ for(const [cat,terms] of Object.entries(BABY_TERMS)) if(terms.some(t=>line.includes(t))) return cat; return null; }
function findDate(s){ const m=s.match(DATE); if(!m) return '不明'; const y=m[1]||new Date().getFullYear(); return `${y}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`; }
function productName(s){ return s.replace(/\s+/g,' ').replace(/[¥￥]?\s*\d{2,6}(?:,\d{3})?\s*円?/g,'').trim().slice(0,140) || '商品名不明'; }
export function extractBabyItems(text, meta={}){
  const raw=String(text||'').replaceAll('\r','').split('\n').map(s=>s.trim()).filter(Boolean);
  const items=[];
  for(let i=0;i<raw.length;i++){
    const around=raw.slice(Math.max(0,i-2),Math.min(raw.length,i+3)).join(' ');
    const cat=catOf(around); if(!cat) continue;
    const pm=around.match(YEN);
    const name=productName(`${raw[i]} ${raw[i+1]||''}`);
    const key=`${cat}|${name}|${pm?.[1]||''}`;
    if(items.some(x=>x._key===key)) continue;
    items.push({_key:key,category:cat,product:name,price:pm?`${pm[1].replaceAll(',','')}円`:'不明',startDate:findDate(around),endDate:'不明',sourceUrl:meta.sourceUrl||'不明',flyerUrl:meta.flyerUrl||'不明',confidence:meta.confidence|| (pm?'OCR抽出':'要確認'),notes:pm?'公開情報から抽出':'価格を確定できず'});
  }
  return items.slice(0,80).map(({_key,...x})=>x);
}
