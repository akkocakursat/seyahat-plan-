-- Seyahat Defteri — Supabase kurulumu
--
-- Supabase panelinde: SQL Editor → New query → bu dosyanın tamamını yapıştırın → Run.
-- Dosya tekrar çalıştırılabilir; var olan tablolara ve verilere dokunmaz, fonksiyonları günceller.
--
-- Ardından yönetici hesabını oluşturun (parolayı kendiniz belirleyin, en az 12 karakter):
--   select seyahat.kullanici_ekle('yonetici', 'BURAYA-GUCLU-BIR-PAROLA', 'admin');
-- Diğer roller: 'editor' (Düzenleyici), 'viewer' (Görüntüleyici). Aynı adla tekrar çalıştırmak
-- parolayı ve rolü günceller, açık oturumları kapatır. Yeni kişi: select seyahat.kisi_ekle('Ad Soyad');

--
-- Tablolar API'ye açık olmayan "seyahat" şemasındadır; anon/authenticated rolleri bu şemaya hiç erişemez.
-- Tarayıcı yalnızca public şemadaki SECURITY DEFINER fonksiyonlarını (RPC) çağırabilir. Her fonksiyon
-- oturumu, rolü, girdileri ve istek sınırlarını kendisi denetler; tüm sorgular parametrelidir.

create schema if not exists seyahat;
revoke all on schema seyahat from public;
revoke all on schema seyahat from anon, authenticated;

-- ---------------------------------------------------------------- Tablolar

create table if not exists seyahat.people (
  id         bigint generated always as identity primary key,
  name       text not null unique check (char_length(name) between 1 and 80),
  share_key  text not null unique check (share_key ~ '^[A-Za-z0-9_-]{32}$'),
  created_at timestamptz not null default now()
);

