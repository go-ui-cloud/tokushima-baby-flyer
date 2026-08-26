import './style.css';

export const metadata = {
  title: '徳島 ベビー用品チラシチェッカー ver 2.8',
  description: '徳島周辺の最新チラシから対象カテゴリのベビー用品を抽出',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
