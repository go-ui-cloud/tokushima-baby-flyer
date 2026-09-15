import { NextResponse } from 'next/server';

export const dynamic='force-dynamic';

// GitHubの「Add files via upload」は旧ファイルを削除しないため、
// 廃止済みCSV APIを安全な応答で上書きする互換ルート。
export async function GET(){
  return NextResponse.json({error:'CSV履歴機能は廃止されました'},{status:410,headers:{'Cache-Control':'no-store'}});
}