create table if not exists seyahat.users (
  id            bigint generated always as identity primary key,
  username      text not null check (username ~ '^[A-Za-z0-9._-]{3,40}$'),
  password_hash text not null,
  role          text not null check (role in ('admin', 'editor', 'viewer')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists users_username_lower on seyahat.users (lower(username));

create table if not exists seyahat.sessions (
  token_hash text primary key,                -- oturum anahtarının yalnızca SHA-256 özeti
  user_id    bigint not null references seyahat.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists sessions_user on seyahat.sessions (user_id);
create index if not exists sessions_expires on seyahat.sessions (expires_at);

create table if not exists seyahat.trips (
  id         bigint generated always as identity primary key,
  person_id  bigint not null references seyahat.people(id) on delete restrict,
  region     text not null check (char_length(region) between 1 and 80),
  date       date not null check (date between date '2000-01-01' and date '2100-12-31'),
  note       text not null default '' check (char_length(note) <= 500),
  status     text not null check (status in ('planned', 'done')),
  created_by bigint references seyahat.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Silinen kayıtlar yalnızca işaretlenir (geri alınabilir, denetim izi korunur); hiçbir sorguda görünmez.
alter table seyahat.trips add column if not exists deleted_at timestamptz;
create index if not exists trips_date on seyahat.trips (date);
create index if not exists trips_person on seyahat.trips (person_id, date);
create index if not exists trips_created_by on seyahat.trips (created_by);

create table if not exists seyahat.audit (
  id       bigint generated always as identity primary key,
  at       timestamptz not null default now(),
  user_id  bigint,
  username text,
  action   text not null,
  detail   jsonb,
  ip       text
);
create index if not exists audit_at on seyahat.audit (at);

create table if not exists seyahat.rate_counters (
  key      text primary key,
  count    integer not null,
  reset_at timestamptz not null
);

create table if not exists seyahat.settings (
  id         boolean primary key default true check (id),
  dummy_hash text not null                    -- kullanıcı yokken de aynı maliyette doğrulama için
);

-- Savunma derinliği: şema zaten kapalı, ayrıca RLS açık ve hiçbir politika yok.
alter table seyahat.people        enable row level security;
alter table seyahat.users         enable row level security;
alter table seyahat.sessions      enable row level security;
alter table seyahat.trips         enable row level security;
alter table seyahat.audit         enable row level security;
alter table seyahat.rate_counters enable row level security;
alter table seyahat.settings      enable row level security;
revoke all on all tables in schema seyahat from public, anon, authenticated;
revoke all on all sequences in schema seyahat from public, anon, authenticated;

-- ---------------------------------------------------------------- Yardımcılar

create or replace function seyahat.random_token(p_bytes integer) returns text
language sql volatile set search_path = '' as $$
  select translate(rtrim(encode(extensions.gen_random_bytes(p_bytes), 'base64'), '='), '+/', '-_')
$$;

create or replace function seyahat.sha256_hex(p text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(p, 'sha256'), 'hex')
$$;

create or replace function seyahat.err(p_status integer, p_message text, p_retry integer default null) returns json
language sql immutable set search_path = '' as $$
  select json_build_object('error', p_message, 'status', p_status, 'retryAfter', p_retry)
$$;

create or replace function seyahat.client_ip() returns text
language plpgsql stable set search_path = '' as $$
declare
  h json;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    h := null;
  end;
  return left(coalesce(
    nullif(h ->> 'cf-connecting-ip', ''),
    nullif(btrim(split_part(h ->> 'x-forwarded-for', ',', 1)), ''),
    nullif(h ->> 'x-real-ip', ''),
    'bilinmiyor'), 64);
end $$;

-- Sabit pencereli sayaç. Satır kilidi eşzamanlı istekleri sıraya sokar; dönen değer güncel sayıdır.
create or replace function seyahat.rl_hit(p_key text, p_window interval) returns integer
language sql volatile set search_path = '' as $$
  insert into seyahat.rate_counters as c (key, count, reset_at)
  values (p_key, 1, now() + p_window)
  on conflict (key) do update set
    count    = case when c.reset_at <= now() then 1 else c.count + 1 end,
    reset_at = case when c.reset_at <= now() then now() + p_window else c.reset_at end
  returning count
$$;

create or replace function seyahat.rl_retry(p_key text) returns integer
language sql stable set search_path = '' as $$
  select coalesce((select greatest(1, ceil(extract(epoch from reset_at - now()))::integer)
                   from seyahat.rate_counters where key = p_key), 1)
$$;

create or replace function seyahat.rl_undo(p_key text) returns void
language sql volatile set search_path = '' as $$
  update seyahat.rate_counters set count = greatest(0, count - 1) where key = p_key
$$;

-- Genel istek sınırı (IP başına dakikada 300). Sınır aşıldıysa kalan saniye, değilse 0.
create or replace function seyahat.general_limit() returns integer
language plpgsql volatile set search_path = '' as $$
declare
  k text := 'genel:' || seyahat.client_ip();
begin
  if seyahat.rl_hit(k, interval '1 minute') > 300 then
    return seyahat.rl_retry(k);
  end if;
  return 0;
end $$;

-- Metinden kontrol ve görünmez yön karakterlerini temizler.
create or replace function seyahat.clean(p text, p_multiline boolean) returns text
language plpgsql immutable set search_path = '' as $$
declare
  s text := normalize(p, nfc);
begin
  s := replace(replace(s, E'\r\n', E'\n'), E'\r', E'\n');
  s := regexp_replace(s, '[؜​-‏‪-‮⁠-⁤⁦-⁩﻿]', '', 'g');
  if p_multiline then
    s := replace(s, E'\t', ' ');
  else
    s := regexp_replace(s, '[\n\t]', ' ', 'g');
  end if;
  s := regexp_replace(s, '[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]', '', 'g');
  return regexp_replace(s, '^\s+|\s+$', '', 'g');
end $$;

create or replace function seyahat.parse_date(p text) returns date
language plpgsql immutable set search_path = '' as $$
declare
  d date;
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;
  begin
    d := p::date;
  exception when others then
    return null;
  end;
  if to_char(d, 'YYYY-MM-DD') <> p or d < date '2000-01-01' or d > date '2100-12-31' then
    return null;
  end if;
  return d;
end $$;

-- "2026-10" -> [2026-10-01, 2026-10-31]; geçersizse null.
create or replace function seyahat.parse_month(p text, out d_from date, out d_to date)
language plpgsql immutable set search_path = '' as $$
declare
  y integer;
  m integer;
begin
  if p is null or p !~ '^\d{4}-\d{2}$' then
    return;
  end if;
  y := split_part(p, '-', 1)::integer;
  m := split_part(p, '-', 2)::integer;
  if y < 2000 or y > 2100 or m < 1 or m > 12 then
    return;
  end if;
  d_from := make_date(y, m, 1);
  d_to := (d_from + interval '1 month' - interval '1 day')::date;
end $$;

-- Kayıt girdisini doğrular. Hata varsa {"error": "..."} döner; yoksa normalleştirilmiş alanlar.
create or replace function seyahat.validate_trip(p jsonb, p_partial boolean) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  v_out jsonb := '{}'::jsonb;
  v_unknown text;
  v_txt text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return jsonb_build_object('error', 'Geçersiz istek gövdesi.');
  end if;
  select string_agg(k, ', ') into v_unknown
  from jsonb_object_keys(p) as k
  where k not in ('personId', 'region', 'date', 'note', 'status');
  if v_unknown is not null then
    return jsonb_build_object('error', left('Bilinmeyen alan: ' || v_unknown, 80));
  end if;
  if p_partial and p = '{}'::jsonb then
    return jsonb_build_object('error', 'Güncellenecek alan yok.');
  end if;
  if not p_partial then
    if not (p ? 'personId') then return jsonb_build_object('error', 'Eksik alan: personId'); end if;
    if not (p ? 'region') then return jsonb_build_object('error', 'Eksik alan: region'); end if;
    if not (p ? 'date') then return jsonb_build_object('error', 'Eksik alan: date'); end if;
  end if;

  if p ? 'personId' then
    v_txt := case jsonb_typeof(p -> 'personId')
               when 'number' then (p -> 'personId')::text
               when 'string' then p ->> 'personId'
             end;
    if v_txt is null or v_txt !~ '^[1-9][0-9]{0,15}$' then
      return jsonb_build_object('error', 'Kişi seçilmelidir.');
    end if;
    v_out := v_out || jsonb_build_object('personId', v_txt::bigint);
  end if;

  if p ? 'region' then
    if jsonb_typeof(p -> 'region') <> 'string' then
      return jsonb_build_object('error', 'Bölge metin olmalıdır.');
    end if;
    v_txt := seyahat.clean(p ->> 'region', false);
    if v_txt = '' then return jsonb_build_object('error', 'Bölge boş olamaz.'); end if;
    if char_length(v_txt) > 80 then return jsonb_build_object('error', 'Bölge en fazla 80 karakter olabilir.'); end if;
    v_out := v_out || jsonb_build_object('region', v_txt);
  end if;

  if p ? 'date' then
    if jsonb_typeof(p -> 'date') <> 'string' or seyahat.parse_date(p ->> 'date') is null then
      return jsonb_build_object('error', 'Tarih geçerli bir YYYY-AA-GG tarihi olmalıdır (2000–2100).');
    end if;
    v_out := v_out || jsonb_build_object('date', p ->> 'date');
  end if;

  if p ? 'note' then
    if jsonb_typeof(p -> 'note') = 'null' then
      v_txt := '';
    elsif jsonb_typeof(p -> 'note') <> 'string' then
      return jsonb_build_object('error', 'Not metin olmalıdır.');
    else
      v_txt := seyahat.clean(p ->> 'note', true);
    end if;
    if char_length(v_txt) > 500 then return jsonb_build_object('error', 'Not en fazla 500 karakter olabilir.'); end if;
    v_out := v_out || jsonb_build_object('note', v_txt);
  elsif not p_partial then
    v_out := v_out || jsonb_build_object('note', '');
  end if;

  if p ? 'status' then
    if jsonb_typeof(p -> 'status') <> 'string' or (p ->> 'status') not in ('planned', 'done') then
      return jsonb_build_object('error', 'Durum "planned" ya da "done" olmalıdır.');
    end if;
    v_out := v_out || jsonb_build_object('status', p ->> 'status');
  elsif not p_partial then
    v_out := v_out || jsonb_build_object('status', 'planned');
  end if;

  return v_out;
end $$;

create or replace function seyahat.trip_json(t seyahat.trips) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', t.id, 'personId', t.person_id, 'region', t.region,
                            'date', to_char(t.date, 'YYYY-MM-DD'), 'note', t.note, 'status', t.status)
$$;

create or replace function seyahat.audit_log(p_user seyahat.users, p_action text, p_detail jsonb default null) returns void
language sql volatile set search_path = '' as $$
  insert into seyahat.audit (user_id, username, action, detail, ip)
  values (p_user.id, p_user.username, p_action, p_detail, seyahat.client_ip())
$$;

-- Oturum anahtarını doğrular; geçerliyse süreyi kaydırarak uzatır (8 saat). Geçersizse id'si null kayıt.
create or replace function seyahat.auth(p_token text) returns seyahat.users
language plpgsql volatile set search_path = '' as $$
declare
  v seyahat.users;
  h text;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return v;
  end if;
  h := seyahat.sha256_hex(p_token);
  update seyahat.sessions set expires_at = now() + interval '8 hours'
  where token_hash = h and expires_at > now() and expires_at < now() + interval '8 hours' - interval '1 minute';
  select u.* into v
  from seyahat.sessions s join seyahat.users u on u.id = s.user_id
  where s.token_hash = h and s.expires_at > now();
  return v;
end $$;

-- ---------------------------------------------------------------- Yönetim (yalnızca SQL düzenleyiciden)

-- select seyahat.kullanici_ekle('yonetici', 'en-az-12-karakterlik-parola', 'admin');
-- Aynı kullanıcı adıyla tekrar çalıştırılırsa parola ve rol güncellenir, açık oturumlar kapanır.
create or replace function seyahat.kullanici_ekle(p_username text, p_password text, p_role text) returns text
language plpgsql volatile set search_path = '' as $$
declare
  v_id bigint;
begin
  if p_username is null or p_username !~ '^[A-Za-z0-9._-]{3,40}$' then
    raise exception 'Kullanıcı adı 3-40 karakter olmalı; yalnızca harf, rakam, nokta, alt çizgi ve tire.';
  end if;
  if p_role is null or p_role not in ('admin', 'editor', 'viewer') then
    raise exception 'Rol admin, editor ya da viewer olmalıdır.';
  end if;
  if p_password is null or char_length(p_password) < 12 then
    raise exception 'Parola en az 12 karakter olmalıdır.';
  end if;
  select id into v_id from seyahat.users where lower(username) = lower(p_username);
  if v_id is null then
    insert into seyahat.users (username, password_hash, role)
    values (p_username, extensions.crypt(p_password, extensions.gen_salt('bf', 12)), p_role);
    return format('"%s" kullanıcısı %s rolüyle oluşturuldu.', p_username, p_role);
  end if;
  update seyahat.users
  set password_hash = extensions.crypt(p_password, extensions.gen_salt('bf', 12)), role = p_role, updated_at = now()
  where id = v_id;
  update seyahat.sessions set expires_at = now() where user_id = v_id and expires_at > now();
  return format('"%s" kullanıcısının parolası ve rolü (%s) güncellendi; açık oturumları kapatıldı.', p_username, p_role);
end $$;

-- select seyahat.kisi_ekle('Ad Soyad');
create or replace function seyahat.kisi_ekle(p_name text) returns text
language plpgsql volatile set search_path = '' as $$
declare
  v_name text := seyahat.clean(coalesce(p_name, ''), false);
begin
  if v_name = '' or char_length(v_name) > 80 then
    raise exception 'Ad 1-80 karakter olmalıdır.';
  end if;
  insert into seyahat.people (name, share_key) values (v_name, seyahat.random_token(24));
  return format('"%s" eklendi.', v_name);
end $$;


-- ---------------------------------------------------------------- API (RPC)

create or replace function public.giris(p_username text, p_password text, p_old_token text default null) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_ip text := seyahat.client_ip();
  v_key text;
  v_user seyahat.users;
  v_hash text;
  v_token text;
  v_retry integer := seyahat.general_limit();
begin
  if v_retry > 0 then
    return seyahat.err(429, 'Çok fazla istek. Lütfen biraz sonra tekrar deneyin.', v_retry);
  end if;
  if p_username is null or p_password is null or char_length(p_username) > 100 or char_length(p_password) > 1024 then
    return seyahat.err(401, 'Kullanıcı adı veya parola hatalı.');
  end if;
  v_key := lower(btrim(p_username));

  -- Deneme doğrulamadan önce sayılır (satır kilidi paralel denemeleri sıraya sokar);
  -- başarılı girişte sayım geri alınır, yani yalnızca hatalı denemeler kalıcıdır.
  if seyahat.rl_hit('giris-ip:' || v_ip, interval '15 minutes') > 30 then
    return seyahat.err(429, 'Çok fazla hatalı deneme. Lütfen daha sonra tekrar deneyin.', seyahat.rl_retry('giris-ip:' || v_ip));
  end if;
  if seyahat.rl_hit('giris-k:' || v_key, interval '15 minutes') > 8 then
    perform seyahat.rl_undo('giris-ip:' || v_ip);
    return seyahat.err(429, 'Çok fazla hatalı deneme. Lütfen daha sonra tekrar deneyin.', seyahat.rl_retry('giris-k:' || v_key));
  end if;

  select * into v_user from seyahat.users where lower(username) = v_key;
  -- Kullanıcı yoksa da aynı maliyette bir doğrulama yapılır.
  v_hash := coalesce(v_user.password_hash, (select dummy_hash from seyahat.settings));
  if extensions.crypt(p_password, v_hash) <> v_hash or v_user.id is null then
    insert into seyahat.audit (username, action, ip) values (left(v_key, 40), 'giris_basarisiz', v_ip);
    return seyahat.err(401, 'Kullanıcı adı veya parola hatalı.');
  end if;

  update seyahat.rate_counters set count = 0 where key = 'giris-k:' || v_key;
  perform seyahat.rl_undo('giris-ip:' || v_ip);
  if p_old_token is not null then
    update seyahat.sessions set expires_at = now()
    where token_hash = seyahat.sha256_hex(p_old_token) and expires_at > now();
  end if;

  -- Her girişte yeni oturum; veritabanında yalnızca özeti saklanır.
  v_token := seyahat.random_token(32);
  insert into seyahat.sessions (token_hash, user_id, expires_at)
  values (seyahat.sha256_hex(v_token), v_user.id, now() + interval '8 hours');
  perform seyahat.audit_log(v_user, 'giris');
  return json_build_object('token', v_token, 'user', json_build_object('username', v_user.username, 'role', v_user.role));
end $$;

create or replace function public.oturum(p_token text) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user seyahat.users;
  v_retry integer := seyahat.general_limit();
begin
  if v_retry > 0 then return seyahat.err(429, 'Çok fazla istek. Lütfen biraz sonra tekrar deneyin.', v_retry); end if;
  v_user := seyahat.auth(p_token);
  if v_user.id is null then return seyahat.err(401, 'Oturum gerekli.'); end if;
  return json_build_object('user', json_build_object('username', v_user.username, 'role', v_user.role));
end $$;

create or replace function public.cikis(p_token text) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user seyahat.users;
begin
  v_user := seyahat.auth(p_token);
  if v_user.id is null then return seyahat.err(401, 'Oturum gerekli.'); end if;
  -- Oturum hemen sona erdirilir (süresi şimdiye çekilir).
  update seyahat.sessions set expires_at = now() where token_hash = seyahat.sha256_hex(p_token);
  perform seyahat.audit_log(v_user, 'cikis');
  return json_build_object('ok', true);
end $$;

create or replace function public.kayitlar_listele(p_token text, p_ay text default null) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user seyahat.users;
  v_from date;
  v_to date;
  v_retry integer := seyahat.general_limit();
begin
  if v_retry > 0 then return seyahat.err(429, 'Çok fazla istek. Lütfen biraz sonra tekrar deneyin.', v_retry); end if;
  v_user := seyahat.auth(p_token);
  if v_user.id is null then return seyahat.err(401, 'Oturum gerekli.'); end if;
  if p_ay is not null then
    select d_from, d_to into v_from, v_to from seyahat.parse_month(p_ay);
    if v_from is null then return seyahat.err(400, 'Ay YYYY-AA biçiminde olmalıdır (2000–2100).'); end if;
  end if;
  return json_build_object('kayitlar', coalesce((
    select json_agg(seyahat.trip_json(t) order by t.date, t.id)
    from seyahat.trips t
    where t.deleted_at is null and (v_from is null or t.date between v_from and v_to)), '[]'::json));
end $$;

create or replace function public.kayit_ekle(p_token text, p_kayit jsonb) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user seyahat.users;
  v jsonb;
  v_trip seyahat.trips;
  v_retry integer := seyahat.general_limit();
begin
  if v_retry > 0 then return seyahat.err(429, 'Çok fazla istek. Lütfen biraz sonra tekrar deneyin.', v_retry); end if;
  v_user := seyahat.auth(p_token);
  if v_user.id is null then return seyahat.err(401, 'Oturum gerekli.'); end if;
  if v_user.role not in ('admin', 'editor') then return seyahat.err(403, 'Bu işlem için yetkiniz yok.'); end if;
  v := seyahat.validate_trip(p_kayit, false);
  if v ? 'error' then return seyahat.err(400, v ->> 'error'); end if;
  if not exists (select 1 from seyahat.people where id = (v ->> 'personId')::bigint) then
    return seyahat.err(400, 'Kişi bulunamadı.');
  end if;
  insert into seyahat.trips (person_id, region, date, note, status, created_by)
  values ((v ->> 'personId')::bigint, v ->> 'region', (v ->> 'date')::date, v ->> 'note', v ->> 'status', v_user.id)
  returning * into v_trip;
  perform seyahat.audit_log(v_user, 'kayit_ekle', seyahat.trip_json(v_trip));
  return json_build_object('kayit', seyahat.trip_json(v_trip));
end $$;

create or replace function public.kayit_guncelle(p_token text, p_id bigint, p_degisiklik jsonb) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user seyahat.users;
  v jsonb;
  v_before seyahat.trips;
  v_after seyahat.trips;
  v_retry integer := seyahat.general_limit();
begin
  if v_retry > 0 then return seyahat.err(429, 'Çok fazla istek. Lütfen biraz sonra tekrar deneyin.', v_retry); end if;
  v_user := seyahat.auth(p_token);
  if v_user.id is null then return seyahat.err(401, 'Oturum gerekli.'); end if;
  if v_user.role not in ('admin', 'editor') then return seyahat.err(403, 'Bu işlem için yetkiniz yok.'); end if;
  select * into v_before from seyahat.trips where id = p_id and deleted_at is null for update;
  if v_before.id is null then return seyahat.err(404, 'Kayıt bulunamadı.'); end if;
  v := seyahat.validate_trip(p_degisiklik, true);
  if v ? 'error' then return seyahat.err(400, v ->> 'error'); end if;
  if v ? 'personId' and not exists (select 1 from seyahat.people where id = (v ->> 'personId')::bigint) then
    return seyahat.err(400, 'Kişi bulunamadı.');
  end if;
  update seyahat.trips set
    person_id  = coalesce((v ->> 'personId')::bigint, person_id),
    region     = coalesce(v ->> 'region', region),
    date       = coalesce((v ->> 'date')::date, date),
    note       = coalesce(v ->> 'note', note),
    status     = coalesce(v ->> 'status', status),
    updated_at = now()
  where id = p_id
  returning * into v_after;
  perform seyahat.audit_log(v_user, 'kayit_guncelle',
    jsonb_build_object('id', p_id, 'once', seyahat.trip_json(v_before), 'sonra', seyahat.trip_json(v_after)));
  return json_build_object('kayit', seyahat.trip_json(v_after));
end $$;

create or replace function public.kayit_sil(p_token text, p_id bigint) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user seyahat.users;
  v_before seyahat.trips;
  v_retry integer := seyahat.general_limit();
begin
  if v_retry > 0 then return seyahat.err(429, 'Çok fazla istek. Lütfen biraz sonra tekrar deneyin.', v_retry); end if;
  v_user := seyahat.auth(p_token);
  if v_user.id is null then return seyahat.err(401, 'Oturum gerekli.'); end if;
  if v_user.role not in ('admin', 'editor') then return seyahat.err(403, 'Bu işlem için yetkiniz yok.'); end if;
  update seyahat.trips set deleted_at = now(), updated_at = now()
  where id = p_id and deleted_at is null
  returning * into v_before;
  if v_before.id is null then return seyahat.err(404, 'Kayıt bulunamadı.'); end if;
  perform seyahat.audit_log(v_user, 'kayit_sil', seyahat.trip_json(v_before));
  return json_build_object('ok', true);
end $$;

create or replace function public.kisiler_listele(p_token text, p_ay text default null) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user seyahat.users;
  v_from date;
  v_to date;
  v_keys boolean;
  v_retry integer := seyahat.general_limit();
begin
  if v_retry > 0 then return seyahat.err(429, 'Çok fazla istek. Lütfen biraz sonra tekrar deneyin.', v_retry); end if;
  v_user := seyahat.auth(p_token);
  if v_user.id is null then return seyahat.err(401, 'Oturum gerekli.'); end if;
  if p_ay is not null then
    select d_from, d_to into v_from, v_to from seyahat.parse_month(p_ay);
    if v_from is null then return seyahat.err(400, 'Ay YYYY-AA biçiminde olmalıdır (2000–2100).'); end if;
  end if;
  -- Görüntüleyici paylaşım anahtarlarını göremez.
  v_keys := v_user.role in ('admin', 'editor');
  return json_build_object('kisiler', coalesce((
    select json_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'id', p.id, 'name', p.name,
        'planned', (select count(*) from seyahat.trips t where t.person_id = p.id and t.status = 'planned' and t.deleted_at is null
                      and (v_from is null or t.date between v_from and v_to)),
        'done', (select count(*) from seyahat.trips t where t.person_id = p.id and t.status = 'done' and t.deleted_at is null
                   and (v_from is null or t.date between v_from and v_to)),
        'shareKey', case when v_keys then p.share_key end))
      order by p.id)
    from seyahat.people p), '[]'::json));
