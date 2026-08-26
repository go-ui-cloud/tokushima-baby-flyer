'use client';

import { useEffect, useMemo, useState } from 'react';

const CATEGORY_ORDER = ['おむつ・おしりふき','粉ミルク・液体ミルク','離乳食・ベビーフード','おもちゃ','ベビーケア・その他'];
const icons = {
  'おむつ・おしりふき':'🧷','粉ミルク・液体ミルク':'🍼','離乳食・ベビーフード':'🥣','おもちゃ':'🧸','ベビーケア・その他':'🫧'
};
const STORE_IDS=['nishimatsuya','birthday-aizumi','akachan-aizumi','direx','doramori','cosmos','lady','aoki','donki','costco-online'];
const STORE_NAMES={
  'nishimatsuya':'西松屋 徳島南矢三店','birthday-aizumi':'バースデイ 藍住店','akachan-aizumi':'アカチャンホンポ ゆめタウン徳島店','direx':'ダイレックス 田宮店','doramori':'ドラッグストアモリ 徳島住吉店','cosmos':'ドラッグコスモス 住吉店','lady':'レデイ薬局 田宮街道店','aoki':'クスリのアオキ 北島田店','donki':'MEGAドン・キホーテ徳島店','costco-online':'コストコオンライン'
};

function fmtDate(v){if(!v||v==='不明')return'不明';const d=new Date(v);return Number.isNaN(d.getTime())?v:d.toLocaleString('ja-JP');}

function ToggleGroup({title,values,labels,selected,onToggle,onAll,onNone}){
  return <div className="toggleGroup">
    <div className="toggleGroupHead"><strong>{title}</strong><div><button onClick={onAll}>すべて表示</button><button onClick={onNone}>すべて非表示</button></div></div>
    <div className="togglePills">{values.map(v=><button key={v} className={selected.has(v)?'on':'off'} onClick={()=>onToggle(v)}><span>{selected.has(v)?'✓':'−'}</span>{labels?.[v]||v}</button>)}</div>
  </div>;
}

