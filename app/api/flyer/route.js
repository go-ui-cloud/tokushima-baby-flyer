import { get } from '@vercel/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req) {
  try {
    const url = new URL(req.url).searchParams.get('url');
    if (!url) return Response.json({ error: 'url が必要です' }, { status: 400 });

    // Security: this viewer proxies only Vercel Blob objects created by this app.
    const parsed = new URL(url);
    if (!/\.blob\.vercel-storage\.com$/i.test(parsed.hostname)) {
      return Response.json({ error: '許可されていないBlob URLです' }, { status: 400 });
    }

    // The project uses a PRIVATE Blob store. @vercel/blob v2 requires the
    // access mode to be supplied when reading a private object.
    const result = await get(url, { access: 'private' });

    if (!result || result.statusCode === 404) {
      return Response.json({ error: 'チラシが見つかりません' }, { status: 404 });
    }
    if (result.statusCode && result.statusCode >= 400) {
      return Response.json(
        { error: `Blob取得エラー (${result.statusCode})` },
        { status: result.statusCode }
      );
    }

    const body = result.stream ?? result.body ?? result.blob ?? result;
    if (!body) {
      return Response.json({ error: 'Blobのデータを取得できませんでした' }, { status: 502 });
    }

    const contentType =
      result.blob?.contentType ||
      result.contentType ||
      result.headers?.get?.('content-type') ||
      'application/octet-stream';

    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('Cache-Control', 'private, no-store, max-age=0');
    headers.set('Content-Disposition', 'inline');
    headers.set('X-Content-Type-Options', 'nosniff');

    return new Response(body, { status: 200, headers });
  } catch (e) {
    console.error('[api/flyer]', e);
    return Response.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
