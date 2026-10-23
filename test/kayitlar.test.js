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
  // Kişi listesi yalnızca kimlik, ad ve sayıları döndürür (iç anahtarlar sızmaz).
  for (const p of people) assert.deepEqual(Object.keys(p).sort(), ['done', 'id', 'name', 'planned']);
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
  assert.deepEqual(edited.json.kayit, { id: k.id, personId: people[1].id, region: 'Manisa', date: '2026-10-16', endDate: '2026-10-16', note: '', status: 'planned' });

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

test('tarih aralığıyla listeleme (yıllık hafta planı)', async () => {
  const pid = people[3].id;
  const ids = [];
  for (const date of ['2025-12-28', '2025-12-29', '2027-01-03', '2027-01-04']) {
    ids.push((await add({ personId: pid, region: `Aralık ${date}`, date })).json.kayit.id);
  }
  // 2026'nın ISO haftaları: 29.12.2025 (1. hafta pazartesi) – 03.01.2027 (53. hafta pazar)
  const res = await s.req('GET', '/api/kayitlar?bas=2025-12-29&bit=2027-01-03', { session: ed });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.kayitlar.filter((k) => k.personId === pid).map((k) => k.date), ['2025-12-29', '2027-01-03']);
  for (const q of ['bas=2026-01-01', 'bas=2026-02-30&bit=2026-03-01', 'bas=2026-05-01&bit=2026-04-01',
    'bas=2026-01-01&bit=2027-06-01', 'ay=2026-10&bas=2026-10-01&bit=2026-10-31']) {
    assert.equal((await s.req('GET', `/api/kayitlar?${q}`, { session: ed })).status, 400, q);
  }
  for (const id of ids) await s.req('DELETE', `/api/kayitlar/${id}`, { session: ed });
});

test('başlangıç–bitiş tarihli seyahat: gün sayısı, ay kesişimi, süre korunarak kaydırma', async () => {
  const pid = people[1].id;
  const r = await add({ personId: pid, region: 'Uzun yol', date: '2026-10-30', endDate: '2026-11-02', status: 'planned' });
  assert.equal(r.status, 201);
  assert.equal(r.json.kayit.endDate, '2026-11-02');
  const id = r.json.kayit.id;
  // Ekim'de başlayıp Kasım'da biten seyahat iki ayda da görünür.
  for (const ay of ['2026-10', '2026-11']) {
    const list = (await s.req('GET', `/api/kayitlar?ay=${ay}`, { session: ed })).json.kayitlar;
    assert.ok(list.some((k) => k.id === id), ay);
  }
  assert.ok(!(await s.req('GET', '/api/kayitlar?ay=2026-12', { session: ed })).json.kayitlar.some((k) => k.id === id));
  // Yalnızca başlangıç değişince süre (4 gün) korunur.
  const moved = await s.req('PATCH', `/api/kayitlar/${id}`, { session: ed, body: { date: '2026-12-01' } });
  assert.deepEqual([moved.json.kayit.date, moved.json.kayit.endDate], ['2026-12-01', '2026-12-04']);
  const shortened = await s.req('PATCH', `/api/kayitlar/${id}`, { session: ed, body: { endDate: '2026-12-02' } });
  assert.equal(shortened.json.kayit.endDate, '2026-12-02');
  assert.equal((await s.req('PATCH', `/api/kayitlar/${id}`, { session: ed, body: { endDate: '2026-11-30' } })).status, 400);
  // Bitiş verilmezse tek günlük sayılır; ters sıra ve 365 günden uzun reddedilir.
  assert.equal((await add({ personId: pid, region: 'Tek', date: '2026-10-05' })).json.kayit.endDate, '2026-10-05');
  assert.equal((await add({ personId: pid, region: 'Ters', date: '2026-10-05', endDate: '2026-10-04' })).status, 400);
  assert.equal((await add({ personId: pid, region: 'Uzun', date: '2026-01-01', endDate: '2027-01-01' })).status, 400);
  assert.equal((await add({ personId: pid, region: 'Bozuk', date: '2026-10-05', endDate: '2026-02-30' })).status, 400);
  await s.req('DELETE', `/api/kayitlar/${id}`, { session: ed });
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
    { ...base, note: 'n'.repeat(5001) },
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
  for (const body of [{}, { bilinmeyen: 1 }, { date: '2026-02-30' }, { note: 'n'.repeat(5001) }, { personId: 9999 }]) {
    assert.equal((await s.req('PATCH', `/api/kayitlar/${id}`, { session: ed, body })).status, 400, JSON.stringify(body));
  }
  assert.equal((await s.req('PATCH', '/api/kayitlar/abc', { session: ed, body: { status: 'done' } })).status, 404);
  await s.req('DELETE', `/api/kayitlar/${id}`, { session: ed });
});

