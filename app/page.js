'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

const CATEGORY_ORDER=['おむつ・おしりふき','粉ミルク・液体ミルク','離乳食・ベビーフード','おもちゃ','ベビーケア・その他'];
const CATEGORY_META={
  'おむつ・おしりふき':{icon:'🧷',short:'おむつ・おしりふき'},
  '粉ミルク・液体ミルク':{icon:'🍼',short:'ミルク'},
  '離乳食・ベビーフード':{icon:'🥣',short:'離乳食・ベビーフード'},
  'おもちゃ':{icon:'🧸',short:'おもちゃ'},
  'ベビーケア・その他':{icon:'🧴',short:'ケア・その他'}
};
const STORE_IDS=['nishimatsuya','birthday-aizumi','akachan-aizumi','direx','doramori','cosmos','lady','aoki','donki','costco-online'];
const STORE_NAMES={
  'nishimatsuya':'西松屋 徳島南矢三店','birthday-aizumi':'バースデイ 藍住店','akachan-aizumi':'アカチャンホンポ ゆめタウン徳島店','direx':'ダイレックス 田宮店','doramori':'ドラッグストアモリ 徳島住吉店','cosmos':'ドラッグコスモス 住吉店','lady':'レデイ薬局 田宮街道店','aoki':'クスリのアオキ 北島田店','donki':'MEGAドン・キホーテ徳島店','costco-online':'コストコオンライン'
};
const STORE_ICONS={
  'nishimatsuya':'🛒','birthday-aizumi':'🎈','akachan-aizumi':'👶','direx':'🏷️','doramori':'💊','cosmos':'🌼','lady':'💗','aoki':'🟦','donki':'🐧','costco-online':'📦'
};
const PHASE_ICONS={
  '開始':'▶','店舗ページ確認中':'🌐','セール情報を確認中':'🔎','対象バナーを発見':'🎯','対象バナー確認':'🔎','対象バナーをクリック中':'👆','縦長ページを精査中':'📜','チラシを検索中':'🔎','チラシを発見':'✅','チラシ未発見':'⚠️','チラシ保存中':'💾','OCRを実行中':'🔤','日付確認中':'📅','商品抽出中':'🧺','5分モードへ延長':'⏱️','時間上限':'⌛','完了':'✅','スキップ':'⏭️','エラー':'❌'
};

function fmtDate(v){if(!v||v==='不明')return'不明';const d=new Date(v);return Number.isNaN(d.getTime())?v:d.toLocaleString('ja-JP');}
function freshnessTone(text=''){if(/2段階一致|現在有効/.test(text))return'good';if(/古い|不一致|エラー/.test(text))return'bad';if(/スキップ|なし/.test(text))return'neutral';return'warn';}
function itemKey(x,i){return `${x.product||'item'}|${x.flyerUrl||x.sourceUrl||''}|${i}`;}

function ToggleGroup({title,icon,values,labels,selected,onToggle,onAll,onNone,meta}){
  return <div className="toggleGroup">
    <div className="toggleGroupHead"><strong><span className="sectionIcon">{icon}</span>{title}</strong><div><button onClick={onAll}>すべて表示</button><button onClick={onNone}>すべて非表示</button></div></div>
    <div className="togglePills">{values.map(v=><button key={v} className={selected.has(v)?'on':'off'} onClick={()=>onToggle(v)}><span className="pillIcon">{meta?.[v]?.icon||''}</span><span>{selected.has(v)?'✓':'−'}</span>{labels?.[v]||meta?.[v]?.short||v}</button>)}</div>
  </div>;
}

