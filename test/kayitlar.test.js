import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { INITIAL_PEOPLE } from '../src/db.js';

let s;
let ed;
let people;
before(async () => {
  s = await startServer();
  ed = await s.login('editor');
  people = (await s.req('GET', '/api/kisiler', { session: ed })).json.kisiler;
});
after(async () => { await s.close(); });

const add = (body, session = ed) => s.req('POST', '/api/kayitlar', { session, body });

test('4 kişi ilk kurulumda tanımlı', async () => {
  assert.deepEqual(people.map((p) => p.name), INITIAL_PEOPLE);
  for (const p of people) assert.match(p.shareKey, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(new Set(people.map((p) => p.shareKey)).size, 4);
});

test('viewer paylaşım anahtarlarını göremez', async () => {
  const v = await s.login('izleyici');
  const res = await s.req('GET', '/api/kisiler', { session: v });
  assert.equal(res.status, 200);
  assert.equal(res.json.kisiler.length, 4);
  for (const p of res.json.kisiler) assert.equal(p.shareKey, undefined);
});

test('ekle / durum değiştir / düzenle / sil', async () => {
  const created = await add({ personId: people[0].id, region: '  İzmir  ', date: '2026-10-15', note: 'Fuar ziyareti', status: 'planned' });
  assert.equal(created.status, 201);
  const k = created.json.kayit;
  assert.equal(k.region, 'İzmir');
  assert.equal(k.status, 'planned');
  assert.equal(k.personId, people[0].id);

  const done = await s.req('PATCH', `/api/kayitlar/${k.id}`, { session: ed, body: { status: 'done' } });
  assert.equal(done.status, 200);
  assert.equal(done.json.kayit.status, 'done');
  assert.equal(done.json.kayit.region, 'İzmir');

  const back = await s.req('PATCH', `/api/kayitlar/${k.id}`, { session: ed, body: { status: 'planned' } });
  assert.equal(back.json.kayit.status, 'planned');

  const edited = await s.req('PATCH', `/api/kayitlar/${k.id}`, {
    session: ed, body: { region: 'Manisa', date: '2026-10-16', note: '', personId: people[1].id },
  });
  assert.equal(edited.status, 200);
  assert.deepEqual(edited.json.kayit, { id: k.id, personId: people[1].id, region: 'Manisa', date: '2026-10-16', note: '', status: 'planned' });

  const del = await s.req('DELETE', `/api/kayitlar/${k.id}`, { session: ed });
  assert.equal(del.status, 204);
  assert.equal((await s.req('DELETE', `/api/kayitlar/${k.id}`, { session: ed })).status, 404);
  assert.equal((await s.req('PATCH', `/api/kayitlar/${k.id}`, { session: ed, body: { status: 'done' } })).status, 404);

  const actions = s.db.prepare("SELECT action FROM audit WHERE action LIKE 'kayit_%' ORDER BY id").all().map((r) => r.action);
  assert.deepEqual(actions, ['kayit_ekle', 'kayit_guncelle', 'kayit_guncelle', 'kayit_guncelle', 'kayit_sil']);
});

test('aya göre listeleme sınır günleriyle doğru', async () => {
  const pid = people[2].id;
  const ids = {};
  for (const date of ['2026-09-30', '2026-10-01', '2026-10-31', '2026-11-01']) {
    ids[date] = (await add({ personId: pid, region: `Sınır ${date}`, date, status: 'planned' })).json.kayit.id;
  }
  const res = await s.req('GET', '/api/kayitlar?ay=2026-10', { session: ed });
  assert.equal(res.status, 200);
  const got = res.json.kayitlar.filter((k) => k.personId === pid).map((k) => k.date);
  assert.deepEqual(got, ['2026-10-01', '2026-10-31']);

  const counts = (await s.req('GET', '/api/kisiler?ay=2026-10', { session: ed })).json.kisiler.find((p) => p.id === pid);
  assert.equal(counts.planned, 2);

  const feb = await add({ personId: pid, region: 'Şubat sonu', date: '2028-02-29', status: 'done' });
  assert.equal(feb.status, 201, 'artık yıl 29 Şubat geçerli');
  const febList = await s.req('GET', '/api/kayitlar?ay=2028-02', { session: ed });
  assert.deepEqual(febList.json.kayitlar.map((k) => k.date), ['2028-02-29']);

  const all = await s.req('GET', '/api/kayitlar', { session: ed });
  assert.ok(all.json.kayitlar.length >= 5);

  for (const bad of ['2026-13', '2026-1', '1999-12', 'abc', "2026-10' OR 1=1--"]) {
    assert.equal((await s.req('GET', `/api/kayitlar?ay=${encodeURIComponent(bad)}`, { session: ed })).status, 400, bad);
  }
  for (const id of Object.values(ids)) await s.req('DELETE', `/api/kayitlar/${id}`, { session: ed });
});

test('geçersiz girdiler reddedilir', async () => {
  const base = { personId: people[0].id, region: 'Bursa', date: '2026-10-10', status: 'planned' };
  const cases = [
    { ...base, date: '2026-02-30' },
    { ...base, date: '2027-02-29' },
    { ...base, date: '2026-10-1' },
    { ...base, date: '1999-12-31' },
    { ...base, date: '2101-01-01' },
    { ...base, date: 20261010 },
    { ...base, personId: 9999 },
    { ...base, personId: 'abc' },
    { ...base, personId: -1 },
    { ...base, extra: 'x' },
    { ...base, __proto__x: 1 },
    { ...base, note: 'n'.repeat(501) },
    { ...base, region: 'r'.repeat(81) },
    { ...base, region: '   ' },
    { ...base, region: '‮​' },
    { ...base, region: 42 },
    { ...base, status: 'iptal' },
    { personId: people[0].id, date: '2026-10-10' },
  ];
  for (const body of cases) {
    const res = await add(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(typeof res.json.error, 'string');
  }
  const arr = await s.req('POST', '/api/kayitlar', { session: ed, rawBody: '[1,2]', headers: { 'Content-Type': 'application/json' } });
  assert.equal(arr.status, 400);

  const okRes = await add({ ...base });
  const id = okRes.json.kayit.id;
  for (const body of [{}, { bilinmeyen: 1 }, { date: '2026-02-30' }, { note: 'n'.repeat(501) }, { personId: 9999 }]) {
    assert.equal((await s.req('PATCH', `/api/kayitlar/${id}`, { session: ed, body })).status, 400, JSON.stringify(body));
  }
  assert.equal((await s.req('PATCH', '/api/kayitlar/abc', { session: ed, body: { status: 'done' } })).status, 404);
  await s.req('DELETE', `/api/kayitlar/${id}`, { session: ed });
});

test('500 karakterlik not kabul edilir; kontrol ve yön karakterleri temizlenir', async () => {
  const res = await add({ personId: people[0].id, region: 'An‮kara\u0007', date: '2026-10-12', note: `${'ç'.repeat(499)}‏!`, status: 'done' });
  assert.equal(res.status, 201);
  assert.equal(res.json.kayit.region, 'Ankara');
  assert.equal([...res.json.kayit.note].length, 500);
  await s.req('DELETE', `/api/kayitlar/${res.json.kayit.id}`, { session: ed });
});

test('HTML içeren metin olduğu gibi saklanır (arayüz textContent ile basar)', async () => {
  const res = await add({ personId: people[0].id, region: '<img src=x onerror=alert(1)>', date: '2026-10-12', status: 'planned' });
  assert.equal(res.status, 201);
  assert.equal(res.json.kayit.region, '<img src=x onerror=alert(1)>');
  await s.req('DELETE', `/api/kayitlar/${res.json.kayit.id}`, { session: ed });
});

test('viewer yazamaz', async () => {
  const v = await s.login('izleyici');
  assert.equal((await s.req('GET', '/api/kayitlar', { session: v })).status, 200);
  const created = await add({ personId: people[0].id, region: 'Konya', date: '2026-10-20', status: 'planned' });
  const id = created.json.kayit.id;
  assert.equal((await add({ personId: people[0].id, region: 'Konya', date: '2026-10-20', status: 'planned' }, v)).status, 403);
  assert.equal((await s.req('PATCH', `/api/kayitlar/${id}`, { session: v, body: { status: 'done' } })).status, 403);
  assert.equal((await s.req('DELETE', `/api/kayitlar/${id}`, { session: v })).status, 403);
  assert.equal((await s.req('POST', `/api/kisiler/${people[0].id}/link-yenile`, { session: v })).status, 403);
  await s.req('DELETE', `/api/kayitlar/${id}`, { session: ed });
});

test('editör linki yenileyemez, yönetici yenileyebilir', async () => {
  assert.equal((await s.req('POST', `/api/kisiler/${people[3].id}/link-yenile`, { session: ed })).status, 403);
});

test('paylaşım linki yalnızca o kişiyi gösterir; yenilenince eskisi 404', async () => {
  const [a, b] = people;
  const ka = (await add({ personId: a.id, region: 'Trabzon', date: '2026-10-08', note: 'A notu', status: 'planned' })).json.kayit;
  const kb = (await add({ personId: b.id, region: 'Rize', date: '2026-10-09', note: 'B notu', status: 'done' })).json.kayit;

  const res = await s.req('GET', `/api/paylasim/${a.shareKey}?ay=2026-10`);
  assert.equal(res.status, 200);
  assert.equal(res.json.name, a.name);
  assert.deepEqual(Object.keys(res.json).sort(), ['kayitlar', 'name']);
  assert.ok(res.json.kayitlar.length >= 1);
  for (const k of res.json.kayitlar) assert.deepEqual(Object.keys(k).sort(), ['date', 'note', 'region', 'status']);
  assert.ok(res.json.kayitlar.some((k) => k.region === 'Trabzon'));
  assert.ok(!res.json.kayitlar.some((k) => k.region === 'Rize'));
  assert.ok(!res.text.includes(`"id"`) && !res.text.includes('personId') && !res.text.includes('shareKey'));

  assert.equal((await s.req('GET', '/api/paylasim/kisa')).status, 404);
  assert.equal((await s.req('GET', `/api/paylasim/${'!'.repeat(32)}`)).status, 404);
  assert.equal((await s.req('GET', `/api/paylasim/${'A'.repeat(32)}`)).status, 404);

  const admin = await s.login('yonetici');
  const renewed = await s.req('POST', `/api/kisiler/${a.id}/link-yenile`, { session: admin });
  assert.equal(renewed.status, 200);
  assert.match(renewed.json.shareKey, /^[A-Za-z0-9_-]{32}$/);
  assert.notEqual(renewed.json.shareKey, a.shareKey);

  const old = await s.req('GET', `/api/paylasim/${a.shareKey}`);
  assert.equal(old.status, 404);
  assert.equal(old.json.error, 'Bu link geçersiz ya da yenilenmiş.');
  const fresh = await s.req('GET', `/api/paylasim/${renewed.json.shareKey}`);
  assert.equal(fresh.status, 200);
  assert.equal(fresh.json.name, a.name);

  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'link_yenile'").get().n, 1);
  assert.equal((await s.req('POST', '/api/kisiler/9999/link-yenile', { session: admin })).status, 404);
  await s.req('DELETE', `/api/kayitlar/${ka.id}`, { session: ed });
  await s.req('DELETE', `/api/kayitlar/${kb.id}`, { session: ed });
});

test('paylaşım ucunda dakikada 30 istek sınırı', async () => {
  const p = await startServer({ limits: { sharePerMinute: 30 } });
  try {
    const statuses = [];
    for (let i = 0; i < 31; i++) statuses.push((await p.req('GET', `/api/paylasim/${'B'.repeat(32)}`)).status);
    assert.ok(statuses.slice(0, 30).every((x) => x === 404));
    const last = await p.req('GET', `/api/paylasim/${'B'.repeat(32)}`);
    assert.equal(last.status, 429);
    assert.ok(Number(last.headers.get('retry-after')) > 0);
  } finally {
    await p.close();
  }
});

test('denetim kaydı giriş ve çıkışları kullanıcı ve IP ile tutar', async () => {
  const sess = await s.login('editor');
  await s.req('POST', '/api/cikis', { session: sess });
  const rows = s.db.prepare("SELECT action, username, ip FROM audit WHERE action IN ('giris', 'cikis') ORDER BY id DESC LIMIT 2").all();
  assert.deepEqual(rows.map((r) => r.action), ['cikis', 'giris']);
  for (const r of rows) {
    assert.equal(r.username, 'editor');
    assert.ok(r.ip);
  }
});
