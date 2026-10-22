# Seyahat Defteri

Departmanın iş seyahatlerini takip eden, güvenli ve sade bir web uygulaması.
Herkes kendi seyahatlerini telefondan kolayca ekler; planlanan ve gerçekleşen seyahatler, yıllık hafta
tablosu ve kişi bazında gün özeti tek yerde görünür.

- **Node.js 22.13+** (ES modülleri), tek dış bağımlılık: **Express 4**
- Veritabanı: Node'un yerleşik `node:sqlite` modülü (WAL, foreign_keys açık) — derleme gerektirmez
- Arayüz: sade HTML + CSS + vanilla JS modülleri; satır içi script/style yok (sıkı CSP)

## Kurulum

```bash
git clone <depo-adresi> seyahat-defteri && cd seyahat-defteri
npm ci                      # yalnızca express kurulur
cp .env.example .env        # geliştirmede NODE_ENV=development, COOKIE_SECURE=false yapın
npm run kullanici-ekle -- --rol admin yonetici
npm start                   # http://127.0.0.1:3000
```

İlk çalıştırmada veritabanı (`data/seyahat.db`) oluşturulur ve şu 4 kişi otomatik tanımlanır:
Selim Kutlubay, Yusuf Özoğlu, Selahattin Çomuoğlu, Kürşat Akkoca.

### Betikler

| Komut | Açıklama |
|---|---|
| `npm start` | Sunucuyu başlatır |
| `npm run kullanici-ekle -- --rol admin\|editor\|viewer [kullanıcı_adı]` | Giriş hesabı oluşturur. Parola ekrana yazılmadan sorulur (en az 12 karakter). Aynı kullanıcı adıyla tekrar çalıştırılırsa parola ve rol güncellenir, açık oturumları kapatılır. |
| `npm run kisi-ekle -- "Ad Soyad"` | Seyahat eden yeni kişi ekler. Kişinin giriş hesabı, adının ilk kelimesiyle aynı kullanıcı adıyla açılır (ör. `kullanici-ekle -- --rol editor ayse`). |
| `npm run yedek` | `VACUUM INTO` ile `yedekler/` klasörüne tutarlı kopya alır, son 30 yedeği tutar. |
| `npm test` | `node:test` ile gerçek sunucuya karşı uçtan uca testler |

## Roller

| Rol | Yetkiler |
|---|---|
| **viewer** (Görüntüleyici) | Yalnızca görür |
| **editor** (Düzenleyici) | Kendi seyahatlerini ekler, düzenler, siler |
| **admin** (Yönetici) | Editörün yaptıkları + herkesin seyahatini düzenleyebilir |

## Kullanım

Arayüz telefon öncelikli tasarlandı: telefonda dört bölüm alttaki sekmelerde, bilgisayarda üstte durur; her
ekranda sağ altta sarı **Seyahat ekle** düğmesi vardır. Herkes kendi hesabıyla girer; kullanıcı adı kişinin
adıdır (`selim` → Selim Kutlubay, `kürşat` ya da `kursat` → Kürşat Akkoca).

- **Seyahatler:** açılışta kişinin kendi seyahatleri (**Ben**); üstteki düğmelerle **Herkes** ya da başka bir kişi
  seçilebilir. **Planlanan** sekmesinde en üstte *Tarihi geçti* listesi ve tek dokunuşla **Gerçekleşti** düğmesi
  (yanlışlıkla basılırsa bildirimdeki **Geri al**), altında haftalara göre gruplanmış yaklaşan seyahatler
  (*Bu hafta*, *Gelecek hafta*, *45. hafta*…). **Gerçekleşen** sekmesi aylara göre gruplanır. Bir seyahate
  dokununca ayrıntı paneli açılır: Gerçekleşti / Planlandıya geri al, Düzenle, Sil (panel içinde onay).
- **Seyahat ekle:** kişi sorulmaz, giriş yapan kişi adına eklenir. Türkiye'nin 81 ilinden aranarak **birden fazla
  şehir** seçilir (son gidilen şehirler hızlı seçim olarak çıkar), gidiş–dönüş tarihleri ve **1 / 2 / 3 / 5 gün**
  hızlı süreleri, durum ve isteğe bağlı not. **Başka haftalara da ekle** ile aynı seyahat seçilen haftalara
  (numaralara dokunarak ya da `1-5, 35, 37` / `1-2-3-4-5-35-37` yazarak) ayrı kayıtlar olarak eklenir.
- **Yıl:** hafta × kişi tablosu; bu hafta sarı çizgiyle işaretli, açılışta bu haftaya kayar. Kişi yalnızca kendi
  sütunundaki **+** ile o haftaya ekler; birden çok haftaya yayılan seyahat sonraki haftalarda ince çizgi olarak görünür.
