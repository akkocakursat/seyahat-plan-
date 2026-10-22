// GitHub Pages için durağan siteyi _site/ klasörüne üretir (veri Supabase'den gelir).
// Kullanım: npm run site   (SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY ortam değişkenleri site/yapilandirma.json'u ezer)
import { readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, readdirSync, renameSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from '../src/config.js';

// Klasördeki tüm dosyaların içeriğinden kısa bir özet (yayın sürümü).
function hashDir(dir) {
  const h = createHash('sha256');
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else h.update(relative(dir, p)).update('\0').update(readFileSync(p)).update('\0');
    }
  };
  walk(dir);
  return h.digest('hex').slice(0, 10);
}

export function buildSite(outDir = resolve(ROOT, '_site'), env = process.env) {
  const conf = JSON.parse(readFileSync(resolve(ROOT, 'site/yapilandirma.json'), 'utf8'));
  const url = new URL(env.SUPABASE_URL || conf.supabaseUrl).origin;
  const key = env.SUPABASE_PUBLISHABLE_KEY || conf.supabasePublishableKey;
  const local = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url);
  if ((url.startsWith('http:') && !local) || !/^[A-Za-z0-9._-]+$/.test(key)) {
    throw new Error('Supabase adresi https olmalı ve anahtar geçerli biçimde olmalı.');
  }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  cpSync(resolve(ROOT, 'public'), join(outDir, 'static'), { recursive: true });
  const adapter = readFileSync(resolve(ROOT, 'site/arka-uc.js'), 'utf8')
    .replace("'__SUPABASE_URL__'", JSON.stringify(url))
    .replace("'__SUPABASE_KEY__'", JSON.stringify(key));
  writeFileSync(join(outDir, 'static/js/arka-uc.js'), adapter);

  // Dosyalar içerik özetli bir klasöre taşınır (v/<özet>/...): her yayında adres değişir, böylece tarayıcı
  // ve GitHub Pages önbelleği eski CSS/JS'yi gösteremez. Modüller birbirini göreli yolla yüklediği için hepsi yenilenir.
  const version = hashDir(join(outDir, 'static'));
  const assetDir = `v/${version}`;
  mkdirSync(join(outDir, 'v'), { recursive: true });
  renameSync(join(outDir, 'static'), join(outDir, assetDir));

  // GitHub Pages yanıt başlığı ayarlatmadığı için güvenlik politikaları <meta> ile verilir.
  // (frame-ancestors <meta> içinde desteklenmez; çerçeveye alınma tarayıcıda engellenemez.)
  const csp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
    `connect-src ${url}; form-action 'self'; base-uri 'none'; object-src 'none'`;
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">\n  <meta name="referrer" content="no-referrer">`;
  for (const name of ['index.html', 'giris.html']) {
    const html = readFileSync(resolve(ROOT, 'views', name), 'utf8')
      .replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  ${meta}`)
      .replaceAll('"/static/', `"${assetDir}/`);
    writeFileSync(join(outDir, name), html);
  }
  writeFileSync(join(outDir, '.nojekyll'), '');
  return { outDir, url, assetDir };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { outDir, url, assetDir } = buildSite();
  console.log(`Site üretildi: ${outDir} (Supabase: ${url}, dosyalar: ${assetDir})`);
}
