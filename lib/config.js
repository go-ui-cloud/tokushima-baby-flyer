export const STORES = [
  {
    id:'nishimatsuya', chain:'西松屋', area:'徳島南矢三店', exactStoreName:'徳島南矢三店',
    address:'徳島県徳島市南矢三町1丁目3番60号', storeKeywords:['徳島南矢三店','南矢三町1丁目3番60号','南矢三町1-3-60'],
    sources:[
      {provider:'official',label:'西松屋公式',url:'https://www.24028.jp/tenpo/detail.php?doc=1126'},
    ]
  },
  {
    id:'birthday-aizumi', chain:'バースデイ', area:'藍住店', exactStoreName:'バースデイ 藍住店',
    address:'徳島県板野郡藍住町徳命字元村東34-1', storeKeywords:['バースデイ 藍住店','バースデイ/藍住店','徳命字元村東34-1'],
    sources:[
      {provider:'official',label:'しまむらグループ公式',url:'https://www.shimamura.gr.jp/shop/map_detail_3510.html'},
    ]
  },
  {
    id:'akachan-aizumi', chain:'アカチャンホンポ', area:'ゆめタウン徳島店', exactStoreName:'アカチャンホンポ ゆめタウン徳島店',
    address:'徳島県板野郡藍住町奥野字東中須88-1 ゆめタウン徳島2F', storeKeywords:['ゆめタウン徳島店','奥野字東中須88-1'],
    sources:[
      {provider:'official',label:'アカチャンホンポ公式',url:'https://stores.akachan.jp/339'}
    ]
  },
  {
    id:'direx', chain:'ダイレックス', area:'田宮店', exactStoreName:'ダイレックス 田宮店',
    address:'徳島県徳島市北田宮1丁目4番11号', storeKeywords:['田宮店','北田宮1丁目4番11号','北田宮1-4-11'],
    sources:[
      {provider:'official',label:'ダイレックス公式',url:'https://www.ds-direx.co.jp/list/detail/7366'}
    ]
  },
  {
    id:'doramori', chain:'ドラッグストアモリ', area:'徳島住吉店', exactStoreName:'ドラッグストアモリ 徳島住吉店',
    address:'徳島県徳島市住吉五丁目4番28号', storeKeywords:['徳島住吉店','住吉五丁目4番28号'],
    sources:[
      {provider:'official',label:'ドラッグストアモリ公式',url:'https://www.doramori.co.jp/store/12804.html/'},
    ]
  },
  {
    id:'cosmos', chain:'ドラッグストアコスモス', area:'住吉店', exactStoreName:'ドラッグストアコスモス 住吉店',
    address:'徳島県徳島市住吉5丁目5-9', storeKeywords:['住吉店','住吉5丁目5-9','住吉５丁目５−９'],
    sources:[
      {provider:'official',label:'コスモス薬品公式',url:'https://www.cosmospc.co.jp/shop/shikoku/tokushima/95389.html'},
    ]
  },
  {
    id:'lady', chain:'レデイ薬局', area:'田宮街道店', exactStoreName:'くすりのレデイ 田宮街道店',
    address:'徳島県徳島市中吉野町4-6-3', storeKeywords:['田宮街道店','中吉野町4-6-3'],
    sources:[
      {provider:'official',label:'ツルハグループ公式',url:'https://shop.tsuruha-g.com/4375'}
    ]
  },
  {
    id:'aoki', chain:'クスリのアオキ', area:'北島田店', exactStoreName:'クスリのアオキ 北島田店',
    address:'徳島県徳島市北島田町二丁目25番地', storeKeywords:['北島田店','北島田町二丁目25番地'],
    sources:[
      {provider:'official',label:'クスリのアオキ公式',url:'https://kusuri-aoki-shop-info.com/result?storeCode=1154'},
    ]
  },
  {
    id:'donki', chain:'ドン・キホーテ', area:'MEGAドン・キホーテ徳島店', exactStoreName:'MEGAドン・キホーテ 徳島店',
    address:'徳島県徳島市応神町古川戎子野48-1', storeKeywords:['MEGAドン・キホーテ徳島店','MEGAドン・キホーテ 徳島店','応神町古川戎子野48-1'],
    sources:[
      {provider:'official',label:'ドン・キホーテ公式',url:'https://www.donki.com/store/shop_detail.php?shop_id=576'},
    ]
  }
  ,{
    id:'costco-online', chain:'コストコオンライン', area:'オンライン', exactStoreName:'コストコオンライン',
    address:'オンライン', storeKeywords:['コストコオンライン','Costco Japan','Baby-Kids-Toys'], type:'costco-online',
    sources:[
      {provider:'official',label:'オムツ・おしりふき',url:'https://www.costco.co.jp/Baby-Kids-Toys/Diapers-Wipes/c/cos_8.4'},
      {provider:'official',label:'乳児用ミルク・キッズフード',url:'https://www.costco.co.jp/Baby-Kids-Toys/Formula-Kids-Snacks/c/cos_8.5'}
    ],
    categoryUrls:[
      'https://www.costco.co.jp/Baby-Kids-Toys/Diapers-Wipes/c/cos_8.4',
      'https://www.costco.co.jp/Baby-Kids-Toys/Formula-Kids-Snacks/c/cos_8.5'
    ]
  }

];

export const BABY_TERMS = {
  'おむつ・おしりふき':['おむつ','オムツ','紙おむつ','紙オムツ','パンパース','メリーズ','ムーニー','グーン','マミーポコ','おやすみパンツ','おしりふき','お尻ふき','おしり拭き','手口ふき','手口拭き'],
  '粉ミルク・液体ミルク':['粉ミルク','液体ミルク','乳児用ミルク','育児用ミルク','ほほえみ','はぐくみ','ぴゅあ','すこやか','アイクレオ','はいはい','ぐんぐん','E赤ちゃん'],
  '離乳食・ベビーフード':['離乳食','ベビーフード','キユーピーベビーフード','キユーピー ベビーフード','和光堂','栄養マルシェ','グーグーキッチン','BIGサイズの栄養マルシェ','赤ちゃんのおやつ'],
  'おもちゃ':['ベビー玩具','ベビートイ','知育玩具','知育おもちゃ','おもちゃ','玩具','ガラガラ','ラトル','歯固め','メリー','プレイジム','積み木'],
  'ベビーケア・その他':['哺乳びん','哺乳瓶','乳首','ベビーカー','抱っこ紐','抱っこひも','チャイルドシート','ベビーソープ','ベビーシャンプー','ベビーローション','ベビーオイル','ベビー綿棒','ベビー歯ブラシ','おしゃぶり','母乳パッド','授乳用品','ベビーバス','鼻吸い器','体温計','爪切り','おむつ袋','おむつ用ゴミ袋']
};
export const PROMO_TERMS=['特価','セール','SALE','sale','値下','値引','割引','OFF','off','クーポン','期間限定','目玉','広告の品','広告品','お買得','お買い得','売出','売り出し','よりどり','奉仕品','限定価格','会員価格','アプリ価格','今だけ','大特価','超特価'];
export const EXCLUDE_TEXT_TERMS=['よくあるご質問','よくある質問','FAQ','お問い合わせ','取扱いはありますか','取り扱いはありますか','店舗スタッフへお尋ね','カテゴリ','商品を探す','店舗検索','採用情報','会社情報','利用規約','プライバシー','サイトマップ'];