export default function Home(){
  const [data,setData]=useState({updatedAt:null,results:[],persistence:{}});
  const [loading,setLoading]=useState(false);const [clearing,setClearing]=useState(false);const [message,setMessage]=useState('');const [progress,setProgress]=useState(null);const [elapsed,setElapsed]=useState(0);
  const [visibleCategories,setVisibleCategories]=useState(()=>new Set(CATEGORY_ORDER));
  const [visibleStores,setVisibleStores]=useState(()=>new Set(STORE_IDS));
  const currentAbortRef=useRef(null);const currentStoreRef=useRef(null);const currentBatchRef=useRef(null);const skipRequestedRef=useRef(false);

  async function load(){const res=await fetch('/api/latest',{cache:'no-store'});setData(await res.json());}
  const toggle=(setter)=>(v)=>setter(prev=>{const n=new Set(prev);n.has(v)?n.delete(v):n.add(v);return n;});

  async function clearCache(){
    if(loading||clearing)return;
    if(!window.confirm('保存済みの現在表示データとチラシ画像を削除します。CSV履歴は残ります。実行しますか？'))return;
    setClearing(true);setMessage('保存済みチラシ画像と現在表示キャッシュを削除しています…');
    try{
      const res=await fetch('/api/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'clear-cache'})});
      const json=await res.json().catch(()=>({}));if(!res.ok)throw new Error(json.error||'キャッシュ削除に失敗しました');
      await load();setMessage(`キャッシュを削除しました${json.blob?.deleted!=null?`（チラシ ${json.blob.deleted} 件削除）`:''}。履歴CSVは残っています。`);
    }catch(e){setMessage(`キャッシュ削除エラー: ${e.message}`);}finally{setClearing(false);}
  }

  async function skipCurrent(){
    const storeId=currentStoreRef.current,batchId=currentBatchRef.current;if(!storeId)return;
    skipRequestedRef.current=true;setMessage(`${STORE_NAMES[storeId]||storeId} をスキップします…`);
    try{await fetch('/api/skip',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId,batchId})});}catch{}
    currentAbortRef.current?.abort();
  }

  async function update(){
    if(loading)return;
    setLoading(true);const ids=STORE_IDS;const batchId=globalThis.crypto?.randomUUID?.()||`${Date.now()}`;currentBatchRef.current=batchId;
    try{
      // V2.16: 前回表示を保持したまま、取得に成功した店舗だけ順次差し替える。
      let snapshot={updatedAt:data.updatedAt||null,results:[...(data.results||[])],persistence:data.persistence||{}};
      setMessage('前回の表示を残したまま、最新情報を店舗ごとに更新します。');
      let failed=0,skipped=0;const failedNames=[],skippedNames=[];
      for(let i=0;i<ids.length;i++){
        const started=Date.now();currentStoreRef.current=ids[i];skipRequestedRef.current=false;setElapsed(0);
        setProgress({index:i+1,total:ids.length,storeId:ids[i],store:STORE_NAMES[ids[i]]||ids[i],phase:'開始',detail:'前回表示を維持したまま更新します'});
        setMessage(`更新中 ${i+1}/${ids.length}：${STORE_NAMES[ids[i]]||ids[i]}`);
        const timer=setInterval(()=>setElapsed(Math.floor((Date.now()-started)/1000)),1000);
        const progressPoll=setInterval(async()=>{try{const r=await fetch(`/api/progress?storeId=${encodeURIComponent(ids[i])}`,{cache:'no-store'});if(!r.ok)return;const j=await r.json();const p=j.progress;if(p&&(!p.batchId||p.batchId===batchId))setProgress(prev=>({...prev,phase:p.phase||prev?.phase,detail:p.detail||'',serverUpdatedAt:p.updatedAt,extra:p.extra||{}}));}catch{}},1200);
        try{
          const controller=new AbortController();currentAbortRef.current=controller;const abortTimer=setTimeout(()=>controller.abort(),300000);
          const res=await fetch('/api/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:ids[i],batchId}),signal:controller.signal});clearTimeout(abortTimer);
          const json=await res.json();if(!res.ok)throw new Error(json.error||`${ids[i]} の更新に失敗しました`);
          const current=[...(snapshot.results||[])];const idx=current.findIndex(r=>r.id===json.result.id);if(idx>=0)current[idx]=json.result;else current.push(json.result);
          snapshot={...snapshot,results:current,persistence:json.persistence||snapshot.persistence};setData(snapshot);
          if(json.result?.error){failed++;failedNames.push(STORE_NAMES[ids[i]]||ids[i]);}else if(json.result?.skipped){skipped++;skippedNames.push(STORE_NAMES[ids[i]]||ids[i]);}
        }catch(e){
          if(skipRequestedRef.current){skipped++;skippedNames.push(STORE_NAMES[ids[i]]||ids[i]);setMessage(`${STORE_NAMES[ids[i]]||ids[i]} をスキップ。前回表示を残して次へ進みます…`);}else{failed++;failedNames.push(STORE_NAMES[ids[i]]||ids[i]);setMessage(`${STORE_NAMES[ids[i]]||ids[i]} は失敗/タイムアウト。前回表示を残して次へ進みます… (${e.name==='AbortError'?'最大300秒タイムアウト':e.message})`);}
        }finally{currentAbortRef.current=null;clearInterval(timer);clearInterval(progressPoll);}
      }
      const finalRes=await fetch('/api/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'finalize',batchId,snapshot})});const finalJson=await finalRes.json();if(!finalRes.ok)throw new Error(finalJson.error||'履歴保存に失敗しました');setData(finalJson);
      setMessage(`更新完了：${ids.length-failed-skipped}店舗成功 / ${skipped}店舗スキップ${skippedNames.length?`（${skippedNames.join('、')}）`:''} / ${failed}店舗失敗${failedNames.length?`（${failedNames.join('、')}）`:''}。前回表示を維持しながら更新しました。`);
    }catch(e){setMessage(`更新エラー: ${e.message}`);await load().catch(()=>{});}finally{setLoading(false);setProgress(null);setElapsed(0);currentAbortRef.current=null;currentStoreRef.current=null;currentBatchRef.current=null;}
  }

  useEffect(()=>{load().catch(e=>setMessage(e.message));},[]);
  const availableStoreIds=useMemo(()=>STORE_IDS.filter(id=>(data.results||[]).some(r=>r.id===id)),[data]);
  const visibleResults=(data.results||[]).filter(store=>visibleStores.has(store.id));
  const totals=useMemo(()=>{const results=data.results||[];return{stores:results.length,items:results.reduce((n,r)=>n+(r.items?.length||0),0),healthy:results.filter(r=>!r.error&&!r.skipped).length};},[data]);

  return <main>
    <header className="topbar">
      <div className="heroCopy"><p className="eyebrow">TOKUSHIMA BABY SALE</p><div className="mainTitleRow"><span className="heroIcon">🍼</span><h1>ベビー用品 チラシチェッカー</h1><span className="versionBadge">ver 2.23</span></div><p className="sub">指定された各社の公式URLだけを使用。前回の表示を残したまま店舗ごとに更新します。キャッシュ削除は必要なときだけ手動で実行できます。</p></div>
      <div className="actions"><a className="ghostButton" href="/api/history.csv">📄 CSV履歴</a><button className="cacheButton" onClick={clearCache} disabled={loading||clearing}>{clearing?'削除中…':'🧹 キャッシュ削除'}</button><button className="updateButton" onClick={update} disabled={loading||clearing}>{loading?'⏳ 解析中…':'↻ 最新情報に更新'}</button></div>
    </header>

    <section className="summary">
      <div><span className="summaryIcon">🕒</span><span>最終更新</span><strong>{data.updatedAt?fmtDate(data.updatedAt):'未更新'}</strong></div>
      <div><span className="summaryIcon">🏪</span><span>表示店舗</span><strong>{totals.stores}店舗</strong></div>
      <div><span className="summaryIcon">🧺</span><span>取得商品</span><strong>{totals.items}件</strong></div>
      <div><span className="summaryIcon">💾</span><span>保存先</span><strong>{data.persistence?.database?'DB':'DB未設定'} / {data.persistence?.blob?'Blob':'元URL'}</strong></div>
    </section>

    {message&&<p className="notice">ℹ️ {message}</p>}
    {progress&&<div className="progressPanel"><div className="progressTop"><div className="progressStore"><span>{STORE_ICONS[progress.storeId]||'🏪'}</span><strong>{progress.store}</strong></div><span>{progress.index}/{progress.total} ・ {elapsed}秒</span></div><div className="progressTrack"><div className="progressBar" style={{width:`${Math.max(6,(progress.index-1)/progress.total*100)}%`}}/></div><div className="progressPhase"><span className="phaseIcon">{PHASE_ICONS[progress.phase]||'•'}</span><strong>{progress.phase}</strong>{progress.detail&&<span>{progress.detail}</span>}</div><div className="progressActions"><button type="button" onClick={skipCurrent}>⏭ この店舗をスキップ</button></div><small>通常は1店舗120秒。文字量・ページ数が多い場合のみ最大300秒（5分）まで自動延長します。</small></div>}
    {!data.persistence?.database&&<p className="warning">⚠️ Neon/Postgres の接続情報を確認できません。既存のVercel Storage連携またはEnvironment Variablesを確認してください。</p>}

    <section className="filterPanel"><ToggleGroup title="カテゴリ表示" icon="🧩" values={CATEGORY_ORDER} selected={visibleCategories} meta={CATEGORY_META} onToggle={toggle(setVisibleCategories)} onAll={()=>setVisibleCategories(new Set(CATEGORY_ORDER))} onNone={()=>setVisibleCategories(new Set())}/><ToggleGroup title="店舗表示" icon="🏪" values={availableStoreIds.length?availableStoreIds:STORE_IDS} labels={STORE_NAMES} selected={visibleStores} onToggle={toggle(setVisibleStores)} onAll={()=>setVisibleStores(new Set(STORE_IDS))} onNone={()=>setVisibleStores(new Set())}/></section>

    <section className="storeList">{visibleResults.map(store=>{
      const items=(store.items||[]).filter(x=>visibleCategories.has(x.category));const tone=freshnessTone(store.flyerFreshness||'');
      return <article className="store" key={store.id}>
        <div className="storeHead"><div className="storeIdentity"><div className="storeIconBox">{STORE_ICONS[store.id]||'🏪'}</div><div><div className="titleRow"><h2>{store.chain}</h2><span className="area">{store.area}</span></div><p className="stores">対象: {STORE_NAMES[store.id]||`${store.chain} ${store.area}`}</p></div></div>
          <div className="sourceLinks">{store.id==='costco-online'&&store.sourceUrls?.length?store.sourceUrls.map((src,i)=><a key={src.url} href={src.url} target="_blank" rel="noreferrer">🔗 情報元{i+1}</a>):<a href={store.sourceUrl} target="_blank" rel="noreferrer">🔗 情報元</a>}{(store.flyers||[]).filter(f=>f.viewerUrl||/^https?:/i.test(f.url||'')).slice(0,6).map((f,i)=><a key={`${f.url}-${i}`} href={f.viewerUrl||f.url} target="_blank" rel="noreferrer" title={`掲載側: ${f.sourceDateCheck?.raw||'不明'} / チラシ内: ${f.dateCheck?.raw||'不明'}`}>📰 チラシ{(store.flyers||[]).length>1?i+1:''}</a>)}</div>
        </div>
        <div className="storeStatusRow"><span className={`freshness ${tone}`}>📅 {store.flyerFreshness||'最新性不明'}</span>{store.durationMs!=null&&<span className="metaChip">⏱ {(store.durationMs/1000).toFixed(1)}秒</span>}{store.extendedAnalysis&&<span className="metaChip">🕔 5分モード</span>}{store.id!=='costco-online'&&store.sourceProvider&&<span className="metaChip">📡 {store.sourceProvider}</span>}</div>
        {store.error&&<p className="error">❌ 取得エラー: {store.error}</p>}{(store.warnings||[]).length>0&&<p className="warning storeWarning">⚠️ {store.warnings.slice(0,3).join(' / ')}</p>}
        {!items.length?<div className="empty"><span className="emptyIcon">🗂️</span><div><strong>表示できる商品はありません</strong><p>{store.id==='costco-online'?'指定したコストコオンライン2ページで赤文字の「引き後」がある商品を確認できませんでした。':'現在の最新チラシ内で、表示対象カテゴリのベビー用品を確認できませんでした。'}</p></div></div>:
        <div className="cards">{items.map((x,i)=><div className={`card ${store.id==='costco-online'?'costcoCard':''} ${store.id==='akachan-aizumi'?'akachanCard':''}`} key={itemKey(x,i)}>{x.imageUrl?<div className="productImageWrap"><img className={store.id==='costco-online'?'costcoThumb':'flyerThumb'} src={x.imageUrl} alt={x.product} loading="lazy" referrerPolicy="no-referrer"/></div>:<div className="icon">{CATEGORY_META[x.category]?.icon||'🧺'}</div>}{x.sourceGroup&&<span className="sourceGroup">📌 {x.sourceGroup}</span>}<span className="cat">{CATEGORY_META[x.category]?.icon||''} {x.category}</span><h3>{x.product}</h3>{x.discountAfter&&<div className="discountAfter">🔥 {x.discountAfter}</div>}<div className="price">{x.price}</div><dl><div><dt>開始日</dt><dd>{x.startDate}</dd></div><div><dt>終了日</dt><dd>{x.endDate}</dd></div>{store.id!=='costco-online'&&<div><dt>抽出方法</dt><dd>{x.confidence}</dd></div>}</dl><a className="detailLink" href={x.flyerUrl!=='不明'?x.flyerUrl:x.sourceUrl} target="_blank" rel="noreferrer">情報を確認 ↗</a></div>)}</div>}
      </article>;
    })}</section>
  </main>;
}
