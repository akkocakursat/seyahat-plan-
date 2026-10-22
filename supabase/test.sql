-- Seyahat Defteri — Supabase API testleri
-- kurulum.sql uygulanmış boş bir veritabanında, süper kullanıcıyla çalıştırılır:
--   psql -v ON_ERROR_STOP=1 -f supabase/kurulum.sql -f supabase/test.sql
-- API çağrıları tarayıcının kullandığı "anon" rolüyle yapılır.

\set QUIET on
\o /dev/null
select seyahat.kullanici_ekle('yonetici', 'yonetici-parola-123', 'admin');
select seyahat.kullanici_ekle('editor', 'editor-parola-1234', 'editor');
select seyahat.kullanici_ekle('izleyici', 'izleyici-parola-12', 'viewer');

-- Kısa parola reddedilir.
do $$
begin
  perform seyahat.kullanici_ekle('kisa', 'kisa-parola', 'viewer');
  raise exception 'kısa parola kabul edildi';
exception when raise_exception then
  if sqlerrm not like '%12 karakter%' then raise; end if;
end $$;

set role anon;
select set_config('request.headers', '{"cf-connecting-ip": "203.0.113.7"}', false);

-- Tablolara doğrudan erişim yok.
do $$
begin
  perform 1 from seyahat.trips;
  raise exception 'anon tablolara erişebildi';
exception when insufficient_privilege then null;
end $$;
do $$
begin
  perform seyahat.kullanici_ekle('saldirgan', 'saldirgan-parola-1', 'admin');
  raise exception 'anon yönetim fonksiyonunu çalıştırabildi';
exception when insufficient_privilege then null;
end $$;

do $$
declare
  r json;
  ed text;
  adm text;
  vw text;
  k1 json;
  k2 json;
  pid bigint;
  pid2 bigint;
  tid bigint;
  ids bigint[] := '{}';
  key_old text;
  key_new text;
  bad jsonb;
  i int;
