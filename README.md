# 徳島 ベビー用品チラシチェッカー ver 2.11

GitHub → Vercel 配備用のNext.jsアプリです。

## V2.11追加変更

- 西松屋公式ページに「現在、セール情報はありません。」と表示される場合は、OCRせず正常スキップします。
- コストコオンラインは指定済み2URL内で `¥○○引き後` / `￥○○引き後` がある商品を、商品カテゴリ判定なしですべて表示します。
- Access Denied / Forbidden 等のブロック画面はチラシとして保存・OCRしません。

## V2.11の主な変更

### 店舗別のチラシ取得手順を固定

V2.11では「チラシっぽい画像を探す」方式より先に、指定された公式店舗ページで店舗ごとのクリック手順を実行します。クリック先のチラシ/ビューアーをスクリーンショットし、その画像をOCRします。指定手順で取得できなかった場合のみ従来の公式ページ探索 → Shufoo!等のフォールバックへ進みます。

- 西松屋 徳島南矢三店: `https://www.24028.jp/tenpo/detail.php?doc=1126` の「徳島南矢三店のセール情報はこちら」周辺のチラシ/SALEを開いて撮影。
- バースデイ 藍住店: `https://www.shimamura.gr.jp/shop/map_detail_3510.html` のチラシ欄「拡大して見る」を開いて撮影。
- アカチャンホンポ ゆめタウン徳島店: `https://stores.akachan.jp/339` のセール・チラシ情報から「○月のアカトク」と「紙おむつSALE」を優先して開いて撮影。
- ダイレックス 田宮店: `https://www.ds-direx.co.jp/list/detail/7366` のチラシ画像を開く。複数画像/裏面/次ページがあれば追加撮影。
- ドラッグストアモリ 徳島住吉店: `https://www.doramori.co.jp/store/12804.html/` の「チラシを見る」を開く。「次のチラシ」があれば追加撮影。
- ドラッグストアコスモス 住吉店: `https://www.cosmospc.co.jp/shop/shikoku/tokushima/95389.html` の「最新のチラシ」を開く。「チラシをめくる」があれば追加撮影。
- くすりのレデイ 田宮街道店: `https://shop.tsuruha-g.com/4375` のトクバイ/チラシ画像を開く。「次のチラシ」があれば追加撮影。
- クスリのアオキ 北島田店: `https://kusuri-aoki-shop-info.com/result?storeCode=1154` の「チラシを表示」を開き、縦長も含めて分割撮影。
- MEGAドン・キホーテ徳島店: `https://www.donki.com/store/shop_detail.php?shop_id=576` のWEBチラシ欄を開き、複数チラシがあればそれぞれ撮影。

### コストコオンライン

コストコは下記2ページだけを対象にします。

- `https://www.costco.co.jp/Baby-Kids-Toys/Diapers-Wipes/c/cos_8.4`
- `https://www.costco.co.jp/Baby-Kids-Toys/Formula-Kids-Snacks/c/cos_8.5`

通常商品は表示せず、ページ内に文字列として **`¥○○引き後`** または **`￥○○引き後`** が確認できる商品をカテゴリ判定なしで表示します。値引額の表記は画面でも `¥1,000引き後` の形式で表示します。

### 表示

各店舗カードの「対象」は住所やキーワードを表示せず、店舗名だけ表示します。

### OCR/最新性

- 通常は1店舗120秒。
- PDF、複数ページ、長いスクリーンショット、OCR文字量が多い場合は最大300秒まで延長。
- 最新性は、掲載元ページの日付 + チラシ画像/スクリーンショット内の日付の2段階で確認。
- 不一致・古い・日付不明の場合は推測で最新扱いしません。
- ベビー服は対象外。

## 必要なVercel連携

- Neon Postgres: `DATABASE_URL`
- Vercel Blob: 接続済みPrivate Blob（OIDC / `BLOB_STORE_ID`）

既存のNeon/Blob設定はそのまま利用できます。

## デプロイ

GitHubリポジトリの中身をV2.11で上書きしてCommit/Pushしてください。VercelのGit連携が有効なら自動再デプロイされます。
