import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let s;
before(async () => { s = await startServer(); });
after(async () => { await s.close(); });

test('güvenlik başlıkları her yanıtta var', async () => {
  for (const path of ['/', '/giris', '/saglik', '/api/oturum', '/static/css/app.css']) {
    const res = await s.req('GET', path);
    const h = res.headers;
    const csp = h.get('content-security-policy');
    for (const part of ["default-src 'self'", "script-src 'self'", "style-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "object-src 'none'"]) {
      assert.ok(csp.includes(part), `${path}: CSP içinde ${part} yok`);
    }
    assert.equal(h.get('x-content-type-options'), 'nosniff');
    assert.equal(h.get('x-frame-options'), 'DENY');
    assert.equal(h.get('referrer-policy'), 'no-referrer');
    assert.match(h.get('permissions-policy'), /camera=\(\).*microphone=\(\).*geolocation=\(\)/);
    assert.equal(h.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(h.get('cross-origin-resource-policy'), 'same-origin');
    assert.equal(h.get('x-powered-by'), null);
    assert.equal(h.get('strict-transport-security'), null, 'HTTP üzerinde HSTS gönderilmemeli');
  }
});

test('sağlık kontrolü', async () => {
  const res = await s.req('GET', '/saglik');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { durum: 'ok' });
});

test('oturumsuz erişim 401 döner', async () => {
  for (const [method, path] of [['GET', '/api/oturum'], ['GET', '/api/kayitlar'], ['GET', '/api/kisiler'], ['POST', '/api/cikis'],
    ['POST', '/api/kayitlar'], ['PATCH', '/api/kayitlar/1'], ['DELETE', '/api/kayitlar/1']]) {
    const res = await s.req(method, path);
    assert.equal(res.status, 401, `${method} ${path}`);
  }
});

test('hatalı girişte kullanıcı var da yok da aynı hata mesajı', async () => {
  const a = await s.req('POST', '/api/giris', { body: { username: 'editor', password: 'yanlis-parola-xxxx' } });
  const b = await s.req('POST', '/api/giris', { body: { username: 'olmayan-kisi', password: 'yanlis-parola-xxxx' } });
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.equal(a.json.error, 'Kullanıcı adı veya parola hatalı.');
  assert.deepEqual(a.json, b.json);
  assert.equal(a.headers.get('set-cookie'), null);
});

test('çerez bayrakları: HttpOnly, SameSite=Strict, Path=/', async () => {
  const { setCookie } = await s.login('editor');
  assert.match(setCookie, /^seyahat_oturum=[A-Za-z0-9_-]{43};/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Path=\//);
  assert.match(setCookie, /Max-Age=28800/);
  assert.doesNotMatch(setCookie, /Domain=/i);
});

test('üretim ayarında çerez __Host- önekli ve Secure', async () => {
  const p = await startServer({ env: { NODE_ENV: 'production', COOKIE_SECURE: '' } });
  try {
    const { setCookie } = await p.login('editor');
    assert.match(setCookie, /^__Host-seyahat_oturum=/);
    assert.match(setCookie, /; Secure/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
  } finally {
    await p.close();
  }
});

test('HTTPS arkasında (TRUST_PROXY) HSTS gönderilir', async () => {
  const p = await startServer({ env: { TRUST_PROXY: '1' } });
  try {
    const res = await p.req('GET', '/saglik', { headers: { 'X-Forwarded-Proto': 'https' } });
    assert.match(res.headers.get('strict-transport-security'), /max-age=\d+/);
  } finally {
    await p.close();
  }
});

test('oturum veritabanında yalnızca SHA-256 özeti olarak tutulur; her girişte yeni oturum', async () => {
  const a = await s.login('editor');
  const b = await s.login('editor');
  const idA = a.cookie.split('=')[1];
  assert.notEqual(a.cookie, b.cookie);
  const rows = s.db.prepare('SELECT id_hash FROM sessions').all().map((r) => r.id_hash);
  assert.ok(!rows.includes(idA));
  assert.ok(rows.every((h) => /^[0-9a-f]{64}$/.test(h)));
});

test('giriş yaparken mevcut oturum kapatılıp yeni oturum açılır', async () => {
  const a = await s.login('editor');
  const res = await s.req('POST', '/api/giris', { session: a, body: { username: 'editor', password: 'editor-parola-1234' } });
  assert.equal(res.status, 200);
  const old = await s.req('GET', '/api/oturum', { session: a });
  assert.equal(old.status, 401);
});

test('CSRF anahtarı olmadan değişiklik isteği 403', async () => {
  const sess = await s.login('editor');
  const res = await s.req('POST', '/api/kayitlar', { session: sess, csrf: null, body: { personId: 1, region: 'Ankara', date: '2026-10-05', status: 'planned' } });
  assert.equal(res.status, 403);
  const wrong = await s.req('POST', '/api/kayitlar', { session: sess, csrf: 'x'.repeat(43), body: { personId: 1, region: 'Ankara', date: '2026-10-05', status: 'planned' } });
  assert.equal(wrong.status, 403);
  const other = await s.login('yonetici');
  const crossed = await s.req('POST', '/api/kayitlar', { session: sess, csrf: other.csrf, body: { personId: 1, region: 'Ankara', date: '2026-10-05', status: 'planned' } });
  assert.equal(crossed.status, 403, 'başka oturumun anahtarı kabul edilmemeli');
});

test('yabancı ya da eksik Origin 403', async () => {
  const sess = await s.login('editor');
  const body = { personId: 1, region: 'Ankara', date: '2026-10-05', status: 'planned' };
  const foreign = await s.req('POST', '/api/kayitlar', { session: sess, body, origin: 'https://kotu.example' });
  assert.equal(foreign.status, 403);
  const missing = await s.req('POST', '/api/kayitlar', { session: sess, body, origin: null });
  assert.equal(missing.status, 403);
  const login = await s.req('POST', '/api/giris', { body: { username: 'editor', password: 'editor-parola-1234' }, origin: 'https://kotu.example' });
  assert.equal(login.status, 403);
});

test('çıkış sonrası oturum geçersiz', async () => {
  const sess = await s.login('editor');
  assert.equal((await s.req('GET', '/api/oturum', { session: sess })).status, 200);
  const out = await s.req('POST', '/api/cikis', { session: sess });
  assert.equal(out.status, 204);
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await s.req('GET', '/api/oturum', { session: sess })).status, 401);
  assert.equal((await s.req('GET', '/api/kayitlar', { session: sess })).status, 401);
});

test('413: 10 KB üzeri JSON gövde', async () => {
  const sess = await s.login('editor');
  const res = await s.req('POST', '/api/kayitlar', { session: sess, body: { personId: 1, region: 'A', date: '2026-10-01', note: 'x'.repeat(12 * 1024) } });
  assert.equal(res.status, 413);
});

test('415: JSON olmayan gövde', async () => {
  const sess = await s.login('editor');
  const res = await s.req('POST', '/api/kayitlar', {
    session: sess, rawBody: 'personId=1&region=A&date=2026-10-01', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  assert.equal(res.status, 415);
  const plain = await s.req('POST', '/api/giris', { rawBody: '{"username":"a","password":"b"}', headers: { 'Content-Type': 'text/plain' } });
  assert.equal(plain.status, 415);
});

test('bozuk JSON 400 ve ayrıntı sızdırmaz', async () => {
  const sess = await s.login('editor');
  const res = await s.req('POST', '/api/kayitlar', { session: sess, rawBody: '{"personId":', headers: { 'Content-Type': 'application/json' } });
  assert.equal(res.status, 400);
  assert.deepEqual(res.json, { error: 'Geçersiz JSON.' });
});

test('dizin gezintisi ve dotfile engellenir, dizin listesi yok', async () => {
  for (const path of ['/static/../package.json', '/static/%2e%2e/package.json', '/static/..%2fpackage.json', '/static/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    '/static/%2e%2e/src/app.js', '/static/.env', '/static/', '/static/js/', '/static/js', '/package.json', '/src/app.js', '/views/index.html']) {
    const res = await s.req('GET', path);
    assert.notEqual(res.status, 200, path);
    assert.ok(!res.text.includes('"dependencies"') && !res.text.includes('createApp') && !res.text.includes('root:'), path);
  }
  const ok = await s.req('GET', '/static/js/app.js');
  assert.equal(ok.status, 200);
});

test('statik sayfalar satır içi script/style içermez', async () => {
  for (const path of ['/', '/giris', '/kisi/' + 'a'.repeat(32)]) {
    const res = await s.req('GET', path);
    assert.equal(res.status, 200);
    assert.doesNotMatch(res.text, /<script(?![^>]*\bsrc=)[^>]*>/i);
    assert.doesNotMatch(res.text, /<style|style=|onclick=|onload=/i);
  }
});