test('uzun not kabul edilir; kontrol ve yön karakterleri temizlenir', async () => {
  const res = await add({ personId: people[0].id, region: 'An‮kara\u0007', date: '2026-10-12', note: `${'ç'.repeat(499)}‏!`, status: 'done' });
  assert.equal(res.status, 201);
  assert.equal(res.json.kayit.region, 'Ankara');
  assert.equal([...res.json.kayit.note].length, 500);
  await s.req('DELETE', `/api/kayitlar/${res.json.kayit.id}`, { session: ed });
});

test('uzun not (5000 karaktere kadar) tam saklanır; eski kısa notlar okunur; not silinebilir', async () => {
  const long = `Saha ziyareti\n${'Konya bölgesinde fiyat görüşmesi. '.repeat(120)}`.slice(0, 4000);
  const r = await add({ personId: people[0].id, region: 'Konya', date: '2026-10-22', note: long });
  assert.equal(r.status, 201);
  assert.equal(r.json.kayit.note, long);
  const id = r.json.kayit.id;
  const list = (await s.req('GET', '/api/kayitlar?ay=2026-10', { session: ed })).json.kayitlar;
  assert.equal(list.find((k) => k.id === id).note.length, 4000);
  const longer = 'x'.repeat(5000);
  assert.equal((await s.req('PATCH', `/api/kayitlar/${id}`, { session: ed, body: { note: longer } })).json.kayit.note, longer);
  assert.equal((await s.req('PATCH', `/api/kayitlar/${id}`, { session: ed, body: { note: '' } })).json.kayit.note, '');
  // Uzun not özelliğinden önce kaydedilmiş not (yalnızca "note" sütununda) görünmeye devam eder.
  const old = s.db.prepare("INSERT INTO trips (person_id, region, date, end_date, note, status) VALUES (?, 'Eski', '2026-10-01', '2026-10-01', 'Eski not', 'done')")
    .run(people[0].id);
  const oldTrip = (await s.req('GET', '/api/kayitlar?ay=2026-10', { session: ed })).json.kayitlar.find((k) => k.id === Number(old.lastInsertRowid));
  assert.equal(oldTrip.note, 'Eski not');
  await s.req('DELETE', `/api/kayitlar/${id}`, { session: ed });
  await s.req('DELETE', `/api/kayitlar/${oldTrip.id}`, { session: ed });
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
  await s.req('DELETE', `/api/kayitlar/${id}`, { session: ed });
});

test('kişi linki özelliği kaldırıldı: paylaşım ve link yenileme uçları yok', async () => {
  const admin = await s.login('yonetici');
  assert.equal((await s.req('GET', `/api/paylasim/${'A'.repeat(32)}`)).status, 404);
  assert.equal((await s.req('POST', `/api/kisiler/${people[0].id}/link-yenile`, { session: admin })).status, 404);
  assert.equal((await s.req('GET', `/kisi/${'A'.repeat(32)}`)).status, 404);
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
