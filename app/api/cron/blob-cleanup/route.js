import { NextResponse } from 'next/server';

export const dynamic='force-dynamic';

// 旧Cronルートを無効化。画像整理はログイン後のDB一括削除時だけ実行する。
export async function GET(){
  return NextResponse.json({error:'画像の定期削除は廃止されました'},{status:410,headers:{'Cache-Control':'no-store'}});
}