begin
  -- Aynı hata mesajı
  r := public.giris('editor', 'yanlis-parola-xx');
  assert (r ->> 'status')::int = 401, 'yanlış parola 401 olmalı';
  assert r ->> 'error' = 'Kullanıcı adı veya parola hatalı.', 'hata mesajı';
  assert (public.giris('olmayan', 'yanlis-parola-xx') ->> 'error') = (r ->> 'error'), 'aynı hata mesajı';
  assert r ->> 'token' is null, 'hatalı girişte anahtar dönmemeli';

  -- Giriş
  r := public.giris('editor', 'editor-parola-1234');
  ed := r ->> 'token';
  assert ed ~ '^[A-Za-z0-9_-]{43}$', 'oturum anahtarı biçimi';
  assert r -> 'user' ->> 'role' = 'editor', 'rol';
  adm := public.giris('YONETICI', 'yonetici-parola-123') ->> 'token';
  assert adm is not null, 'kullanıcı adı büyük/küçük harf duyarsız';
  vw := public.giris('izleyici', 'izleyici-parola-12') ->> 'token';

  -- Oturumsuz erişim 401
  assert (public.oturum(null) ->> 'status')::int = 401;
  assert (public.oturum('x') ->> 'status')::int = 401;
  assert (public.kayitlar_listele(null) ->> 'status')::int = 401;
  assert (public.kisiler_listele('A' || repeat('b', 42)) ->> 'status')::int = 401;
  assert (public.kayit_ekle(null, '{}') ->> 'status')::int = 401;
  assert public.oturum(ed) -> 'user' ->> 'username' = 'editor';

  -- 4 kişi; editör paylaşım anahtarını görür, izleyici görmez
  k1 := public.kisiler_listele(ed) -> 'kisiler';
  assert json_array_length(k1) = 4, '4 kişi';
  assert k1 -> 0 ->> 'name' = 'Selim Kutlubay';
  assert k1 -> 3 ->> 'name' = 'Kürşat Akkoca';
  assert k1 -> 0 ->> 'shareKey' ~ '^[A-Za-z0-9_-]{32}$', 'anahtar biçimi';
  k2 := public.kisiler_listele(vw) -> 'kisiler';
  assert k2 -> 0 ->> 'shareKey' is null, 'izleyici anahtarı görmemeli';
  pid := (k1 -> 0 ->> 'id')::bigint;
  pid2 := (k1 -> 1 ->> 'id')::bigint;
  key_old := k1 -> 0 ->> 'shareKey';

  -- Ekle / durum değiştir / düzenle / sil
  r := public.kayit_ekle(ed, jsonb_build_object('personId', pid, 'region', '  İzmir  ', 'date', '2026-10-15', 'note', 'Fuar', 'status', 'planned'));
  assert r -> 'kayit' ->> 'region' = 'İzmir', 'bölge kırpılmalı';
  tid := (r -> 'kayit' ->> 'id')::bigint;
  r := public.kayit_guncelle(ed, tid, '{"status": "done"}');
  assert r -> 'kayit' ->> 'status' = 'done' and r -> 'kayit' ->> 'region' = 'İzmir', 'durum değişimi';
  r := public.kayit_guncelle(ed, tid, jsonb_build_object('region', 'Manisa', 'date', '2026-10-16', 'note', '', 'personId', pid2, 'status', 'planned'));
  assert r -> 'kayit' ->> 'region' = 'Manisa' and (r -> 'kayit' ->> 'personId')::bigint = pid2 and r -> 'kayit' ->> 'date' = '2026-10-16', 'düzenleme';
  assert public.kayit_sil(ed, tid) ->> 'ok' = 'true', 'silme';
  assert (public.kayit_sil(ed, tid) ->> 'status')::int = 404, 'olmayan kayıt silinemez';
  assert not exists (select 1 from json_array_elements(public.kayitlar_listele(ed) -> 'kayitlar') e
                    where (e ->> 'id')::bigint = tid), 'silinen kayıt listelenmemeli';
  assert (public.kayit_guncelle(ed, tid, '{"status": "done"}') ->> 'status')::int = 404;

  -- Ay sınırları: 30 Eylül ve 1 Kasım hariç, 1 ve 31 Ekim dahil
  for i in 1..4 loop
    r := public.kayit_ekle(ed, jsonb_build_object('personId', pid2, 'region', 'Sınır',
           'date', (array['2026-09-30', '2026-10-01', '2026-10-31', '2026-11-01'])[i]));
    ids := ids || (r -> 'kayit' ->> 'id')::bigint;
  end loop;
  r := public.kayitlar_listele(ed, '2026-10');
  assert (select array_agg(e ->> 'date' order by e ->> 'date') from json_array_elements(r -> 'kayitlar') e)
         = array['2026-10-01', '2026-10-31'], 'ay sınırları';
  assert ((public.kisiler_listele(ed, '2026-10') -> 'kisiler' -> 1 ->> 'planned'))::int = 2, 'aylık sayım';
  assert json_array_length(public.kayitlar_listele(ed) -> 'kayitlar') = 4, 'ay verilmezse tümü';
  assert (public.kayitlar_listele(ed, '2026-13') ->> 'status')::int = 400;
  assert (public.kayitlar_listele(ed, '1999-12') ->> 'status')::int = 400;
  assert (public.kayitlar_listele(ed, '2026-10'' or 1=1--') ->> 'status')::int = 400;
  r := public.kayit_ekle(ed, jsonb_build_object('personId', pid2, 'region', 'Artık yıl', 'date', '2028-02-29', 'status', 'done'));
  assert r -> 'kayit' is not null, '29 Şubat 2028 geçerli';
  ids := ids || (r -> 'kayit' ->> 'id')::bigint;

  -- Tarih aralığı (yıllık hafta planı)
  r := public.kayitlar_aralik(ed, '2026-09-30', '2026-10-31');
  assert (select array_agg(e ->> 'date' order by e ->> 'date') from json_array_elements(r -> 'kayitlar') e
          where e ->> 'region' = 'Sınır') = array['2026-09-30', '2026-10-01', '2026-10-31'], 'aralık';
  assert (public.kayitlar_aralik(ed, '2026-05-01', '2026-04-01') ->> 'status')::int = 400;
  assert (public.kayitlar_aralik(ed, '2026-01-01', '2027-06-01') ->> 'status')::int = 400;
  assert (public.kayitlar_aralik(ed, '2026-02-30', '2026-03-01') ->> 'status')::int = 400;
  assert (public.kayitlar_aralik(null, '2026-01-01', '2026-02-01') ->> 'status')::int = 401;

  -- Başlangıç–bitiş: ay kesişimi, süre korunarak kaydırma, ters sıra ve 365 gün sınırı
  r := public.kayit_ekle(ed, jsonb_build_object('personId', pid, 'region', 'Uzun yol', 'date', '2026-10-30', 'endDate', '2026-11-02'));
  assert r -> 'kayit' ->> 'endDate' = '2026-11-02', 'bitiş kaydedilmeli';
  tid := (r -> 'kayit' ->> 'id')::bigint;
  ids := ids || tid;
  assert exists (select 1 from json_array_elements(public.kayitlar_listele(ed, '2026-11') -> 'kayitlar') e where (e ->> 'id')::bigint = tid), 'Kasım';
  assert exists (select 1 from json_array_elements(public.kayitlar_listele(ed, '2026-10') -> 'kayitlar') e where (e ->> 'id')::bigint = tid), 'Ekim';
  r := public.kayit_guncelle(ed, tid, '{"date": "2026-12-01"}');
  assert r -> 'kayit' ->> 'endDate' = '2026-12-04', 'süre korunmalı: ' || (r -> 'kayit' ->> 'endDate');
  assert (public.kayit_guncelle(ed, tid, '{"endDate": "2026-11-30"}') ->> 'status')::int = 400, 'ters sıra';
  assert public.kayit_guncelle(ed, tid, '{"endDate": "2026-12-02"}') -> 'kayit' ->> 'endDate' = '2026-12-02';
  assert (public.kayit_ekle(ed, jsonb_build_object('personId', pid, 'region', 'X', 'date', '2026-10-05', 'endDate', '2026-10-04')) ->> 'status')::int = 400;
  assert (public.kayit_ekle(ed, jsonb_build_object('personId', pid, 'region', 'X', 'date', '2026-01-01', 'endDate', '2027-01-01')) ->> 'status')::int = 400;
  assert (public.kayit_ekle(ed, jsonb_build_object('personId', pid, 'region', 'X', 'date', '2026-10-05', 'endDate', '2026-02-30')) ->> 'status')::int = 400;
  r := public.kayit_ekle(ed, jsonb_build_object('personId', pid, 'region', 'Tek gün', 'date', '2026-10-06'));
  assert r -> 'kayit' ->> 'endDate' = '2026-10-06', 'bitiş verilmezse tek gün';
  ids := ids || (r -> 'kayit' ->> 'id')::bigint;

  -- Geçersiz girdiler
  foreach bad in array array[
    jsonb_build_object('personId', pid, 'region', 'Bursa', 'date', '2026-02-30'),
    jsonb_build_object('personId', pid, 'region', 'Bursa', 'date', '2027-02-29'),
    jsonb_build_object('personId', pid, 'region', 'Bursa', 'date', '2026-10-1'),
    jsonb_build_object('personId', pid, 'region', 'Bursa', 'date', '1999-12-31'),
    jsonb_build_object('personId', pid, 'region', 'Bursa', 'date', '2101-01-01'),
    jsonb_build_object('personId', pid, 'region', 'Bursa', 'date', 20261010),
    jsonb_build_object('personId', 999999, 'region', 'Bursa', 'date', '2026-10-10'),
    jsonb_build_object('personId', 'abc', 'region', 'Bursa', 'date', '2026-10-10'),
    jsonb_build_object('personId', -1, 'region', 'Bursa', 'date', '2026-10-10'),
    jsonb_build_object('personId', 1.5, 'region', 'Bursa', 'date', '2026-10-10'),
    jsonb_build_object('personId', pid, 'region', 'Bursa', 'date', '2026-10-10', 'extra', 1),
    jsonb_build_object('personId', pid, 'region', 'Bursa', 'date', '2026-10-10', 'note', repeat('n', 501)),
    jsonb_build_object('personId', pid, 'region', repeat('r', 81), 'date', '2026-10-10'),
    jsonb_build_object('personId', pid, 'region', '   ', 'date', '2026-10-10'),
    jsonb_build_object('personId', pid, 'region', U&'\202E\200B', 'date', '2026-10-10'),
    jsonb_build_object('personId', pid, 'region', 42, 'date', '2026-10-10'),
    jsonb_build_object('personId', pid, 'region', 'Bursa', 'date', '2026-10-10', 'status', 'iptal'),
    jsonb_build_object('personId', pid, 'date', '2026-10-10'),
    '[1,2]'::jsonb
  ] loop
    r := public.kayit_ekle(ed, bad);
    assert (r ->> 'status')::int = 400, 'reddedilmeliydi: ' || bad::text;
  end loop;
  assert (public.kayit_guncelle(ed, ids[2], '{}') ->> 'status')::int = 400, 'boş güncelleme';
  assert (public.kayit_guncelle(ed, ids[2], '{"bilinmeyen": 1}') ->> 'status')::int = 400;

  -- 500 karakterlik not kabul; kontrol ve yön karakterleri temizlenir
  r := public.kayit_ekle(ed, jsonb_build_object('personId', pid, 'region', U&'An\202Ekara\0007', 'date', '2026-10-12',
         'note', repeat('ç', 499) || U&'\200F!', 'status', 'done'));
  assert r -> 'kayit' ->> 'region' = 'Ankara', 'temizleme: ' || (r -> 'kayit' ->> 'region');
  assert char_length(r -> 'kayit' ->> 'note') = 500, 'not uzunluğu';
  ids := ids || (r -> 'kayit' ->> 'id')::bigint;

  -- İzleyici yazamaz; editör link yenileyemez
  assert (public.kayit_ekle(vw, jsonb_build_object('personId', pid, 'region', 'Konya', 'date', '2026-10-20')) ->> 'status')::int = 403;
  assert (public.kayit_guncelle(vw, ids[2], '{"status": "done"}') ->> 'status')::int = 403;
  assert (public.kayit_sil(vw, ids[2]) ->> 'status')::int = 403;
  assert (public.link_yenile(vw, pid) ->> 'status')::int = 403;
  assert (public.link_yenile(ed, pid) ->> 'status')::int = 403;

  -- Paylaşım linki yalnızca o kişiyi gösterir; iç kimlik sızmaz
  r := public.kayit_ekle(ed, jsonb_build_object('personId', pid, 'region', 'Trabzon', 'date', '2026-10-08', 'note', 'A notu'));
  ids := ids || (r -> 'kayit' ->> 'id')::bigint;
  r := public.paylasim(key_old, '2026-10');
  assert r ->> 'name' = 'Selim Kutlubay';
  assert (select array_agg(k order by k) from json_object_keys(r) k) = array['kayitlar', 'name'];
  assert (select bool_and((select array_agg(k order by k) from json_object_keys(e) k) = array['date', 'endDate', 'note', 'region', 'status'])
          from json_array_elements(r -> 'kayitlar') e), 'yalnızca region/date/note/status';
  assert not exists (select 1 from json_array_elements(r -> 'kayitlar') e where e ->> 'region' = 'Sınır'), 'başka kişinin kaydı sızmamalı';
  assert exists (select 1 from json_array_elements(r -> 'kayitlar') e where e ->> 'region' = 'Trabzon');
  assert (public.paylasim('kisa') ->> 'status')::int = 404;
  assert (public.paylasim(repeat('A', 32)) ->> 'status')::int = 404;

  -- Link yenileme: eski link anında geçersiz
  key_new := public.link_yenile(adm, pid) ->> 'shareKey';
  assert key_new ~ '^[A-Za-z0-9_-]{32}$' and key_new <> key_old;
  r := public.paylasim(key_old);
  assert (r ->> 'status')::int = 404 and r ->> 'error' = 'Bu link geçersiz ya da yenilenmiş.', 'eski link 404';
  assert public.paylasim(key_new) ->> 'name' = 'Selim Kutlubay';
  assert (public.link_yenile(adm, 999999) ->> 'status')::int = 404;

  -- Çıkış sonrası oturum geçersiz
  assert public.cikis(ed) ->> 'ok' = 'true';
  assert (public.oturum(ed) ->> 'status')::int = 401, 'çıkıştan sonra 401';
  assert (public.kayitlar_listele(ed) ->> 'status')::int = 401;

  -- Yeni girişte eski oturum kapanır
  r := public.giris('izleyici', 'izleyici-parola-12', vw);
  assert (public.oturum(vw) ->> 'status')::int = 401, 'eski oturum kapanmalı';
  assert public.oturum(r ->> 'token') -> 'user' ->> 'role' = 'viewer';

  -- Kaba kuvvet: 8 hatalı denemeden sonra 429, doğru parola da reddedilir
  for i in 1..8 loop
    assert (public.giris('editor', 'yanlis-' || i || '-parola') ->> 'status')::int = 401, 'deneme ' || i;
  end loop;
  r := public.giris('editor', 'editor-parola-1234');
  assert (r ->> 'status')::int = 429 and (r ->> 'retryAfter')::int > 0, 'kilit';
  assert (public.giris('Editor', 'editor-parola-1234') ->> 'status')::int = 429, 'harf farkı kilidi atlatamaz';
  assert public.giris('yonetici', 'yonetici-parola-123') ->> 'token' is not null, 'başka kullanıcı etkilenmez';
