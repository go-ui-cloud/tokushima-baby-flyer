import { get } from '@vercel/blob';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

export async function GET(req){
  try{
    const url=new URL(req.url).searchParams.get('url');
    if(!url) return Response.json({error:'url が必要です'},{status:400});

    // Only allow this endpoint to proxy Vercel Blob objects.
    const parsed=new URL(url);
    if(!/\.blob\.vercel-storage\.com$/i.test(parsed.hostname)){
      return Response.json({error:'許可されていないBlob URLです'},{status:400});
    }

    const result=await get(url,{access:'private'});
    if(!result || result.statusCode===404){
      return Response.json({error:'チラシが見つかりません'},{status:404});
    }
    if(result.statusCode && result.statusCode>=400){
      return Response.json({error:`Blob取得エラー (${result.statusCode})`},{status:result.statusCode});
    }

    const {stream,blob}=result;
    const headers=new Headers();
    headers.set('Content-Type',blob?.contentType||'application/octet-stream');
    headers.set('Cache-Control','private, max-age=300');
    headers.set('Content-Disposition','inline');
    return new Response(stream,{status:200,headers});
  }catch(e){
    return Response.json({error:e?.message||String(e)},{status:500});
  }
}
