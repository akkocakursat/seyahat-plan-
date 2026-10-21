// Express sunucusu için veri katmanı (GitHub Pages sürümünde bu dosya site/arka-uc.js ile değiştirilir).
import { ApiError } from './hata.js';

export const yollar = {
  giris: '/giris',
  anasayfa: '/',
  kisiLinki: (anahtar) => `${location.origin}/kisi/${anahtar}`,
};

export function paylasimAnahtari() {
  return location.pathname.split('/').filter(Boolean)[1] || '';
}

let csrfToken = null;
export function setCsrf(token) {
  csrfToken = token;
}

export async function api(method, path, body) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  let res;
  try {
    res = await fetch(path, {
      method, headers, credentials: 'same-origin', cache: 'no-store',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edin.');
  }
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch { /* gövde yok */ }
  if (!res.ok) {
    throw new ApiError(res.status, data?.error || 'Beklenmeyen bir hata oluştu.', res.headers.get('Retry-After'));
  }
  return data;
}