- **Özet:** yıl ya da ay için toplam gün cümlesi, kişi başına gün sayısı ve kişileri karşılaştıran çubuk
  (yeşil gerçekleşen, mavi planlı), tarihi geçmiş uyarısı; tüm yıl seçiliyken kişi × ay gün tablosu.
- **Kişiler:** kişinin bu yılki seyahat günleri, sıradaki seyahati ve seyahatlerine geçiş.
- Durum renkle birlikte dolguyla da anlatılır: planlanan çerçeveli (mavi), gerçekleşen dolu (yeşil), tarihi geçen
  kırmızı. Telefonun geri tuşu açık paneli kapatır.
- Bir seyahat en fazla 365 gün olabilir; yalnızca gidiş değiştirilirse süre korunur. Aya taşan seyahat her iki ayda
  listelenir.

### API

| Yöntem | Yol | Açıklama |
|---|---|---|
| POST | `/api/giris` | Giriş; `{username, password}` |
| GET | `/api/oturum` | Oturum bilgisi ve CSRF anahtarı |
| POST | `/api/cikis` | Çıkış |
| GET | `/api/kayitlar?ay=2026-10` | O ayın kayıtları; ay verilmezse tümü. `?bas=2025-12-29&bit=2027-01-03` ile tarih aralığı (en fazla 400 gün) |
| POST | `/api/kayitlar` | Yeni kayıt; `{personId, region, date, endDate, note, status}` (`endDate` verilmezse `date`) |
| PATCH | `/api/kayitlar/:id` | Kısmi güncelleme (yalnızca `date` değişirse süre korunur) |
| DELETE | `/api/kayitlar/:id` | Silme |
| GET | `/api/kisiler[?ay=2026-10]` | Kişiler ve sayıları (`id, name, planned, done`) |
| GET | `/saglik` | Sağlık kontrolü |

Değişiklik istekleri (POST/PATCH/DELETE) `Content-Type: application/json`, sunucunun kendi adresiyle eşleşen
`Origin` başlığı ve oturum açıksa `X-CSRF-Token` başlığı gerektirir.

## Ayarlar (`.env`)

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `NODE_ENV` | `development` | `production` olduğunda çerez varsayılan olarak Secure olur |
| `HOST` | `127.0.0.1` | Dinlenecek adres |
| `PORT` | `3000` | Port |
| `PUBLIC_URL` | — | Dış adres (ör. `https://seyahat.ornek.com.tr`). Verilirse Origin denetimi buna göre yapılır |
| `TRUST_PROXY` | kapalı | nginx arkasında `1` |
| `COOKIE_SECURE` | üretimde `true` | `true` iken çerez `Secure` ve `__Host-` önekli |
| `SESSION_HOURS` | `8` | Oturum süresi (kayan) |
| `DB_PATH` | `data/seyahat.db` | Veritabanı dosyası |

`.env` dosyası ek kütüphane olmadan okunur; ortamda zaten tanımlı olan değişkenler ezilmez.

## Güvenlik önlemleri

- **Parolalar:** scrypt (N=32768, r=8, p=1, 16 bayt tuz); karşılaştırma `timingSafeEqual` ile.
  Kullanıcı yoksa da sahte bir özet doğrulanır; hata mesajı her durumda *"Kullanıcı adı veya parola hatalı."*
- **Oturumlar:** veritabanında yalnızca oturum kimliğinin SHA-256 özeti tutulur. Çerez `HttpOnly`, `SameSite=Strict`,
  `Path=/`; üretimde `Secure` ve `__Host-` önekli. Süre 8 saat, kullanıcı aktifken kayarak uzar. Girişte her zaman
  yeni oturum açılır (oturum sabitlemeye karşı). Kullanıcının parolası/rolü değişince açık oturumları kapanır.
- **CSRF:** oturuma özel anahtar, değişiklik isteklerinde `X-CSRF-Token` başlığıyla zorunlu; ayrıca `Origin`
  sunucunun kendi adresiyle eşleşmeli (giriş isteği dahil).
- **Kaba kuvvet:** yalnızca hatalı denemeler sayılır. Aynı kullanıcı adına 15 dakikada 8, aynı IP'den 30 hatalı
  denemeden sonra `429` + `Retry-After`. Başarılı giriş kullanıcı sayacını sıfırlar. Deneme, parola doğrulanmadan
  önce sayılır; aynı anda gönderilen paralel istekler de sınırı aşamaz.
- **İstek sınırı:** genel dakikada 300.
- **SQL:** tüm sorgular hazırlanmış ve parametreli.
- **Girdi doğrulama (sunucuda):** bilinmeyen alanlar reddedilir; gerçek takvim tarihi (30 Şubat reddedilir), yıl
  2000–2100; metinlerden kontrol ve görünmez yön karakterleri temizlenir; bölge ≤ 80, not ≤ 500 karakter;
  JSON gövde sınırı 10 KB (`413`), JSON olmayan gövde `415`.
