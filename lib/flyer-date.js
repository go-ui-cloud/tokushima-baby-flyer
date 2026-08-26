const RANGE_RE = /(?:(20\d{2})\s*[年\/\.\-]\s*)?(1[0-2]|0?[1-9])\s*[月\/\.\-]\s*(3[01]|[12]\d|0?[1-9])\s*日?(?:\s*\([^)]*\))?\s*(?:～|〜|~|－|–|—|から|より)\s*(?:(20\d{2})\s*[年\/\.\-]\s*)?(?:(1[0-2]|0?[1-9])\s*[月\/\.\-]\s*)?(3[01]|[12]\d|0?[1-9])\s*日?/g;
const SINGLE_RE = /(?:(20\d{2})\s*[年\/\.\-]\s*)?(1[0-2]|0?[1-9])\s*[月\/\.\-]\s*(3[01]|[12]\d|0?[1-9])\s*日?/g;

function ymd(y,m,d){return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;}
function toDate(y,m,d){const x=new Date(Date.UTC(Number(y),Number(m)-1,Number(d),12));return Number.isNaN(x.getTime())?null:x;}
function inferYear(month, reference, explicitYear){
  if(explicitYear) return Number(explicitYear);
  const refY=reference.getUTCFullYear(), refM=reference.getUTCMonth()+1;
  // Around New Year, a January flyer seen in December normally belongs to next year,
  // while a December date seen in January normally belongs to the previous year.
  if(refM===12 && Number(month)<=2) return refY+1;
  if(refM===1 && Number(month)>=11) return refY-1;
  return refY;
}
function daysBetween(a,b){return Math.round((a.getTime()-b.getTime())/86400000);}

export function analyzeFlyerDates(text,{now=new Date()}={}){
  const clean=String(text||'').replace(/\s+/g,' ');
  const ref=new Date(now); const today=new Date(Date.UTC(ref.getUTCFullYear(),ref.getUTCMonth(),ref.getUTCDate(),12));
  const ranges=[]; let m;
  RANGE_RE.lastIndex=0;
  while((m=RANGE_RE.exec(clean))){
    const sy=inferYear(m[2],today,m[1]); const sm=Number(m[2]), sd=Number(m[3]);
    const em=Number(m[5]||sm); let ey=inferYear(em,today,m[4]||m[1]); const ed=Number(m[6]);
    if(!m[4] && em<sm && sm>=11 && em<=2) ey=sy+1;
    const start=toDate(sy,sm,sd), end=toDate(ey,em,ed); if(!start||!end) continue;
    if(end<start && !m[4]) end.setUTCFullYear(end.getUTCFullYear()+1);
    ranges.push({start,end,raw:m[0]});
  }
  let chosen=null;
  if(ranges.length){
    const active=ranges.filter(r=>r.start<=today&&today<=r.end).sort((a,b)=>b.start-a.start);
    chosen=active[0]||ranges.sort((a,b)=>b.end-a.end||b.start-a.start)[0];
  }
  if(!chosen){
    const singles=[]; SINGLE_RE.lastIndex=0;
    while((m=SINGLE_RE.exec(clean))){const y=inferYear(m[2],today,m[1]);const d=toDate(y,Number(m[2]),Number(m[3]));if(d)singles.push({date:d,raw:m[0]});}
    singles.sort((a,b)=>b.date-a.date);
    if(singles.length){chosen={start:singles[0].date,end:singles[0].date,raw:singles[0].raw,single:true};}
  }
  if(!chosen) return {status:'unknown',label:'日付不明',startDate:'不明',endDate:'不明',raw:'不明',isRecent:false,isCurrent:false,ageDays:null};
  const startDiff=daysBetween(today,chosen.start); const endDiff=daysBetween(today,chosen.end);
  const isCurrent=chosen.start<=today&&today<=chosen.end;
  const endedDaysAgo=daysBetween(today,chosen.end);
  const startsInDays=daysBetween(chosen.start,today);
  let status='stale',label='古い可能性';
  if(isCurrent){status='current';label='現在有効';}
  else if(endedDaysAgo>=0 && endedDaysAgo<=14){status='recent';label='最近終了';}
  else if(startsInDays>0 && startsInDays<=14){status='upcoming';label='近日開始';}
  const isRecent=['current','recent','upcoming'].includes(status);
  return {status,label,startDate:ymd(chosen.start.getUTCFullYear(),chosen.start.getUTCMonth()+1,chosen.start.getUTCDate()),endDate:ymd(chosen.end.getUTCFullYear(),chosen.end.getUTCMonth()+1,chosen.end.getUTCDate()),raw:chosen.raw,isRecent,isCurrent,ageDays:endDiff,startDiff};
}

export function pickLatestFlyers(flyers){
  const rank={current:5,upcoming:4,recent:3,unknown:2,stale:1};
  return [...flyers].sort((a,b)=>{
    const ar=rank[a.dateCheck?.status]||0, br=rank[b.dateCheck?.status]||0;
    if(br!==ar) return br-ar;
    const ad=a.dateCheck?.endDate==='不明'?'':a.dateCheck?.endDate||'';
    const bd=b.dateCheck?.endDate==='不明'?'':b.dateCheck?.endDate||'';
    if(bd!==ad) return bd.localeCompare(ad);
    return (b.score||0)-(a.score||0);
  });
}