end $$;

-- Türkçe harfli kullanıcı adı: "Kürşat", "KÜRŞAT", "kursat" aynı hesap
reset role;
insert into seyahat.users (username, password_hash, role)
values ('kursat', extensions.crypt('turkce-parola-123', extensions.gen_salt('bf', 12)), 'admin');
set role anon;
do $$
begin
  assert public.giris('Kürşat', 'turkce-parola-123') ->> 'token' is not null, 'Kürşat';
  assert public.giris('KÜRŞAT', 'turkce-parola-123') ->> 'token' is not null, 'KÜRŞAT';
  assert public.giris(' kursat ', 'turkce-parola-123') ->> 'token' is not null, 'kursat';
  assert public.giris('SELİM', 'x') ->> 'error' = 'Kullanıcı adı veya parola hatalı.';
end $$;

-- Başarılı giriş kullanıcı sayacını sıfırlar
do $$
declare
  i int;
begin
  for i in 1..7 loop perform public.giris('izleyici', 'yanlis-parola-xx'); end loop;
  assert public.giris('izleyici', 'izleyici-parola-12') ->> 'token' is not null;
  for i in 1..7 loop perform public.giris('izleyici', 'yanlis-parola-xx'); end loop;
  assert public.giris('izleyici', 'izleyici-parola-12') ->> 'token' is not null, 'sayaç sıfırlanmalıydı';
