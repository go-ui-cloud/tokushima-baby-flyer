import { createHmac, timingSafeEqual } from 'node:crypto';

export const ADMIN_COOKIE='tokushima_baby_admin';
const SESSION_SECONDS=60*60*12;

function secret(){return process.env.ADMIN_SESSION_SECRET||'';}
function sign(value){return createHmac('sha256',secret()).update(value).digest('base64url');}
function safeEqual(a,b){
  const aa=Buffer.from(String(a)),bb=Buffer.from(String(b));
  return aa.length===bb.length&&timingSafeEqual(aa,bb);
}

export function authConfigured(){return Boolean(process.env.ADMIN_PASSWORD&&secret());}
export function passwordMatches(value){return authConfigured()&&safeEqual(value,process.env.ADMIN_PASSWORD);}
export function createAdminToken(){
  const payload=Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+SESSION_SECONDS})).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
export function verifyAdminToken(token){
  if(!authConfigured()||!token)return false;
  const [payload,signature]=String(token).split('.');
  if(!payload||!signature||!safeEqual(signature,sign(payload)))return false;
  try{return Number(JSON.parse(Buffer.from(payload,'base64url').toString()).exp)>Math.floor(Date.now()/1000);}catch{return false;}
}
export function isAdminRequest(req){return verifyAdminToken(req.cookies?.get(ADMIN_COOKIE)?.value);}
export const adminCookieOptions={httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/',maxAge:SESSION_SECONDS};