- **XSS:** arayüz veriyi yalnızca `textContent` / `createElement` ile yazar; `innerHTML` kullanılmaz.
- **Başlıklar:** `Content-Security-Policy` (`default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'`),
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`
  (kamera, mikrofon, konum kapalı), COOP/CORP `same-origin`, HTTPS'te HSTS; `X-Powered-By` kapalı.
- **Statik dosyalar:** yalnızca `/static` altından; dotfile'lar reddedilir, dizin listesi yok.
- **Hatalar:** ayrıntılar istemciye gösterilmez, yalnızca sunucu kaydına yazılır; async hatalar sarmalayıcıyla yakalanır.
- **Denetim kaydı:** `audit` tablosunda giriş, başarısız giriş, çıkış, kayıt ekleme/güncelleme/silme;
  kullanıcı ve IP ile.

Denetim kaydını incelemek için:

```bash
sqlite3 data/seyahat.db "SELECT at, username, action, ip FROM audit ORDER BY id DESC LIMIT 50;"
```

## Üretime alma (nginx + HTTPS)

`.env`:

```ini
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
PUBLIC_URL=https://seyahat.ornek.com.tr
TRUST_PROXY=1
COOKIE_SECURE=true
```

systemd birimi (`/etc/systemd/system/seyahat.service`):

```ini
[Unit]
Description=Seyahat Defteri
After=network.target

[Service]
User=seyahat
WorkingDirectory=/opt/seyahat-defteri
ExecStart=/usr/bin/npm start
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/seyahat-defteri/data /opt/seyahat-defteri/yedekler
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

nginx (`/etc/nginx/sites-available/seyahat`):