end $$;

-- Aynı IP'den 30 hatalı denemeden sonra 429 (yeni IP ile)
select set_config('request.headers', '{"cf-connecting-ip": "198.51.100.9"}', false);
do $$
declare
  i int;
  r json;
begin
  for i in 1..30 loop
    assert (public.giris('yok-' || i, 'yanlis-parola-xx') ->> 'status')::int = 401, 'ip deneme ' || i;
  end loop;
  r := public.giris('yonetici', 'yonetici-parola-123');
  assert (r ->> 'status')::int = 429, 'ip kilidi';
end $$;

-- Paylaşım ucunda dakikada 30 sınırı (yeni IP ile)
select set_config('request.headers', '{"cf-connecting-ip": "192.0.2.44"}', false);
do $$
declare
  i int;
begin
  for i in 1..30 loop
    assert (public.paylasim(repeat('B', 32)) ->> 'status')::int = 404;
  end loop;
  assert (public.paylasim(repeat('B', 32)) ->> 'status')::int = 429, 'paylaşım sınırı';
end $$;

reset role;

-- Denetim kaydı ve saklama biçimi
do $$
begin
  assert (select count(*) from seyahat.audit where action = 'giris_basarisiz') >= 40, 'başarısız girişler kaydedilmeli';
  assert exists (select 1 from seyahat.audit where action = 'giris' and username = 'editor' and ip = '203.0.113.7');
  assert exists (select 1 from seyahat.audit where action = 'cikis');
  assert exists (select 1 from seyahat.audit where action = 'kayit_ekle');
  assert exists (select 1 from seyahat.audit where action = 'kayit_guncelle');
  assert exists (select 1 from seyahat.audit where action = 'kayit_sil');
  assert exists (select 1 from seyahat.trips where deleted_at is not null), 'silinen kayıt işaretli kalmalı';
  assert exists (select 1 from seyahat.audit where action = 'link_yenile');
  assert (select bool_and(token_hash ~ '^[0-9a-f]{64}$') from seyahat.sessions), 'oturumlar yalnızca SHA-256 özeti';
  assert (select bool_and(password_hash like '$2a$12$%') from seyahat.users), 'parolalar bcrypt (maliyet 12)';
end $$;

-- Kullanıcı güncellenince oturumları kapanır
do $$
begin
  perform seyahat.kullanici_ekle('yonetici', 'yepyeni-parola-9876', 'editor');
  assert not exists (select 1 from seyahat.sessions s join seyahat.users u on u.id = s.user_id
                    where u.username = 'yonetici' and s.expires_at > now());
  assert (select role from seyahat.users where username = 'yonetici') = 'editor';
end $$;

\o
\echo 'Supabase API testleri: tümü geçti'
