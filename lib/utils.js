import crypto from 'node:crypto';
import path from 'node:path';

export const TMP_ROOT = '/tmp/tokushima-baby-flyer';
export const hash = s => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0,16);
export const safeName = s => String(s).replace(/[^a-zA-Z0-9_-]/g,'_');
export const isPdfUrl = u => /\.pdf(?:$|[?#])/i.test(u || '');
export const isImageUrl = u => /\.(?:png|jpe?g|webp|gif)(?:$|[?#])/i.test(u || '');
export function absUrl(u, base){ try { return new URL(u, base).href; } catch { return null; } }
export function extFrom(url, contentType='') {
  const ct=contentType.toLowerCase();
  if(ct.includes('pdf') || isPdfUrl(url)) return '.pdf';
  if(ct.includes('png')) return '.png';
  if(ct.includes('webp')) return '.webp';
  if(ct.includes('gif')) return '.gif';
  const e=path.extname(new URL(url).pathname).toLowerCase();
  return ['.jpg','.jpeg','.png','.webp','.gif'].includes(e) ? e : '.jpg';
}