end $$;

create or replace function public.link_yenile(p_token text, p_kisi_id bigint) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user seyahat.users;
  v_name text;
  v_key text := seyahat.random_token(24);
  v_retry integer := seyahat.general_limit();
begin
  if v_retry > 0 then return seyahat.err(429, 'Çok fazla istek. Lütfen biraz sonra tekrar deneyin.', v_retry); end if;
  v_user := seyahat.auth(p_token);
  if v_user.id is null then return seyahat.err(401, 'Oturum gerekli.'); end if;
  if v_user.role <> 'admin' then return seyahat.err(403, 'Bu işlem için yetkiniz yok.'); end if;
  update seyahat.people set share_key = v_key where id = p_kisi_id returning name into v_name;
  if v_name is null then return seyahat.err(404, 'Kişi bulunamadı.'); end if;
  perform seyahat.audit_log(v_user, 'link_yenile', jsonb_build_object('kisiId', p_kisi_id, 'ad', v_name));
  return json_build_object('shareKey', v_key);
end $$;

-- Giriş gerektirmez. Yalnızca kişi adı ve kayıtların region/date/note/status alanları döner.
create or replace function public.paylasim(p_anahtar text, p_ay text default null) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_ip text := seyahat.client_ip();
  v_person seyahat.people;
  v_from date;
  v_to date;
  v_retry integer := seyahat.general_limit();