```nginx
server {
    listen 80;
    server_name seyahat.ornek.com.tr;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name seyahat.ornek.com.tr;

    ssl_certificate     /etc/letsencrypt/live/seyahat.ornek.com.tr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/seyahat.ornek.com.tr/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 16k;
    server_tokens off;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

> `X-Forwarded-For` başlığını istemciden geleni eklemek yerine `$remote_addr` ile **ezin**; böylece IP tabanlı
> sınırlar sahte başlıkla atlatılamaz. `TRUST_PROXY=1` yalnızca uygulama nginx arkasındayken kullanılmalıdır.

```bash
sudo systemctl enable --now seyahat
sudo -u seyahat npm run kullanici-ekle -- --rol admin yonetici
```

## Yedekleme

```bash
npm run yedek
```

`VACUUM INTO` uygulama çalışırken bile tutarlı bir kopya üretir; dosyalar `yedekler/seyahat-<zaman>.db` adıyla
saklanır ve en yeni 30 yedek tutulur. Günlük yedek için cron örneği:

```cron
15 2 * * * cd /opt/seyahat-defteri && /usr/bin/npm run -s yedek >> /var/log/seyahat-yedek.log 2>&1
```

Geri yüklemek için servisi durdurun, yedek dosyasını `data/seyahat.db` olarak kopyalayın (yanındaki `-wal` ve
`-shm` dosyalarını silin) ve servisi başlatın. Yedekleri sunucu dışında, erişimi kısıtlı bir yere de kopyalayın:
parola özetleri yedeğin içindedir.

## Canlı sürüm: GitHub Pages + Supabase

Aynı arayüz, sunucu gerektirmeden GitHub Pages'te de yayınlanır; veriler Supabase (PostgreSQL) üzerinde tutulur.

- **Adres:** https://akkocakursat.github.io/seyahat-plan-/

### Supabase kurulumu (bir kez)

1. Supabase panelinde projeyi açın → **SQL Editor** → **New query**.
2. [`supabase/kurulum.sql`](supabase/kurulum.sql) dosyasının tamamını yapıştırıp **Run** deyin. Dosya tekrar
   çalıştırılabilir: var olan tablo ve verilere dokunmaz, fonksiyonları günceller.
3. Aynı yerde hesapları oluşturun (parola en az 12 karakter):

   ```sql
   select seyahat.kullanici_ekle('yonetici', 'GUCLU-BIR-PAROLA-BURAYA', 'admin');
   select seyahat.kullanici_ekle('ayse', 'BASKA-GUCLU-PAROLA', 'editor');
   select seyahat.kisi_ekle('Yeni Kişi');   -- yeni seyahat eden kişi
   ```

   Aynı kullanıcı adıyla tekrar çalıştırmak parolayı ve rolü günceller, açık oturumları kapatır.
   Girişte kullanıcı adı büyük/küçük harf ve Türkçe harf duyarsızdır: `kursat` hesabına `Kürşat` ya da `KÜRŞAT`
   yazılarak da girilir (kullanıcı adları İngilizce harflerle saklanır).
   Not: SQL düzenleyicisinin geçmişi çalıştırılan sorguları saklar; parolayı girdikten sonra o sorguyu
   geçmişten silebilir ya da kullanıcıya ilk girişte değiştirmesini söyleyebilirsiniz.

### Supabase sürümünün güvenlik modeli

- Tablolar API'ye açık olmayan `seyahat` şemasındadır; `anon` rolü bu şemaya hiç erişemez, ayrıca RLS açık ve
  politika yoktur. Tarayıcı yalnızca `public` şemadaki `SECURITY DEFINER` fonksiyonları çağırabilir
  (`giris`, `oturum`, `cikis`, `kayitlar_listele`, `kayit_ekle`, `kayit_guncelle`, `kayit_sil`, `kisiler_listele`,
  `kayitlar_aralik`). Her fonksiyon oturumu, rolü ve girdileri kendisi denetler; `search_path` boştur.
- Parolalar `pgcrypto` ile **bcrypt (maliyet 12)** özetlenir (PostgreSQL'de scrypt bulunmadığından). Kullanıcı
  yoksa da sahte özetle aynı maliyette doğrulama yapılır; hata mesajı her durumda aynıdır.
- Oturum anahtarı 32 rastgele bayttır; veritabanında yalnızca SHA-256 özeti tutulur, süre 8 saat ve kayar.
  Anahtar çerezle değil istek gövdesiyle gönderildiği için CSRF saldırısı mümkün değildir.
- Kaba kuvvet ve istek sınırları sunucu sürümüyle aynıdır (kullanıcı adına 15 dk'da 8, IP'den 30 hatalı deneme;
  genel dakikada 300); IP, Supabase'in `cf-connecting-ip` başlığından alınır.
- Girdi doğrulama ve denetim kaydı sunucu sürümüyle aynıdır. Kişi linki özelliği kaldırıldı; daha önce kurulmuş
  `paylasim` ve `link_yenile` fonksiyonlarının çağrı izni `kurulum.sql` tarafından geri alınır.
- Silinen kayıtlar `deleted_at` ile işaretlenir; listelerde ve sayılarda görünmez, ama
  veritabanında kalır (yanlışlıkla silmede geri alınabilir). Çıkışta ve parola değişiminde oturumların süresi
  hemen sona erdirilir. Kalıcı temizlik gerekirse SQL düzenleyicisinden yapılabilir:
  `delete from seyahat.trips where deleted_at < now() - interval '90 days';`
- Supabase güvenlik denetimi (Advisors) API fonksiyonları için "anon çalıştırabilir SECURITY DEFINER" uyarısı
  verir: bu tasarım gereğidir — fonksiyonlar giriş yapmamış tarayıcıdan çağrılır ve oturumu kendileri denetler.
- `site/yapilandirma.json` içindeki anahtar Supabase'in **yayımlanabilir (publishable)** anahtarıdır; tarayıcıda
  görünmesi tasarım gereğidir ve tek başına hiçbir tabloya erişim vermez. `service_role` anahtarı hiçbir yerde
  kullanılmaz.
- GitHub Pages yanıt başlığı ayarlatmadığı için CSP ve Referrer-Policy `<meta>` etiketiyle verilir.
  `frame-ancestors`, HSTS dışı başlıklar ve `X-Frame-Options` bu sürümde uygulanamaz; bunlar gerekiyorsa
  yukarıdaki Express sürümünü nginx arkasında kullanın.

### Yayınlama

`main` dalına her gönderimde `.github/workflows/pages.yml` testleri çalıştırır, `npm run site` ile `_site/`
klasörünü üretir ve `gh-pages` dalına yayınlar. Depo ayarlarında **Settings → Pages → Build and deployment →
Source: Deploy from a branch → `gh-pages` / `(root)`** seçili olmalıdır. Yerelde denemek için:

```bash
npm run site        # _site/ klasörünü üretir
```

Supabase SQL testleri (`supabase/test.sql`) her gönderimde CI'da PostgreSQL 17 üzerinde çalışır.

## Testler

```bash
npm test
```

GitHub Actions (`.github/workflows/test.yml`) her push ve pull request'te testleri Node 22.13, 22.x ve 24.x üzerinde çalıştırır.

Testler geçici bir veritabanıyla gerçek bir sunucu başlatır ve `fetch` ile şunları doğrular: güvenlik başlıkları,
oturumsuz erişimde 401, aynı hata mesajı, çerez bayrakları, 4 kişinin tanımlı olması, CSRF anahtarsız ve yabancı
Origin'li isteklerde 403, ekle/durum değiştir/düzenle/sil, aya göre listelemede sınır günleri, geçersiz girdiler,
viewer'ın yazamaması, kaldırılan kişi linki uçlarının artık bulunmaması,
çıkış sonrası oturumun geçersizliği, 413/415, hatalı giriş kilidi ve dizin gezintisinin engellenmesi.
