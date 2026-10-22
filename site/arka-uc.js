// GitHub Pages sürümü için veri katmanı: istekleri Supabase'deki RPC fonksiyonlarına çevirir.
// Supabase adresi ve yayımlanabilir (publishable) anahtar derleme sırasında yerleştirilir. Bu anahtar
// tarayıcıya açık olmak üzere tasarlanmıştır; tablolar kapalıdır, her fonksiyon oturumu ve rolü denetler.
import { ApiError } from './hata.js';

const SUPABASE_URL = '__SUPABASE_URL__';
const SUPABASE_KEY = '__SUPABASE_KEY__';
const TOKEN_KEY = 'seyahat_oturum';

export const yollar = {
  giris: 'giris.html',
  anasayfa: './',
  // Anahtar adresin # kısmında durur: sunucuya, kayıtlara ve Referer başlığına gitmez.
  kisiLinki: (anahtar) => new URL(`kisi.html#${anahtar}`, location.href).href,
};

export function paylasimAnahtari() {
  return location.hash.slice(1);
}

export function setCsrf() {
  // Oturum anahtarı çerezle değil, istek gövdesiyle gönderildiği için CSRF anahtarına gerek yoktur.
}

function readToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

function writeToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* depolama kapalı */ }
}

async function rpc(name, args) {
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(args),
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    throw new ApiError(0, 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edin.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* gövde yok */ }
  if (!res.ok) {
    const status = res.status === 429 ? 429 : 500;
    throw new ApiError(status, status === 429 ? 'Çok fazla istek. Lütfen biraz sonra tekrar deneyin.' : 'Beklenmeyen bir hata oluştu.',
      res.headers.get('Retry-After'));
  }
  if (data && typeof data === 'object' && data.error) {
    if (data.status === 401 && name !== 'giris') writeToken(null);
    throw new ApiError(data.status, data.error, data.retryAfter == null ? null : String(data.retryAfter));
  }
  return data;
}

// Sunucu sürümündeki REST yollarını Supabase fonksiyonlarına eşler; arayüz kodu iki sürümde de aynıdır.
export async function api(method, path, body) {
  const url = new URL(path, 'https://yerel.invalid');
  const parts = url.pathname.split('/').filter(Boolean).slice(1);
  const ay = url.searchParams.get('ay');
  const token = readToken();
  const route = `${method} ${parts[0] || ''}${parts.length > 1 ? '/:id' : ''}${parts[2] ? `/${parts[2]}` : ''}`;

  switch (route) {
    case 'POST giris': {
      const r = await rpc('giris', { p_username: body.username, p_password: body.password, p_old_token: token });
      writeToken(r.token);
      return { user: r.user };
    }
    case 'GET oturum':
      if (!token) throw new ApiError(401, 'Oturum gerekli.');
      return rpc('oturum', { p_token: token });
    case 'POST cikis':
      try { await rpc('cikis', { p_token: token }); } finally { writeToken(null); }
      return null;
    case 'GET kayitlar':
      if (url.searchParams.has('bas') || url.searchParams.has('bit')) {
        return rpc('kayitlar_aralik', { p_token: token, p_bas: url.searchParams.get('bas'), p_bit: url.searchParams.get('bit') });
      }
      return rpc('kayitlar_listele', { p_token: token, p_ay: ay });
    case 'POST kayitlar':
      return rpc('kayit_ekle', { p_token: token, p_kayit: body });
    case 'PATCH kayitlar/:id':
      return rpc('kayit_guncelle', { p_token: token, p_id: Number(parts[1]), p_degisiklik: body });
    case 'DELETE kayitlar/:id':
      await rpc('kayit_sil', { p_token: token, p_id: Number(parts[1]) });
      return null;
    case 'GET kisiler':
      return rpc('kisiler_listele', { p_token: token, p_ay: ay });
    case 'POST kisiler/:id/link-yenile':
      return rpc('link_yenile', { p_token: token, p_kisi_id: Number(parts[1]) });
    case 'GET paylasim/:id':
      return rpc('paylasim', { p_anahtar: decodeURIComponent(parts[1]), p_ay: ay });
    default:
      throw new ApiError(404, 'Bulunamadı.');
  }
}
