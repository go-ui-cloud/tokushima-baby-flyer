export function dedupeUniqlo(items=[]){
  const seen=new Set();
  return items.filter(x=>{
    // UNIQLOでは同名・同価格でも、サイズ展開などが異なる別商品が存在する。
    // 商品ページURL（商品番号を含む）を優先し、URLがない場合だけ従来項目で判定する。
    const productUrl=String(x.flyerUrl||'').trim();
    const key=productUrl?`url:${productUrl}`:`fallback:${x.category}|${x.product}|${x.price}|${x.notes||''}`;
    if(seen.has(key))return false;
    seen.add(key);
    return true;
  });
}