begin
  if v_retry > 0 then return seyahat.err(429, 'Çok fazla istek. Lütfen biraz sonra tekrar deneyin.', v_retry); end if;
  if seyahat.rl_hit('paylasim:' || v_ip, interval '1 minute') > 30 then
    return seyahat.err(429, 'Çok fazla istek. Lütfen biraz sonra tekrar deneyin.', seyahat.rl_retry('paylasim:' || v_ip));
  end if;
  if p_anahtar is null or p_anahtar !~ '^[A-Za-z0-9_-]{32}$' then
    return seyahat.err(404, 'Bu link geçersiz ya da yenilenmiş.');
  end if;
  select * into v_person from seyahat.people where share_key = p_anahtar;
  if v_person.id is null then return seyahat.err(404, 'Bu link geçersiz ya da yenilenmiş.'); end if;
  if p_ay is not null then
    select d_from, d_to into v_from, v_to from seyahat.parse_month(p_ay);
    if v_from is null then return seyahat.err(400, 'Ay YYYY-AA biçiminde olmalıdır (2000–2100).'); end if;
  end if;
  return json_build_object('name', v_person.name, 'kayitlar', coalesce((
    select json_agg(json_build_object('region', t.region, 'date', to_char(t.date, 'YYYY-MM-DD'),
                                      'note', t.note, 'status', t.status) order by t.date, t.id)
    from seyahat.trips t
    where t.person_id = v_person.id and t.deleted_at is null and (v_from is null or t.date between v_from and v_to)), '[]'::json));
