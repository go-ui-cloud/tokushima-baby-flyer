const RANGE_RE = /(?:(20\d{2})\s*[年\/\.\-]\s*)?(1[0-2]|0?[1-9])\s*[月\/\.\-]\s*(3[01]|[12]\d|0?[1-9])\s*日?(?:\s*\([^)]*\))?\s*(?:～|〜|~|－|–|—|から|より)\s*(?:(20\d{2})\s*[年\/\.\-]\s*)?(?:(1[0-2]|0?[1-9])\s*[月\/\.\-]\s*)?(3[01]|[12]\d|0?[1-9])\s*日?/g;
const SINGLE_RE = /(?:(20\d{2})\s*[年\/\.\-]\s*)?(1[0-2]|0?[1-9])\s*[月\/\.\-]\s*(3[01]|[12]\d|0?[1-9])\s*日?/g;
function ymd(y,m,d){return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;}
function toDate(y,m,d){const x=new Date(Date.UTC(Number(y),Number(m)-1,Number(d),12));return Number.isNaN(x.getTime())?null:x;}
function inferYear(month,reference,explicitYear){if(explicitYear)return Number(explicitYear);const refY=reference.getUTCFullYear(),refM=reference.getUTCMonth()+1;if(refM===12&&Number(month)<=2)return refY+1;if(refM===1&&Number(month)>=11)return refY-1;return refY;}
function daysBetween(a,b){return Math.round((a.getTime()-b.getTime())/86400000);}
export function analyzeFlyerDates(text,{now=new Date()}={}){
  const clean=String(text||'').replace(/\s+/g,' ');const ref=new Date(now);const today=new Date(Date.UTC(ref.getUTCFullYear(),ref.getUTCMonth(),ref.getUTCDate(),12));const ranges=[];let m;
  RANGE_RE.lastIndex=0;while((m=RANGE_RE.exec(clean))){const sy=inferYear(m[2],today,m[1]),sm=Number(m[2]),sd=Number(m[3]),em=Number(m[5]||sm);let ey=inferYear(em,today,m[4]||m[1]);const ed=Number(m[6]);if(!m[4]&&em<sm&&sm>=11&&em<=2)ey=sy+1;const start=toDate(sy,sm,sd),end=toDate(ey,em,ed);if(!start||!end)continue;if(end<start&&!m[4])end.setUTCFullYear(end.getUTCFullYear()+1);ranges.push({start,end,raw:m[0]});}
  let chosen=null;if(ranges.length){const active=ranges.filter(r=>r.start<=today&&today<=r.end).sort((a,b)=>b.start-a.start);chosen=active[0]||ranges.sort((a,b)=>b.end-a.end||b.start-a.start)[0];}
  if(!chosen){const singles=[];SINGLE_RE.lastIndex=0;while((m=SINGLE_RE.exec(clean))){const y=inferYear(m[2],today,m[1]),d=toDate(y,Number(m[2]),Number(m[3]));if(d)singles.push({date:d,raw:m[0]});}singles.sort((a,b)=>b.date-a.date);if(singles.length)chosen={start:singles[0].date,end:singles[0].date,raw:singles[0].raw,single:true};}
  if(!chosen)return{status:'unknown',label:'日付不明',startDate:'不明',endDate:'不明',raw:'不明',isRecent:false,isCurrent:false,ageDays:null};
  const isCurrent=chosen.start<=today&&today<=chosen.end,endedDaysAgo=daysBetween(today,chosen.end),startsInDays=daysBetween(chosen.start,today);let status='stale',label='古い可能性';if(isCurrent){status='current';label='現在有効';}else if(endedDaysAgo>=0&&endedDaysAgo<=14){status='recent';label='最近終了';}else if(startsInDays>0&&startsInDays<=14){status='upcoming';label='近日開始';}const isRecent=['current','recent','upcoming'].includes(status);
  return{status,label,startDate:ymd(chosen.start.getUTCFullYear(),chosen.start.getUTCMonth()+1,chosen.start.getUTCDate()),endDate:ymd(chosen.end.getUTCFullYear(),chosen.end.getUTCMonth()+1,chosen.end.getUTCDate()),raw:chosen.raw,isRecent,isCurrent,ageDays:daysBetween(today,chosen.end)};
}
function d(v){if(!v||v==='不明')return null;const x=new Date(`${v}T12:00:00Z`);return Number.isNaN(x.getTime())?null:x;}
export function verifyFreshnessTwoStage(sourceCheck,flyerCheck){
  const s=sourceCheck||{status:'unknown'},f=flyerCheck||{status:'unknown'};
  if(s.status==='stale'||f.status==='stale'){
    if((s.status==='stale'&&f.status==='current')||(f.status==='stale'&&s.status==='current'))return{status:'conflict',label:'日付不一致',verified:false};
    return{status:'stale',label:'古い可能性',verified:false};
  }
  if(s.status==='unknown'&&f.status==='unknown')return{status:'unknown',label:'2段階とも日付不明',verified:false};
  if(s.status==='unknown')return{status:'flyer-only',label:`チラシ内のみ確認 (${f.label})`,verified:false};
  if(f.status==='unknown')return{status:'source-only',label:`掲載側のみ確認 (${s.label})`,verified:false};
  const ss=d(s.startDate),se=d(s.endDate),fs=d(f.startDate),fe=d(f.endDate);let close=true;
  if(ss&&fs&&Math.abs((ss-fs)/86400000)>14)close=false;if(se&&fe&&Math.abs((se-fe)/86400000)>14)close=false;
  if(!close)return{status:'conflict',label:'掲載日とチラシ内日付が不一致',verified:false};
  const current=s.status==='current'&&f.status==='current';
  return{status:current?'verified-current':'verified-recent',label:current?'2段階一致・現在有効':'2段階一致・最近',verified:true};
}
export function pickLatestFlyers(flyers){const rank={'verified-current':8,'verified-recent':7,'flyer-only':5,'source-only':4,unknown:3,conflict:1,stale:0};return[...flyers].sort((a,b)=>(rank[b.verification?.status]??2)-(rank[a.verification?.status]??2)||(b.score||0)-(a.score||0));}
