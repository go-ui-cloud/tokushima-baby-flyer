import { NextResponse } from 'next/server';
import { ADMIN_COOKIE, adminCookieOptions, authConfigured, createAdminToken, isAdminRequest, passwordMatches } from '../../../lib/admin-auth.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(req){return NextResponse.json({authenticated:isAdminRequest(req),configured:authConfigured()},{headers:{'Cache-Control':'no-store'}});}

export async function POST(req){
  if(!authConfigured())return NextResponse.json({error:'Vercelの環境変数に管理者パスワードが設定されていません'},{status:503});
  const {password=''}=await req.json().catch(()=>({}));
  if(!passwordMatches(String(password)))return NextResponse.json({error:'パスワードが違います'},{status:401});
  const res=NextResponse.json({ok:true,authenticated:true},{headers:{'Cache-Control':'no-store'}});
  res.cookies.set(ADMIN_COOKIE,createAdminToken(),adminCookieOptions);
  return res;
}

export async function DELETE(){
  const res=NextResponse.json({ok:true,authenticated:false},{headers:{'Cache-Control':'no-store'}});
  res.cookies.set(ADMIN_COOKIE,'',{...adminCookieOptions,maxAge:0});
  return res;
}
