import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, PASSWORDS } from './helpers.js';
import { upsertUser } from '../src/auth.js';
import { loadConfig } from '../src/config.js';

test('aynı kullanıcı adına 8 hatalı denemeden sonra 429 + Retry-After; doğru parola da reddedilir', async () => {
  const s = await startServer();
  try {
    for (let i = 0; i < 8; i++) {
      const r = await s.req('POST', '/api/giris', { body: { username: 'editor', password: `yanlis-${i}-parola` } });
      assert.equal(r.status, 401);
    }
    const locked = await s.req('POST', '/api/giris', { body: { username: 'editor', password: PASSWORDS.editor } });
    assert.equal(locked.status, 429);
    const retry = Number(locked.headers.get('retry-after'));
    assert.ok(retry > 0 && retry <= 15 * 60);
    // Başka kullanıcı etkilenmez.
    assert.equal((await s.req('POST', '/api/giris', { body: { username: 'yonetici', password: PASSWORDS.yonetici } })).status, 200);
    // Kullanıcı adı büyük/küçük harf farkıyla kilit atlatılamaz.
    assert.equal((await s.req('POST', '/api/giris', { body: { username: 'EDITOR', password: PASSWORDS.editor } })).status, 429);
  } finally {
    await s.close();
  }
});

test('başarılı giriş kullanıcı sayacını sıfırlar; yalnızca hatalı denemeler sayılır', async () => {
  const s = await startServer();
  try {
    for (let i = 0; i < 7; i++) {
      assert.equal((await s.req('POST', '/api/giris', { body: { username: 'editor', password: 'yanlis-parola-xx' } })).status, 401);
    }
    assert.equal((await s.req('POST', '/api/giris', { body: { username: 'editor', password: PASSWORDS.editor } })).status, 200);
    for (let i = 0; i < 7; i++) {
      assert.equal((await s.req('POST', '/api/giris', { body: { username: 'editor', password: 'yanlis-parola-xx' } })).status, 401);
    }
    // Sıfırlanmasaydı burada 429 olurdu.
    assert.equal((await s.req('POST', '/api/giris', { body: { username: 'editor', password: PASSWORDS.editor } })).status, 200);
    // Başarılı girişler sayılmaz.
    for (let i = 0; i < 10; i++) {
      assert.equal((await s.req('POST', '/api/giris', { body: { username: 'izleyici', password: PASSWORDS.izleyici } })).status, 200);
    }
    const fails = s.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'giris_basarisiz'").get().n;
    assert.equal(fails, 14);
  } finally {
    await s.close();
  }
});

test('aynı IP\'den 30 hatalı denemeden sonra 429', async () => {
  const s = await startServer();
  try {
    for (let i = 0; i < 30; i++) {
      const r = await s.req('POST', '/api/giris', { body: { username: `yok-${i}`, password: 'yanlis-parola-xx' } });
      assert.equal(r.status, 401, `deneme ${i + 1}`);
    }
    const r = await s.req('POST', '/api/giris', { body: { username: 'yonetici', password: PASSWORDS.yonetici } });
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers.get('retry-after')) > 0);
  } finally {
    await s.close();
  }
});

test('genel istek sınırı aşılınca 429', async () => {
  const s = await startServer({ limits: { generalPerMinute: 5 } });
  try {
    for (let i = 0; i < 5; i++) assert.equal((await s.req('GET', '/saglik')).status, 200);
    const r = await s.req('GET', '/saglik');
    assert.equal(r.status, 429);
    assert.ok(r.headers.get('retry-after'));
  } finally {
    await s.close();
  }
});

test('kullanıcı yeniden eklenince parola/rol güncellenir ve açık oturumlar kapanır', async () => {
  const s = await startServer();
  try {
    const sess = await s.login('editor');
    const r = await upsertUser(s.db, 'editor', 'yepyeni-parola-9876', 'viewer');
    assert.equal(r.created, false);
    assert.equal((await s.req('GET', '/api/oturum', { session: sess })).status, 401);
    assert.equal((await s.req('POST', '/api/giris', { body: { username: 'editor', password: PASSWORDS.editor } })).status, 401);
    const fresh = await s.login('editor', 'yepyeni-parola-9876');
    assert.equal(fresh.user.role, 'viewer');
  } finally {
    await s.close();
  }
});

test('parola özeti scrypt biçiminde, düz metin saklanmaz', async () => {
  const s = await startServer();
  try {
    const row = s.db.prepare("SELECT password_hash FROM users WHERE username = 'editor'").get();
    assert.match(row.password_hash, /^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]{24}\$[A-Za-z0-9+/=]+$/);
    assert.ok(!row.password_hash.includes(PASSWORDS.editor));
  } finally {
    await s.close();
  }
});

test('paralel hatalı denemeler kullanıcı kilidini aşamaz', async () => {
  const s = await startServer();
  try {
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      s.req('POST', '/api/giris', { body: { username: 'editor', password: `paralel-yanlis-${i}` } })));
    const statuses = results.map((r) => r.status);
    assert.equal(statuses.filter((x) => x === 401).length, 8);
    assert.equal(statuses.filter((x) => x === 429).length, 12);
    assert.equal((await s.req('POST', '/api/giris', { body: { username: 'editor', password: PASSWORDS.editor } })).status, 429);
  } finally {
    await s.close();
  }
});

test('başarılı girişler IP sayacını doldurmaz', async () => {
  const s = await startServer({ limits: { loginIpFailures: 3 } });
  try {
    for (let i = 0; i < 6; i++) await s.login('izleyici');
    assert.equal((await s.req('POST', '/api/giris', { body: { username: 'yok', password: 'yanlis-parola-xx' } })).status, 401);
    await s.login('editor');
  } finally {
    await s.close();
  }
});

test('geçersiz PUBLIC_URL başlangıçta reddedilir', () => {
  assert.throws(() => loadConfig({ skipEnvFile: true, env: { PUBLIC_URL: 'seyahat.ornek' } }), /PUBLIC_URL/);
  assert.throws(() => loadConfig({ skipEnvFile: true, env: { PUBLIC_URL: 'ftp://seyahat.ornek' } }), /PUBLIC_URL/);
  assert.equal(loadConfig({ skipEnvFile: true, env: { PUBLIC_URL: 'https://seyahat.ornek/' } }).publicUrl, 'https://seyahat.ornek');
});

test('PUBLIC_URL verildiğinde Origin ona göre denetlenir', async () => {
  const s = await startServer({ env: { PUBLIC_URL: 'https://seyahat.ornek' } });
  try {
    assert.equal((await s.req('POST', '/api/giris', { body: { username: 'editor', password: PASSWORDS.editor } })).status, 403);
    assert.equal((await s.req('POST', '/api/giris', { body: { username: 'editor', password: PASSWORDS.editor }, origin: 'https://seyahat.ornek' })).status, 200);
  } finally {
    await s.close();
  }
});

test('girişte kullanıcı adı Türkçe harf ve büyük/küçük harf duyarsız', async () => {
  const s = await startServer();
  try {
    await upsertUser(s.db, 'kursat', 'kursat-parola-1234', 'admin');
    for (const name of ['kursat', 'Kürşat', 'KÜRŞAT', ' kürşat ']) {
      assert.equal((await s.req('POST', '/api/giris', { body: { username: name, password: 'kursat-parola-1234' } })).status, 200, name);
    }
    assert.equal((await s.req('POST', '/api/giris', { body: { username: 'SELİM', password: 'x' } })).status, 401);
  } finally {
    await s.close();
  }
});