end $$;

-- ---------------------------------------------------------------- Yetkiler

revoke execute on all functions in schema seyahat from public, anon, authenticated;

revoke execute on function public.giris(text, text, text) from public;
revoke execute on function public.oturum(text) from public;
revoke execute on function public.cikis(text) from public;
revoke execute on function public.kayitlar_listele(text, text) from public;
revoke execute on function public.kayit_ekle(text, jsonb) from public;
revoke execute on function public.kayit_guncelle(text, bigint, jsonb) from public;
revoke execute on function public.kayit_sil(text, bigint) from public;
revoke execute on function public.kisiler_listele(text, text) from public;
revoke execute on function public.link_yenile(text, bigint) from public;
revoke execute on function public.paylasim(text, text) from public;

-- Supabase Auth kullanılmadığı için yalnızca anon rolü çağırabilir.
revoke execute on all functions in schema public from authenticated;

grant execute on function public.giris(text, text, text) to anon;
grant execute on function public.oturum(text) to anon;
grant execute on function public.cikis(text) to anon;
grant execute on function public.kayitlar_listele(text, text) to anon;
grant execute on function public.kayit_ekle(text, jsonb) to anon;
grant execute on function public.kayit_guncelle(text, bigint, jsonb) to anon;
grant execute on function public.kayit_sil(text, bigint) to anon;
grant execute on function public.kisiler_listele(text, text) to anon;
grant execute on function public.link_yenile(text, bigint) to anon;
grant execute on function public.paylasim(text, text) to anon;


-- ---------------------------------------------------------------- İlk veriler

insert into seyahat.settings (dummy_hash)
values (extensions.crypt(seyahat.random_token(32), extensions.gen_salt('bf', 12)))
on conflict (id) do nothing;

insert into seyahat.people (name, share_key) values
  ('Selim Kutlubay',      seyahat.random_token(24)),
  ('Yusuf Özoğlu',        seyahat.random_token(24)),
  ('Selahattin Çomuoğlu', seyahat.random_token(24)),
  ('Kürşat Akkoca',       seyahat.random_token(24))
on conflict (name) do nothing;
