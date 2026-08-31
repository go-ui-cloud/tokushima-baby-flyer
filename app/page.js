'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

const CATEGORY_ORDER=['おむつ・おしりふき','粉ミルク・液体ミルク','離乳食・ベビーフード','おもちゃ','ベビーケア・その他','その他'];
const CATEGORY_META={
  'おむつ・おしりふき':{icon:'🧷',short:'おむつ・おしりふき'},
  '粉ミルク・液体ミルク':{icon:'🍼',short:'ミルク'},
  '離乳食・ベビーフード':{icon:'🥣',short:'離乳食・ベビーフード'},
  'おもちゃ':{icon:'🧸',short:'おもちゃ'},
  'ベビーケア・その他':{icon:'🧴',short:'ケア・その他'},
  'その他':{icon:'📦',short:'その他'}
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
function displayItemsForStore(store,selectedCategories=null){
  return (store.items||[]).filter(x=>!selectedCategories||selectedCategories.has(x.category));
}

function ToggleGroup({title,icon,values,labels,selected,onToggle,onAll,onNone,meta}){
  return <div className="toggleGroup">
    <div className="toggleGroupHead"><strong><span className="sectionIcon">{icon}</span>{title}</strong><div><button onClick={onAll}>すべて表示</button><button onClick={onNone}>すべて非表示</button></div></div>
    <div className="togglePills">{values.map(v=><button key={v} className={selected.has(v)?'on':'off'} onClick={()=>onToggle(v)}><span className="pillIcon">{meta?.[v]?.icon||''}</span><span>{selected.has(v)?'✓':'−'}</span>{labels?.[v]||meta?.[v]?.short||v}</button>)}</div>
  </div>;
}

export default function Home(){
  const [data,setData]=useState({updatedAt:null,results:[],persistence:{}});
  const [loading,setLoading]=useState(false);const [clearing,setClearing]=useState(false);const [message,setMessage]=useState('');const [progress,setProgress]=useState(null);const [elapsed,setElapsed]=useState(0);
  const [savingStore,setSavingStore]=useState(null);const [deletingId,setDeletingId]=useState(null);
  const [admin,setAdmin]=useState({loading:true,authenticated:false,configured:true});const [loggingIn,setLoggingIn]=useState(false);
  const [visibleCategories,setVisibleCategories]=useState(()=>new Set(CATEGORY_ORDER));
  const [visibleStores,setVisibleStores]=useState(()=>new Set(STORE_IDS));
  const currentAbortRef=useRef(null);const currentStoreRef=useRef(null);const currentBatchRef=useRef(null);const skipRequestedRef=useRef(false);

  async function load(){const res=await fetch('/api/latest',{cache:'no-store'});setData(await res.json());}
  async function checkAuth(){const res=await fetch('/api/admin-auth',{cache:'no-store'});setAdmin({loading:false,...await res.json()});}
  async function login(event){
    event.preventDefault();const form=event.currentTarget;const password=new FormData(form).get('password');setLoggingIn(true);
    try{const res=await fetch('/api/admin-auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});const json=await res.json();if(!res.ok)throw new Error(json.error||'ログインに失敗しました');form.reset();setAdmin({loading:false,authenticated:true,configured:true});setMessage('管理者としてログインしました。');}catch(e){setMessage(`ログインエラー: ${e.message}`);}finally{setLoggingIn(false);}
  }
  async function logout(){await fetch('/api/admin-auth',{method:'DELETE'});setAdmin(a=>({...a,authenticated:false}));setMessage('ログアウトしました。');}
  const toggle=(setter)=>(v)=>setter(prev=>{const n=new Set(prev);n.has(v)?n.delete(v):n.add(v);return n;});

  async function addManualItem(event,storeId){
    event.preventDefault();if(savingStore)return;
    const form=event.currentTarget;const body=new FormData(form);body.set('storeId',storeId);
    const start=String(body.get('startDate')||''),end=String(body.get('endDate')||'');
    if(start&&end&&end<start){setMessage('広告終了日は広告開始日以降にしてください。');return;}
    setSavingStore(storeId);setMessage(`${STORE_NAMES[storeId]}へ商品を登録しています…`);
    try{
      const res=await fetch('/api/manual-items',{method:'POST',body});const json=await res.json();
      if(!res.ok){if(res.status===401)setAdmin(a=>({...a,authenticated:false}));throw new Error(json.error||'商品の登録に失敗しました');}
      form.reset();await load();setMessage(`${STORE_NAMES[storeId]}へ商品を追加しました。`);
    }catch(e){setMessage(`登録エラー: ${e.message}`);}finally{setSavingStore(null);}
  }

  async function removeManualItem(item){
    if(!window.confirm(`「${item.product}」を削除しますか？`))return;
    setDeletingId(item.id);
    try{const res=await fetch('/api/manual-items',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id})});const json=await res.json();if(!res.ok){if(res.status===401)setAdmin(a=>({...a,authenticated:false}));throw new Error(json.error||'削除に失敗しました');}await load();setMessage(`「${item.product}」を削除しました。`);}catch(e){setMessage(`削除エラー: ${e.message}`);}finally{setDeletingId(null);}
  }

  async function clearCache(){
    if(loading||clearing)return;
    if(!window.confirm('コストコの自動取得キャッシュと保存済みチラシ画像を削除します。手動登録商品とCSV履歴は残ります。実行しますか？'))return;
    setClearing(true);setMessage('保存済みチラシ画像と現在表示キャッシュを削除しています…');
    try{
      const res=await fetch('/api/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'clear-cache'})});
      const json=await res.json().catch(()=>({}));if(!res.ok){if(res.status===401)setAdmin(a=>({...a,authenticated:false}));throw new Error(json.error||'キャッシュ削除に失敗しました');}
      await load();setMessage(`自動取得キャッシュを削除しました${json.blob?.deleted!=null?`（チラシ ${json.blob.deleted} 件削除）`:''}。手動登録商品と履歴CSVは残っています。`);
    }catch(e){setMessage(`キャッシュ削除エラー: ${e.message}`);}finally{setClearing(false);}
  }

  async function skipCurrent(){
    const storeId=currentStoreRef.current,batchId=currentBatchRef.current;if(!storeId)return;
    skipRequestedRef.current=true;setMessage(`${STORE_NAMES[storeId]||storeId} をスキップします…`);
    try{await fetch('/api/skip',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId,batchId})});}catch{}
    currentAbortRef.current?.abort();
  }

  async function syncProgress(){
    try{
      const r=await fetch('/api/progress',{cache:'no-store'}); if(!r.ok)throw new Error('進行状況を取得できませんでした');
      const {progress:active}=await r.json(); await load();
      if(!active){setMessage('実行中の更新は見つかりませんでした。最新の保存状態を読み込みました。');setProgress(null);return false;}
      const idx=STORE_IDS.indexOf(active.storeId); currentStoreRef.current=active.storeId; currentBatchRef.current=active.batchId||null;
      setProgress({index:idx>=0?idx+1:1,total:STORE_IDS.length,storeId:active.storeId,store:STORE_NAMES[active.storeId]||active.storeId,phase:active.phase||'処理中',detail:active.detail||'サーバーの進行状況へ同期しました',serverUpdatedAt:active.updatedAt,extra:active.extra||{}});
      setMessage(`実行中の更新に同期しました：${STORE_NAMES[active.storeId]||active.storeId} / ${active.phase||'処理中'}`); return true;
    }catch(e){setMessage(`進行状況の同期に失敗しました: ${e.message}`);return false;}
  }

  async function update(){
    if(loading){await syncProgress();return;}
    if(await syncProgress())return;
    setLoading(true);const ids=['costco-online'];const batchId=globalThis.crypto?.randomUUID?.()||`${Date.now()}`;currentBatchRef.current=batchId;
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
          let json=null;let continuationPass=1;let startAssetIndex=0;let previousResult=null;
          while(continuationPass<=2){
            const controller=new AbortController();currentAbortRef.current=controller;const abortTimer=setTimeout(()=>controller.abort(),295000);
            const res=await fetch('/api/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:ids[i],batchId,startAssetIndex,previousResult,continuationPass}),signal:controller.signal});clearTimeout(abortTimer);
            json=await res.json();if(!res.ok)throw new Error(json.error||`${ids[i]} の更新に失敗しました`);
            if(json.result?.skipped)break;
            if(json.result?.needsContinuation&&continuationPass<2){
              previousResult=json.result;startAssetIndex=json.result.nextAssetIndex||0;continuationPass++;
              setMessage(`${STORE_NAMES[ids[i]]||ids[i]}：5分処理の続き（2/2）を実行します…`);
              setProgress(prev=>({...prev,phase:'継続処理',detail:`Vercel制限のため2回目の5分処理を開始します（画像 ${startAssetIndex+1} から）`}));
              continue;
            }
            break;
          }
          if(json.result?.skipped){
            skipped++;skippedNames.push(STORE_NAMES[ids[i]]||ids[i]);
            setMessage(`${STORE_NAMES[ids[i]]||ids[i]} をスキップ。前回表示をそのまま残して次へ進みます…`);
          }else if(json.result?.preservePrevious){
            failed++;const failedId=json.result.id||ids[i];failedNames.push(STORE_NAMES[failedId]||failedId);
            setMessage(`${STORE_NAMES[failedId]||failedId} は取得失敗。前回表示を残して次へ進みます…`);
          }else{
            const current=[...(snapshot.results||[])];const idx=current.findIndex(r=>r.id===json.result.id);if(idx>=0)current[idx]=json.result;else current.push(json.result);
            snapshot={...snapshot,results:current,persistence:json.persistence||snapshot.persistence};setData(snapshot);
            if(json.result?.error){failed++;const failedId=json.result.id||ids[i];failedNames.push(STORE_NAMES[failedId]||failedId);}
          }
        }catch(e){
          if(skipRequestedRef.current){skipped++;skippedNames.push(STORE_NAMES[ids[i]]||ids[i]);setMessage(`${STORE_NAMES[ids[i]]||ids[i]} をスキップ。前回表示を残して次へ進みます…`);}else{failed++;failedNames.push(STORE_NAMES[ids[i]]||ids[i]);setMessage(`${STORE_NAMES[ids[i]]||ids[i]} は失敗/タイムアウト。前回表示を残して次へ進みます… (${e.name==='AbortError'?'1回の処理が295秒でタイムアウト':e.message})`);}
        }finally{currentAbortRef.current=null;clearInterval(timer);clearInterval(progressPoll);}
      }
      const finalRes=await fetch('/api/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'finalize',batchId,snapshot})});const finalJson=await finalRes.json();if(!finalRes.ok)throw new Error(finalJson.error||'履歴保存に失敗しました');await load();
      setMessage(`更新完了：${ids.length-failed-skipped}店舗成功 / ${skipped}店舗スキップ${skippedNames.length?`（${skippedNames.join('、')}）`:''} / ${failed}店舗失敗${failedNames.length?`（${failedNames.join('、')}）`:''}。前回表示を維持しながら更新しました。`);
    }catch(e){setMessage(`更新エラー: ${e.message}`);await load().catch(()=>{});}finally{setLoading(false);setProgress(null);setElapsed(0);currentAbortRef.current=null;currentStoreRef.current=null;currentBatchRef.current=null;}
  }

  useEffect(()=>{Promise.all([load(),checkAuth()]).catch(e=>setMessage(e.message));},[]);
  const availableStoreIds=useMemo(()=>STORE_IDS.filter(id=>(data.results||[]).some(r=>r.id===id)),[data]);
  const visibleResults=(data.results||[]).filter(store=>visibleStores.has(store.id));
  const totals=useMemo(()=>{const results=data.results||[];return{stores:results.length,items:results.reduce((n,r)=>n+displayItemsForStore(r).length,0),healthy:results.filter(r=>!r.error&&!r.skipped).length};},[data]);

  return <main>
    <header className="topbar">
      <div className="heroCopy"><p className="eyebrow">TOKUSHIMA BABY SALE</p><div className="mainTitleRow"><span className="heroIcon">🍼</span><h1>ベビー用品 チラシチェッカー</h1><span className="versionBadge">ver 3.0.2</span></div><p className="sub">徳島の各店舗で見つけたベビー用品の安売り情報を手動で登録・一覧表示します。コストコオンラインだけは公式ページから自動更新します。</p></div>
      <div className="actions"><a className="ghostButton" href="/api/history.csv">📄 CSV履歴</a>{admin.authenticated&&<><button className="cacheButton" onClick={clearCache} disabled={loading||clearing}>{clearing?'削除中…':'🧹 自動取得キャッシュ削除'}</button><button className="updateButton" onClick={update} disabled={clearing}>{loading?'🔄 進行状況を同期':'↻ コストコを更新'}</button><button className="logoutButton" onClick={logout}>ログアウト</button></>}</div>
    </header>

    <section className="summary">
      <div><span className="summaryIcon">🕒</span><span>最終更新</span><strong>{data.updatedAt?fmtDate(data.updatedAt):'未更新'}</strong></div>
      <div><span className="summaryIcon">🏪</span><span>表示店舗</span><strong>{totals.stores}店舗</strong></div>
      <div><span className="summaryIcon">🧺</span><span>取得商品</span><strong>{totals.items}件</strong></div>
      <div><span className="summaryIcon">💾</span><span>保存先</span><strong>{data.persistence?.database?'DB':'DB未設定'} / {data.persistence?.blob?'Blob':'元URL'}</strong></div>
    </section>

    {message&&<p className="notice">ℹ️ {message}</p>}
    {!admin.loading&&!admin.authenticated&&<section className="adminLogin"><div><strong>🔐 管理者ログイン</strong><p>商品を見るだけならログインは不要です。商品の登録・削除やコストコ更新を行うときだけログインしてください。</p></div>{admin.configured?<form onSubmit={login}><input name="password" type="password" required autoComplete="current-password" placeholder="管理者パスワード"/><button disabled={loggingIn}>{loggingIn?'確認中…':'ログイン'}</button></form>:<p className="authError">Vercelに ADMIN_PASSWORD と ADMIN_SESSION_SECRET を設定してください。</p>}</section>}
    {progress&&<div className="progressPanel"><div className="progressTop"><div className="progressStore"><span>{STORE_ICONS[progress.storeId]||'🏪'}</span><strong>{progress.store}</strong></div><span>{progress.index}/{progress.total} ・ {elapsed}秒</span></div><div className="progressTrack"><div className="progressBar" style={{width:`${Math.max(6,(progress.index-1)/progress.total*100)}%`}}/></div><div className="progressPhase"><span className="phaseIcon">{PHASE_ICONS[progress.phase]||'•'}</span><strong>{progress.phase}</strong>{progress.detail&&<span>{progress.detail}</span>}</div><div className="progressActions"><button type="button" onClick={skipCurrent}>⏭ この店舗をスキップ</button></div><small>通常は1店舗約5分。文字量・ページ数が多い場合は5分処理を最大2回に分け、合計約10分まで継続します。</small></div>}
    {!data.persistence?.database&&<p className="warning">⚠️ Neon/Postgres の接続情報を確認できません。既存のVercel Storage連携またはEnvironment Variablesを確認してください。</p>}

    <section className="filterPanel"><ToggleGroup title="カテゴリ表示" icon="🧩" values={CATEGORY_ORDER} selected={visibleCategories} meta={CATEGORY_META} onToggle={toggle(setVisibleCategories)} onAll={()=>setVisibleCategories(new Set(CATEGORY_ORDER))} onNone={()=>setVisibleCategories(new Set())}/><ToggleGroup title="店舗表示" icon="🏪" values={availableStoreIds.length?availableStoreIds:STORE_IDS} labels={STORE_NAMES} selected={visibleStores} onToggle={toggle(setVisibleStores)} onAll={()=>setVisibleStores(new Set(STORE_IDS))} onNone={()=>setVisibleStores(new Set())}/></section>

    <section className="storeList">{visibleResults.map(store=>{
      const items=displayItemsForStore(store,visibleCategories);const tone=freshnessTone(store.flyerFreshness||'');
      return <article className="store" key={store.id}>
        <div className="storeHead"><div className="storeIdentity"><div className="storeIconBox">{STORE_ICONS[store.id]||'🏪'}</div><div><div className="titleRow"><h2>{store.chain}</h2><span className="area">{store.area}</span></div><p className="stores">対象: {STORE_NAMES[store.id]||`${store.chain} ${store.area}`}</p></div></div>
          <div className="sourceLinks">{store.id==='costco-online'&&store.sourceUrls?.length?store.sourceUrls.map((src,i)=><a key={src.url} href={src.url} target="_blank" rel="noreferrer">🔗 情報元{i+1}</a>):<a href={store.sourceUrl} target="_blank" rel="noreferrer">🔗 情報元</a>}</div>
        </div>
        {store.id==='costco-online'?<><div className="storeStatusRow"><span className={`freshness ${tone}`}>📅 {store.flyerFreshness||'最新性不明'}</span>{store.durationMs!=null&&<span className="metaChip">⏱ {(store.durationMs/1000).toFixed(1)}秒</span>}</div>{store.error&&<p className="error">❌ 取得エラー: {store.error}</p>}{(store.warnings||[]).length>0&&<p className="warning storeWarning">⚠️ {store.warnings.slice(0,3).join(' / ')}</p>}</>:admin.authenticated&&<details className="manualFormBox"><summary>＋ この店舗に商品を追加</summary><form className="manualForm" onSubmit={e=>addManualItem(e,store.id)}><label>商品名 <b>必須</b><input name="product" required maxLength="120"/></label><label>商品画像ファイル<input name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif"/><small>URLを使う場合は選択しません</small></label><label className="manualWide">商品画像URL<input name="imageUrl" type="url" inputMode="url" maxLength="2000" placeholder="https://example.com/image.jpg"/><small>登録時に画像をダウンロードして保存します</small></label><label>価格 <b>必須</b><input name="price" required maxLength="40" placeholder="例：1,280円"/></label><label>広告開始日<input name="startDate" type="date"/></label><label>広告終了日<input name="endDate" type="date"/></label><label>カテゴリ <b>必須</b><select name="category" required defaultValue=""><option value="" disabled>選択してください</option>{CATEGORY_ORDER.map(x=><option key={x} value={x}>{x}</option>)}</select></label><label>情報元 <b>必須</b><select name="sourceType" required defaultValue=""><option value="" disabled>選択してください</option><option value="チラシ">チラシ</option><option value="アプリ">アプリ</option><option value="その他">その他</option></select></label><button type="submit" disabled={savingStore===store.id}>{savingStore===store.id?'画像取得・登録中…':'商品を登録'}</button></form></details>}
        {!items.length?<div className="empty"><span className="emptyIcon">🗂️</span><div><strong>{store.id==='costco-online'?'表示できる商品はありません':'登録商品はまだありません'}</strong><p>{store.id==='costco-online'?'指定したコストコオンライン2ページで赤文字の「引き後」がある商品を確認できませんでした。':admin.authenticated?'上の「この店舗に商品を追加」から安売り情報を登録してください。':'管理者ログイン後に安売り情報を登録できます。'}</p></div></div>:
        store.id==='costco-online'?<div className="cards">{items.map((x,i)=><div className="card costcoCard" key={itemKey(x,i)}>{x.imageUrl?<div className="productImageWrap"><img className="costcoThumb" src={x.imageUrl} alt={x.product} loading="lazy" referrerPolicy="no-referrer"/></div>:<div className="icon">{CATEGORY_META[x.category]?.icon||'🧺'}</div>}<span className="cat">{CATEGORY_META[x.category]?.icon||''} {x.category}</span><h3>{x.product}</h3>{x.discountAfter&&<div className="discountAfter">🔥 {x.discountAfter}</div>}<div className="price">{x.price}</div><dl><div><dt>開始日</dt><dd>{x.startDate}</dd></div><div><dt>終了日</dt><dd>{x.endDate}</dd></div></dl><a className="detailLink" href={x.flyerUrl!=='不明'?x.flyerUrl:x.sourceUrl} target="_blank" rel="noreferrer">情報を確認 ↗</a></div>)}</div>:<div className="cards manualCards">{items.map((x,i)=><div className="card manualCard" key={x.id||itemKey(x,i)}>{x.imageUrl?<div className="manualImageWrap"><img src={x.imageUrl} alt={x.product} loading="lazy" referrerPolicy="no-referrer"/></div>:<div className="manualNoImage">画像なし</div>}<span className="cat">{CATEGORY_META[x.category]?.icon||''} {x.category}</span><span className="manualSource">情報元：{x.sourceType||'その他'}</span><h3>{x.product}</h3><div className="price">{x.price}</div><dl><div><dt>広告開始日</dt><dd>{x.startDate==='不明'?'未設定':x.startDate}</dd></div><div><dt>広告終了日</dt><dd>{x.endDate==='不明'?'未設定':x.endDate}</dd></div></dl>{admin.authenticated&&<button className="deleteManual" type="button" disabled={deletingId===x.id} onClick={()=>removeManualItem(x)}>{deletingId===x.id?'削除中…':'削除'}</button>}</div>)}</div>}
      </article>;
    })}</section>
  </main>;
}
