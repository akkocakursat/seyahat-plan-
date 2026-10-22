-- Seyahat Defteri — Supabase son adım
-- Supabase panelinde: SQL Editor → New query → bu dosyanın tamamını yapıştırın → Run.
-- (Geri kalan her şey zaten kurulu. Bu dosya kurulum.sql'in bir parçasıdır; tekrar çalıştırılabilir.)

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
  delete from seyahat.sessions where user_id = v_id;
  return format('"%s" kullanıcısının parolası ve rolü (%s) güncellendi; açık oturumları kapatıldı.', p_username, p_role);
end $$;

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

  delete from seyahat.rate_counters where key = 'giris-k:' || v_key;
  perform seyahat.rl_undo('giris-ip:' || v_ip);
  delete from seyahat.sessions where expires_at <= now();
  delete from seyahat.rate_counters where reset_at <= now() - interval '1 hour';
  if p_old_token is not null then
    delete from seyahat.sessions where token_hash = seyahat.sha256_hex(p_old_token);
  end if;

  -- Her girişte yeni oturum; veritabanında yalnızca özeti saklanır.
  v_token := seyahat.random_token(32);
  insert into seyahat.sessions (token_hash, user_id, expires_at)
  values (seyahat.sha256_hex(v_token), v_user.id, now() + interval '8 hours');
  perform seyahat.audit_log(v_user, 'giris');
  return json_build_object('token', v_token, 'user', json_build_object('username', v_user.username, 'role', v_user.role));
end $$;

create or replace function public.cikis(p_token text) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user seyahat.users;
begin
  v_user := seyahat.auth(p_token);
  if v_user.id is null then return seyahat.err(401, 'Oturum gerekli.'); end if;
  delete from seyahat.sessions where token_hash = seyahat.sha256_hex(p_token);
  perform seyahat.audit_log(v_user, 'cikis');
  return json_build_object('ok', true);
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
  delete from seyahat.trips where id = p_id returning * into v_before;
  if v_before.id is null then return seyahat.err(404, 'Kayıt bulunamadı.'); end if;
  perform seyahat.audit_log(v_user, 'kayit_sil', seyahat.trip_json(v_before));
  return json_build_object('ok', true);
end $$;

revoke execute on function seyahat.kullanici_ekle(text, text, text) from public, anon, authenticated;
revoke execute on function public.giris(text, text, text) from public;
revoke execute on function public.cikis(text) from public;
revoke execute on function public.kayit_sil(text, bigint) from public;
grant execute on function public.giris(text, text, text) to anon, authenticated;
grant execute on function public.cikis(text) to anon, authenticated;
grant execute on function public.kayit_sil(text, bigint) to anon, authenticated;

-- Son olarak yönetici hesabınızı oluşturun: aşağıdaki satırda parolayı değiştirip (en az 12 karakter)
-- başındaki iki tireyi silin ve yalnızca o satırı seçip çalıştırın.
-- select seyahat.kullanici_ekle('yonetici', 'BURAYA-GUCLU-PAROLA', 'admin');
