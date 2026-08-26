'use client';

import { useEffect, useMemo, useState } from 'react';

const icons = {
  'おむつ': '🧷', 'おしりふき': '🫧', 'ミルク': '🍼',
  '離乳食': '🥣', 'ベビー服': '👶', '育児用品': '🧸'
};

function fmtDate(v) {
  if (!v || v === '不明') return '不明';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString('ja-JP');
}

export default function Home() {
  const [data, setData] = useState({ updatedAt: null, results: [], persistence: {} });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState('すべて');

  async function load() {
    const res = await fetch('/api/latest', { cache: 'no-store' });
    const json = await res.json();
    setData(json);
  }

  async function update() {
    setLoading(true);
    const ids=['nishimatsuya','birthday-aizumi','akachan-aizumi','direx','doramori','cosmos','lady','aoki','donki','costco'];
    const batchId=globalThis.crypto?.randomUUID?.() || `${Date.now()}`;
    try {
      let snapshot={...data,results:[...(data.results||[])]};
      for(let i=0;i<ids.length;i++){
        setMessage(`最新チラシを取得・解析中… ${i+1}/${ids.length}`);
        const res=await fetch('/api/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:ids[i],batchId})});
        const json=await res.json();
        if(!res.ok) throw new Error(json.error||`${ids[i]} の更新に失敗しました`);
        snapshot={...snapshot,results:(snapshot.results||[]).map(r=>r.id===json.result.id?json.result:r),persistence:json.persistence||snapshot.persistence};
        setData(snapshot);
      }
      const finalRes=await fetch('/api/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'finalize',batchId,snapshot})});
      const finalJson=await finalRes.json();
      if(!finalRes.ok) throw new Error(finalJson.error||'履歴保存に失敗しました');
      setData(finalJson); setMessage('全店舗を更新し、履歴を保存しました');
    } catch (e) {
      setMessage(`更新エラー: ${e.message}`);
      await load().catch(()=>{});
    } finally { setLoading(false); }
  }

  useEffect(() => { load().catch(e => setMessage(e.message)); }, []);

  const categories = useMemo(() => ['すべて', ...new Set((data.results || []).flatMap(r => r.items || []).map(x => x.category))], [data]);

  return (
    <main>
      <header className="topbar">
        <div>
          <p className="eyebrow">TOKUSHIMA BABY SALE</p>
          <h1>ベビー用品 セールチェッカー</h1>
          <p className="sub">最新チラシ・公開WEBクーポンから、ベビー用品だけを抽出します。</p>
        </div>
        <div className="actions">
          <a className="ghostButton" href="/api/history.csv">CSV履歴</a>
          <button className="updateButton" onClick={update} disabled={loading}>{loading ? '解析中…' : '↻ 最新情報に更新'}</button>
        </div>
      </header>

      <section className="summary">
        <div><span>最終更新</span><strong>{data.updatedAt ? fmtDate(data.updatedAt) : '未更新'}</strong></div>
        <div><span>履歴保存</span><strong>{data.persistence?.database ? 'DB' : '未設定'}</strong></div>
        <div><span>チラシ保存</span><strong>{data.persistence?.blob ? 'Vercel Blob' : '元URLのみ'}</strong></div>
        <div><span>方針</span><strong>不明は不明</strong></div>
      </section>

      {message && <p className="notice">{message}</p>}
      {!data.persistence?.database && <p className="warning">DATABASE_URL が未設定です。Vercel本番ではNeonを接続してください。未設定時は永続保存されません。</p>}

      <nav className="filters">
        {categories.map(c => <button key={c} className={category === c ? 'active' : ''} onClick={() => setCategory(c)}>{c}</button>)}
      </nav>

      <section className="storeList">
        {(data.results || []).map(store => {
          const items = (store.items || []).filter(x => category === 'すべて' || x.category === category);
          return <article className="store" key={store.id}>
            <div className="storeHead">
              <div>
                <div className="titleRow"><h2>{store.chain}</h2><span className="area">{store.area}</span></div>
                <p className="stores">対象: {(store.storeKeywords || []).join(' / ')}</p>
              </div>
              <div className="sourceLinks">
                <a href={store.sourceUrl} target="_blank" rel="noreferrer">情報元</a>
                {(store.flyers || []).slice(0, 6).map((f, i) => <a key={`${f.url}-${i}`} href={f.savedUrl || f.url} target="_blank" rel="noreferrer">チラシ{(store.flyers || []).length > 1 ? i + 1 : ''}</a>)}
              </div>
            </div>
            {store.error && <p className="error">取得エラー: {store.error}</p>}
            {!items.length ? <div className="empty">条件に合うベビー用品を確定できませんでした。推測値は表示していません。</div> :
              <div className="cards">{items.map((x, i) => <div className="card" key={`${x.product}-${i}`}>
                <div className="icon">{icons[x.category] || '🧺'}</div>
                <span className="cat">{x.category}</span>
                <h3>{x.product}</h3>
                <div className="price">{x.price}</div>
                <dl>
                  <div><dt>販売開始日</dt><dd>{x.startDate}</dd></div>
                  <div><dt>終了日</dt><dd>{x.endDate}</dd></div>
                  <div><dt>抽出方法</dt><dd>{x.confidence}</dd></div>
                </dl>
                <a className="detailLink" href={x.flyerUrl !== '不明' ? x.flyerUrl : x.sourceUrl} target="_blank" rel="noreferrer">情報を確認 →</a>
              </div>)}</div>}
          </article>;
        })}
      </section>
    </main>
  );
}
