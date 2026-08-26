# 徳島 ベビー用品セールチェッカー v2

GitHub → Vercel 連携を前提にした Next.js 版です。

## 対象

- 西松屋（徳島市）
- Birthday / バースデイ（藍住店）
- アカチャンホンポ（ゆめタウン徳島店）
- ダイレックス（徳島市）
- ドラッグストアモリ（徳島市）
- ドラッグコスモス（徳島市）
- レデイ薬局（徳島市）
- クスリのアオキ（徳島市）
- ドン・キホーテ（徳島店）
- コストコオンライン

## v2 の動作

1. 右上の「最新情報に更新」を押す
2. 10対象を1店舗ずつ Vercel Function で取得
3. 各公式ページからチラシ画像/PDF/iframe/関連リンクを探索
4. 取得した画像/PDFを `/tmp/tokushima-baby-flyer` に一時ダウンロード
5. 画像は Tesseract.js で日本語OCR
6. PDFは最大4ページまで解析。埋め込み文字が十分あれば抽出し、画像PDFはページを画像化してOCR
7. おむつ、離乳食、ミルク、ベビー服などを抽出
8. Neon PostgreSQL に店舗ごとの最新情報を保存
9. 全店舗終了時に1回分の更新履歴をDBへ保存
10. 「CSV履歴」でDB履歴をCSVとしてダウンロード

値段・販売開始日などを確定できない場合は `不明` と表示します。推測値は補完しません。

## Vercel Blob

`BLOB_READ_WRITE_TOKEN` が設定されている場合、取得したチラシ画像/PDFを Vercel Blob に保存します。
未設定時は、解析は `/tmp` のファイルで実施し、画面のチラシリンクには取得元URLを使用します。

## GitHubへアップ

新しいGitHubリポジトリを作成後、このフォルダの中身をリポジトリ直下へ置きます。

```bash
git init
git add .
git commit -m "Initial v2"
git branch -M main
git remote add origin https://github.com/YOUR_NAME/YOUR_REPOSITORY.git
git push -u origin main
```

## VercelとGitHubを連携

1. Vercel Dashboard を開く
2. `Add New` → `Project`
3. GitHub の作成したリポジトリを Import
4. Framework Preset は通常 `Next.js` が自動検出されます
5. Deploy

以後、`main` ブランチへ push すると Vercel が自動デプロイします。

## Neon PostgreSQL を接続

Vercel の対象Projectで Marketplace / Storage から Neon Postgres を追加します。
接続後、`DATABASE_URL` がVercel環境変数に存在することを確認してください。

DBテーブルは初回アクセス時に自動作成します。

- `baby_flyer_store_state`: 店舗ごとの最新結果
- `baby_flyer_update_history`: 更新ボタン1回分の履歴

## Vercel Blobを接続（推奨）

Vercelの対象Projectで Blob を作成・接続します。
`BLOB_READ_WRITE_TOKEN` が環境変数に入れば、チラシ画像/PDFを永続保存します。

## 環境変数

`.env.example` を参照してください。

```env
DATABASE_URL=
BLOB_READ_WRITE_TOKEN=
```

Secrets をGitHubへコミットしないでください。

## ローカル起動

```bash
npm install
npm run dev
```

http://localhost:3000 を開きます。

ローカルでChromium起動に問題がある場合は、インストール済みChromeの実行ファイルを指定できます。

```env
CHROME_EXECUTABLE_PATH=/path/to/chrome
```

## 注意点

- 公開WEB上で取得可能なチラシ・クーポンのみ対象です。
- LINE/公式アプリへのログイン後だけ表示される個別クーポンは取得しません。
- 店舗サイトの仕様変更、Bot対策、CAPTCHA等で取得できない場合は取得エラーとして表示します。
- `/tmp` は解析中の一時保存専用です。永続保存はDB/Blobを使用します。
- OCRは誤認識する可能性があるため、画面には情報元・チラシへのリンクを表示します。
- VercelプランによりFunctionの最大実行時間は異なります。v2では1店舗=1 Functionに分割しています。


## V2.2 の変更点

- 画面タイトル横に `ver 2.2` を表示。
- Next.js 16 の本番ビルドを Webpack に固定し、ネイティブ依存関係の扱いを安定化。
- `outputFileTracingIncludes` で `@sparticuz/chromium/bin/**` を `/api/update` Function に明示同梱。
- Chromium の `bin` がプロジェクト配下に存在する場合は、そのパスを `chromium.executablePath()` に明示指定。
- Chromium 起動に失敗した場合は、Cheerio + fetch のHTTPフォールバックでHTML・画像・PDFリンクの探索を継続。
- HTTPフォールバックでも取得不能な場合のみ店舗エラーとして保存。推測値は生成しません。

### Vercel Runtime

`@sparticuz/chromium` の現行系に合わせ、Node.js 22.17 以上を指定しています。GitHubへ更新後、Vercelは `package.json` の build script (`next build --webpack`) を使って再ビルドします。