export default function Home(){
  const [data,setData]=useState({updatedAt:null,results:[],persistence:{}});
  const [loading,setLoading]=useState(false);const [message,setMessage]=useState('');const [progress,setProgress]=useState(null);const [elapsed,setElapsed]=useState(0);
  const [visibleCategories,setVisibleCategories]=useState(()=>new Set(CATEGORY_ORDER));
  const [visibleStores,setVisibleStores]=useState(()=>new Set(STORE_IDS));
  async function load(){const res=await fetch('/api/latest',{cache:'no-store'});setData(await res.json());}
  const toggle=(setter)=>(v)=>setter(prev=>{const n=new Set(prev);n.has(v)?n.delete(v):n.add(v);return n;});
  async function update(){
    setLoading(true);const ids=STORE_IDS;const batchId=globalThis.crypto?.randomUUID?.()||`${Date.now()}`;
    try{let snapshot={...data,results:[...(data.results||[])]};let failed=0;
      for(let i=0;i<ids.length;i++){
        const started=Date.now();setElapsed(0);setProgress({index:i+1,total:ids.length,store:STORE_NAMES[ids[i]]||ids[i],phase:'開始',detail:'更新処理を開始しています'});setMessage(`最新チラシを取得・解析中… ${i+1}/${ids.length} ${STORE_NAMES[ids[i]]||ids[i]}`);
        const timer=setInterval(()=>setElapsed(Math.floor((Date.now()-started)/1000)),1000);
        const progressPoll=setInterval(async()=>{try{const r=await fetch(`/api/progress?storeId=${encodeURIComponent(ids[i])}`,{cache:'no-store'});if(!r.ok)return;const j=await r.json();const p=j.progress;if(p&&(!p.batchId||p.batchId===batchId))setProgress(prev=>({...prev,phase:p.phase||prev?.phase,detail:p.detail||'',serverUpdatedAt:p.updatedAt,extra:p.extra||{}}));}catch{}},1200);
        try{const controller=new AbortController();const abortTimer=setTimeout(()=>controller.abort(),300000);const res=await fetch('/api/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:ids[i],batchId}),signal:controller.signal});clearTimeout(abortTimer);const json=await res.json();if(!res.ok)throw new Error(json.error||`${ids[i]} の更新に失敗しました`);const current=[...(snapshot.results||[])];const idx=current.findIndex(r=>r.id===json.result.id);if(idx>=0)current[idx]=json.result;else current.push(json.result);snapshot={...snapshot,results:current,persistence:json.persistence||snapshot.persistence};setData(snapshot);if(json.result?.error)failed++;}
        catch(e){failed++;setMessage(`${STORE_NAMES[ids[i]]||ids[i]} は失敗/タイムアウト。次の店舗へ進みます… (${e.name==='AbortError'?'最大300秒タイムアウト':e.message})`);}finally{clearInterval(timer);clearInterval(progressPoll);}
      }
      const finalRes=await fetch('/api/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'finalize',batchId,snapshot})});const finalJson=await finalRes.json();if(!finalRes.ok)throw new Error(finalJson.error||'履歴保存に失敗しました');setData(finalJson);setMessage(failed?`更新完了：${ids.length-failed}店舗成功 / ${failed}店舗失敗。履歴を保存しました`:'全店舗を更新し、履歴を保存しました');
    }catch(e){setMessage(`更新エラー: ${e.message}`);await load().catch(()=>{});}finally{setLoading(false);setProgress(null);setElapsed(0);}
  }
  useEffect(()=>{load().catch(e=>setMessage(e.message));},[]);
  const availableStoreIds=useMemo(()=>STORE_IDS.filter(id=>(data.results||[]).some(r=>r.id===id)),[data]);
  const visibleResults=(data.results||[]).filter(store=>visibleStores.has(store.id));
  return <main>
    <header className="topbar"><div><p className="eyebrow">TOKUSHIMA BABY SALE</p><div className="mainTitleRow"><h1>ベビー用品 チラシチェッカー</h1><span className="versionBadge">ver 2.11</span></div><p className="sub">指定店舗の公式チラシを最優先。取得状況を「チラシを発見」「OCRを実行中」などリアルタイム表示します。最新性は掲載側の日付とチラシ内の日付の2段階で確認します。コストコオンラインは指定した2ページ内で「¥○○引き後」が明記された商品をカテゴリ判定なしで表示します。ベビー服は対象外です。</p></div><div className="actions"><a className="ghostButton" href="/api/history.csv">CSV履歴</a><button className="updateButton" onClick={update} disabled={loading}>{loading?'解析中…':'↻ 最新情報に更新'}</button></div></header>
    <section className="summary"><div><span>最終更新</span><strong>{data.updatedAt?fmtDate(data.updatedAt):'未更新'}</strong></div><div><span>履歴保存</span><strong>{data.persistence?.database?'DB':'未設定'}</strong></div><div><span>チラシ保存</span><strong>{data.persistence?.blob?'Vercel Blob':'元URLのみ'}</strong></div><div><span>抽出方針</span><strong>店舗固定・進捗表示・2段階日付確認</strong></div></section>
    {message&&<p className="notice">{message}</p>}{progress&&<div className="progressPanel"><div className="progressTop"><strong>{progress.store}</strong><span>{progress.index}/{progress.total} ・ {elapsed}秒</span></div><div className="progressTrack"><div className="progressBar" style={{width:`${Math.max(6,(progress.index-1)/progress.total*100)}%`}}/></div><div className="progressPhase"><strong>{progress.phase}</strong>{progress.detail&&<span>{progress.detail}</span>}</div><small>通常は1店舗120秒。文字量・ページ数が多い場合のみ最大300秒（5分）まで自動延長します。</small></div>}
    {!data.persistence?.database&&<p className="warning">DATABASE_URL が未設定です。Vercel本番ではNeonを接続してください。</p>}
    <section className="filterPanel"><ToggleGroup title="カテゴリ表示" values={CATEGORY_ORDER} selected={visibleCategories} onToggle={toggle(setVisibleCategories)} onAll={()=>setVisibleCategories(new Set(CATEGORY_ORDER))} onNone={()=>setVisibleCategories(new Set())}/><ToggleGroup title="店舗表示" values={availableStoreIds.length?availableStoreIds:STORE_IDS} labels={STORE_NAMES} selected={visibleStores} onToggle={toggle(setVisibleStores)} onAll={()=>setVisibleStores(new Set(STORE_IDS))} onNone={()=>setVisibleStores(new Set())}/></section>
    <section className="storeList">{visibleResults.map(store=>{const items=(store.items||[]).filter(x=>visibleCategories.has(x.category));return <article className="store" key={store.id}><div className="storeHead"><div><div className="titleRow"><h2>{store.chain}</h2><span className="area">{store.area}</span></div><p className="stores">対象: {STORE_NAMES[store.id]||`${store.chain} ${store.area}`}</p></div><div className="sourceLinks"><a href={store.sourceUrl} target="_blank" rel="noreferrer">情報元</a>{(store.flyers||[]).slice(0,6).map((f,i)=><a key={`${f.url}-${i}`} href={f.viewerUrl||f.url} target="_blank" rel="noreferrer" title={`掲載側: ${f.sourceDateCheck?.raw||'不明'} / チラシ内: ${f.dateCheck?.raw||'不明'}`}>チラシ{(store.flyers||[]).length>1?i+1:''}{f.verification?.label?`・${f.verification.label}`:''}</a>)}</div></div>{store.error&&<p className="error">取得エラー: {store.error}</p>}{!store.error&&store.durationMs!=null&&<p className="storeMeta">前回処理時間: {(store.durationMs/1000).toFixed(1)}秒 ／ チラシ取得元: {store.sourceProvider||'不明'} ／ 最新性: {store.flyerFreshness||'不明'}{store.extendedAnalysis?' ／ 5分モード':''}</p>}{(store.warnings||[]).length>0&&<p className="warning storeWarning">{store.warnings.slice(0,3).join(' / ')}</p>}{!items.length?<div className="empty">{store.id==='costco-online'?'指定したコストコオンライン2ページで「¥○○引き後」が明記された商品を確認できませんでした。':'現在の最新チラシ内で、表示対象カテゴリのベビー用品を確認できませんでした。'}</div>:<div className="cards">{items.map((x,i)=><div className="card" key={`${x.product}-${i}`}><div className="icon">{icons[x.category]||'🧺'}</div><span className="cat">{x.category}</span><h3>{x.product}</h3>{x.discountAfter&&<div className="discountAfter">{x.discountAfter}</div>}<div className="price">{x.price}</div><dl><div><dt>販売開始日</dt><dd>{x.startDate}</dd></div><div><dt>終了日</dt><dd>{x.endDate}</dd></div><div><dt>抽出方法</dt><dd>{x.confidence}</dd></div></dl><a className="detailLink" href={x.flyerUrl!=='不明'?x.flyerUrl:x.sourceUrl} target="_blank" rel="noreferrer">情報を確認 →</a></div>)}</div>}</article>;})}</section>
  </main>;
}
