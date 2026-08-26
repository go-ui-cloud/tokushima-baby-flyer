import './style.css';

export const metadata = {
  title: '徳島 ベビー用品セールチェッカー ver 2.3',
  description: '徳島周辺の最新チラシ・公開クーポンからベビー用品のセール情報を抽出',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
