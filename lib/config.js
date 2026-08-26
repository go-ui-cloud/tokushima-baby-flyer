export const STORES = [
  { id:'nishimatsuya', chain:'西松屋', area:'徳島市', storeKeywords:['徳島新浜店','徳島末広店','徳島南矢三店'], sources:['https://www.24028.jp/tenpo/shoplist.php?add=%E5%BE%B3%E5%B3%B6%E5%B8%82&cid=36'] },
  { id:'birthday-aizumi', chain:'Birthday（しまむらグループ）', area:'藍住町', storeKeywords:['バースデイ 藍住店','藍住店'], sources:['https://www.shimamura.gr.jp/shop/map_detail_3510.html'] },
  { id:'akachan-aizumi', chain:'アカチャンホンポ', area:'ゆめタウン徳島店', storeKeywords:['ゆめタウン徳島店'], sources:['https://stores.akachan.jp/339','https://www.akachan.jp/'] },
  { id:'direx', chain:'ダイレックス', area:'徳島市', storeKeywords:['田宮店','中島田店','住吉店','福島店','沖浜店'], sources:['https://www.ds-direx.co.jp/list/cat%5B%5D%3D136'] },
  { id:'doramori', chain:'ドラッグストアモリ', area:'徳島市', storeKeywords:['津田店','万代店','徳島住吉店','国府店','応神店','国府観音寺店'], sources:['https://www.doramori.co.jp/store/','https://www.doramori.co.jp/store/search/'] },
  { id:'cosmos', chain:'ドラッグコスモス', area:'徳島市', storeKeywords:['住吉店','芝生店','問屋町店'], sources:['https://www.cosmospc.co.jp/shop/shikoku/','https://www.cosmospc.co.jp/shop/'] },
  { id:'lady', chain:'レデイ薬局', area:'徳島市', storeKeywords:['沖浜店','国府店','佐古店','庄町店','新浜店','末広店','田宮街道店','八万店','矢三店'], sources:['https://www.lady-drug.co.jp/'] },
  { id:'aoki', chain:'クスリのアオキ', area:'徳島市', storeKeywords:['北島田店'], sources:['https://kusuri-aoki-shop-info.com/','https://kusuri-aoki-shop-info.com/result?storeCode=1154'] },
  { id:'donki', chain:'ドン・キホーテ', area:'徳島店', storeKeywords:['MEGAドン・キホーテ徳島店','徳島店'], sources:['https://www.donki.com/store/shop_detail.php?shop_id=476'] },
  { id:'costco', chain:'コストコオンライン', area:'オンライン', storeKeywords:['ベビー','おむつ','ミルク'], sources:['https://www.costco.co.jp/Baby-Kids-Toys/c/cos_8'] }
];

export const BABY_TERMS = {
  'おむつ・おしりふき':[
    'おむつ','オムツ','紙おむつ','紙オムツ','パンパース','メリーズ','ムーニー','グーン','マミーポコ','おやすみパンツ',
    'おしりふき','お尻ふき','おしり拭き','手口ふき','手口拭き'
  ],
  '粉ミルク・液体ミルク':[
    '粉ミルク','液体ミルク','乳児用ミルク','育児用ミルク','ほほえみ','はぐくみ','ぴゅあ','すこやか','アイクレオ','はいはい','ぐんぐん','E赤ちゃん','E赤ちゃん'
  ],
  '離乳食・ベビーフード':[
    '離乳食','ベビーフード','キユーピーベビーフード','キユーピー ベビーフード','和光堂','栄養マルシェ','グーグーキッチン','BIGサイズの栄養マルシェ','赤ちゃんのおやつ'
  ],
  'おもちゃ':[
    'ベビー玩具','ベビートイ','知育玩具','知育おもちゃ','おもちゃ','玩具','ガラガラ','ラトル','歯固め','メリー','プレイジム','積み木'
  ],
  'ベビーケア・その他':[
    '哺乳びん','哺乳瓶','乳首','ベビーカー','抱っこ紐','抱っこひも','チャイルドシート','ベビーソープ','ベビーシャンプー','ベビーローション','ベビーオイル','ベビー綿棒','ベビー歯ブラシ','ベビー用歯ブラシ','おしゃぶり','母乳パッド','授乳用品','ベビーバス','鼻吸い器','体温計','爪切り','おむつ袋','おむつ用ゴミ袋'
  ]
};

// ベビー服・肌着・ロンパース等は件数が多いためV2.4から抽出対象外。
export const PROMO_TERMS = [
  '特価','セール','SALE','sale','値下','値引','割引','OFF','off','クーポン','期間限定','目玉','広告の品','広告品',
  'お買得','お買い得','売出','売り出し','よりどり','奉仕品','限定価格','会員価格','アプリ価格','今だけ','大特価','超特価','○円引'
];

export const EXCLUDE_TEXT_TERMS = [
  'よくあるご質問','よくある質問','FAQ','お問い合わせ','取扱いはありますか','取り扱いはありますか','店舗スタッフへお尋ね',
  'カテゴリ','商品を探す','店舗検索','採用情報','会社情報','利用規約','プライバシー','サイトマップ'
];
