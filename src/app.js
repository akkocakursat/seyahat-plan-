import express from 'express';
import { resolve } from 'node:path';
import { ROOT } from './config.js';
import { audit, newShareKey } from './db.js';
import {
  createSession, findSession, touchSession, deleteSession, verifyPassword, dummyHash, safeEqualStrings,
} from './auth.js';
import { Counter, rateLimit } from './ratelimit.js';
import {
  ValidationError, parseMonth, parseId, validateTripCreate, validateTripPatch, validateLogin,
} from './validate.js';

const LOGIN_ERROR = 'Kullanıcı adı veya parola hatalı.';
const SHARE_KEY_RE = /^[A-Za-z0-9_-]{32}$/;
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const PUBLIC_DIR = resolve(ROOT, 'public');
const VIEWS_DIR = resolve(ROOT, 'views');

// Express 4 async hataları kendiliğinden yakalamaz; bu sarmalayıcı next(err)'e iletir.
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expose = true;
  }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (!k || k in out) continue;
    out[k] = part.slice(eq + 1).trim();
  }
  return out;
}

export function createApp({ config, db, logger = console, limits = {} }) {
  const L = {
    generalPerMinute: 300,
    sharePerMinute: 30,
    loginUserFailures: 8,
    loginIpFailures: 30,
    loginWindowMs: 15 * 60_000,
    ...limits,
  };
  const sessionMs = config.sessionHours * 3600_000;
  const userFailures = new Counter({ limit: L.loginUserFailures, windowMs: L.loginWindowMs });
  const ipFailures = new Counter({ limit: L.loginIpFailures, windowMs: L.loginWindowMs });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('etag', false);

  // ---- Güvenlik başlıkları ----
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
        "form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  app.use(rateLimit({ limit: L.generalPerMinute, windowMs: 60_000 }));

  // ---- Statik dosyalar: yalnızca /static, dotfile yok, dizin listesi yok ----
  app.use('/static', express.static(PUBLIC_DIR, {
    dotfiles: 'deny', index: false, redirect: false, fallthrough: false, maxAge: config.production ? '1h' : 0,
  }));

  app.get('/saglik', (req, res) => {
    db.prepare('SELECT 1').get();
    res.set('Cache-Control', 'no-store').json({ durum: 'ok' });
  });

  // ---- Oturum çerezi ----
  function setSessionCookie(res, id) {
    const parts = [`${config.cookieName}=${id}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${Math.floor(sessionMs / 1000)}`];
    if (config.cookieSecure) parts.push('Secure');
    res.append('Set-Cookie', parts.join('; '));
  }
  function clearSessionCookie(res) {
    const parts = [`${config.cookieName}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
    if (config.cookieSecure) parts.push('Secure');
    res.append('Set-Cookie', parts.join('; '));
  }

  app.use((req, res, next) => {
    const id = parseCookies(req.headers.cookie)[config.cookieName];
    req.session = id ? findSession(db, id) : null;
    if (req.session) {
      // Kayan süre: dakikada en fazla bir kez uzatılır.
      if (req.session.expires_at - Date.now() < sessionMs - 60_000) {
        touchSession(db, req.session.id_hash, config.sessionHours);
        setSessionCookie(res, id);
      }
    }
    next();
  });

  function expectedOrigin(req) {
    if (config.publicUrl) return new URL(config.publicUrl).origin;
    return `${req.protocol}://${req.get('host')}`;
  }

  const requireAuth = (req, res, next) => {
    if (!req.session) return next(new HttpError(401, 'Oturum gerekli.'));
    next();
  };
  const requireRole = (...roles) => (req, res, next) => {
    if (!req.session) return next(new HttpError(401, 'Oturum gerekli.'));
    if (!roles.includes(req.session.role)) return next(new HttpError(403, 'Bu işlem için yetkiniz yok.'));
    next();
  };
  const requireCsrf = (req, res, next) => {
    const token = req.get('X-CSRF-Token');
    if (!req.session || !token || !safeEqualStrings(token, req.session.csrf_token)) {
      return next(new HttpError(403, 'Geçersiz güvenlik anahtarı. Sayfayı yenileyip tekrar deneyin.'));
    }
    next();
  };

  // ---- Sayfalar (statik HTML) ----
  const sendView = (name) => (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(resolve(VIEWS_DIR, name));
  };
  const shareLimiter = rateLimit({ limit: L.sharePerMinute, windowMs: 60_000 });
  app.get('/', sendView('index.html'));
  app.get('/giris', sendView('giris.html'));
  app.get('/kisi/:anahtar', shareLimiter, sendView('kisi.html'));

  // ---- API ----
  const api = express.Router();

  api.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!MUTATING.has(req.method)) return next();
    const origin = req.get('Origin');
    if (!origin || origin !== expectedOrigin(req)) return next(new HttpError(403, 'İstek kaynağı reddedildi.'));
    const hasBody = Number(req.get('Content-Length') || 0) > 0 || req.get('Transfer-Encoding') !== undefined;
    if (hasBody && !req.is('application/json')) return next(new HttpError(415, 'İstek gövdesi JSON olmalıdır.'));
    next();
  });
  api.use(express.json({ limit: '10kb', strict: true, type: 'application/json' }));

  const ip = (req) => req.ip || 'bilinmiyor';
  const actor = (req) => ({ userId: req.session?.user_id ?? null, username: req.session?.username ?? null, ip: ip(req) });

  api.post('/giris', ah(async (req, res) => {
    const creds = validateLogin(req.body ?? {});
    const clientIp = ip(req);
    const userKey = creds ? creds.username.toLowerCase() : '';

    const retry = Math.max(ipFailures.blockedFor(clientIp), userKey ? userFailures.blockedFor(userKey) : 0);
    if (retry) {
      res.set('Retry-After', String(retry));
      return res.status(429).json({ error: 'Çok fazla hatalı deneme. Lütfen daha sonra tekrar deneyin.' });
    }

    const user = creds ? db.prepare('SELECT id, username, role, password_hash FROM users WHERE username = ?').get(creds.username) : null;
    // Kullanıcı yoksa da aynı maliyette bir doğrulama yapılır.
    const ok = await verifyPassword(creds?.password ?? '', user ? user.password_hash : await dummyHash());

    if (!user || !ok) {
      ipFailures.hit(clientIp);
      if (userKey) userFailures.hit(userKey);
      audit(db, { action: 'giris_basarisiz', username: userKey.slice(0, 40) || null, ip: clientIp });
      return res.status(401).json({ error: LOGIN_ERROR });
    }

    userFailures.reset(userKey);
    if (req.session) deleteSession(db, req.session.id_hash);
    const session = createSession(db, user.id, config.sessionHours);
    setSessionCookie(res, session.id);
    audit(db, { userId: user.id, username: user.username, action: 'giris', ip: clientIp });
    res.json({ user: { username: user.username, role: user.role }, csrfToken: session.csrf });
  }));

  api.get('/oturum', requireAuth, (req, res) => {
    res.json({ user: { username: req.session.username, role: req.session.role }, csrfToken: req.session.csrf_token });
  });

  api.post('/cikis', requireAuth, requireCsrf, (req, res) => {
    deleteSession(db, req.session.id_hash);
    clearSessionCookie(res);
    audit(db, { ...actor(req), action: 'cikis' });
    res.status(204).end();
  });

  function monthRange(req) {
    if (req.query.ay === undefined) return null;
    const range = parseMonth(req.query.ay);
    if (!range) throw new ValidationError('Ay YYYY-AA biçiminde olmalıdır (2000–2100).');
    return range;
  }

  const TRIP_COLS = 'id, person_id AS personId, region, date, note, status';

  api.get('/kayitlar', requireAuth, (req, res) => {
    const range = monthRange(req);
    const rows = range
      ? db.prepare(`SELECT ${TRIP_COLS} FROM trips WHERE date BETWEEN ? AND ? ORDER BY date, id`).all(range.from, range.to)
      : db.prepare(`SELECT ${TRIP_COLS} FROM trips ORDER BY date, id`).all();
    res.json({ kayitlar: rows });
  });

  const personExists = (id) => Boolean(db.prepare('SELECT 1 FROM people WHERE id = ?').get(id));
  const getTrip = (id) => db.prepare(`SELECT ${TRIP_COLS} FROM trips WHERE id = ?`).get(id);

  api.post('/kayitlar', requireRole('admin', 'editor'), requireCsrf, (req, res) => {
    const t = validateTripCreate(req.body);
    if (!personExists(t.personId)) throw new ValidationError('Kişi bulunamadı.');
    const info = db.prepare('INSERT INTO trips (person_id, region, date, note, status, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(t.personId, t.region, t.date, t.note, t.status, req.session.user_id);
    const trip = getTrip(Number(info.lastInsertRowid));
    audit(db, { ...actor(req), action: 'kayit_ekle', detail: trip });
    res.status(201).json({ kayit: trip });
  });

  // Alan adı -> sütun adı eşlemesi sabittir; SQL'e yalnızca bu sabit adlar girer.
  const PATCH_COLUMNS = { personId: 'person_id', region: 'region', date: 'date', note: 'note', status: 'status' };

  api.patch('/kayitlar/:id', requireRole('admin', 'editor'), requireCsrf, (req, res) => {
    const id = parseId(req.params.id);
    const before = id && getTrip(id);
    if (!before) throw new HttpError(404, 'Kayıt bulunamadı.');
    const changes = validateTripPatch(req.body);
    if (changes.personId !== undefined && !personExists(changes.personId)) throw new ValidationError('Kişi bulunamadı.');
    const keys = Object.keys(changes);
    const sets = keys.map((k) => `${PATCH_COLUMNS[k]} = ?`).join(', ');
    db.prepare(`UPDATE trips SET ${sets}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
      .run(...keys.map((k) => changes[k]), id);
    const after = getTrip(id);
    audit(db, { ...actor(req), action: 'kayit_guncelle', detail: { id, once: before, sonra: after } });
    res.json({ kayit: after });
  });

  api.delete('/kayitlar/:id', requireRole('admin', 'editor'), requireCsrf, (req, res) => {
    const id = parseId(req.params.id);
    const before = id && getTrip(id);
    if (!before) throw new HttpError(404, 'Kayıt bulunamadı.');
    db.prepare('DELETE FROM trips WHERE id = ?').run(id);
    audit(db, { ...actor(req), action: 'kayit_sil', detail: before });
    res.status(204).end();
  });

  api.get('/kisiler', requireAuth, (req, res) => {
    const range = monthRange(req);
    const where = range ? 'AND t.date BETWEEN ? AND ?' : '';
    const params = range ? [range.from, range.to] : [];
    const rows = db.prepare(`
      SELECT p.id, p.name, p.share_key AS shareKey,
        COUNT(CASE WHEN t.status = 'planned' THEN 1 END) AS planned,
        COUNT(CASE WHEN t.status = 'done' THEN 1 END) AS done
      FROM people p LEFT JOIN trips t ON t.person_id = p.id ${where}
      GROUP BY p.id ORDER BY p.id`).all(...params);
    const canSeeKeys = req.session.role === 'admin' || req.session.role === 'editor';
    res.json({
      kisiler: rows.map((r) => {
        const out = { id: r.id, name: r.name, planned: r.planned, done: r.done };
        if (canSeeKeys) out.shareKey = r.shareKey;
        return out;
      }),
    });
  });

  api.post('/kisiler/:id/link-yenile', requireRole('admin'), requireCsrf, (req, res) => {
    const id = parseId(req.params.id);
    const person = id && db.prepare('SELECT id, name FROM people WHERE id = ?').get(id);
    if (!person) throw new HttpError(404, 'Kişi bulunamadı.');
    const shareKey = newShareKey();
    db.prepare('UPDATE people SET share_key = ? WHERE id = ?').run(shareKey, id);
    audit(db, { ...actor(req), action: 'link_yenile', detail: { kisiId: id, ad: person.name } });
    res.json({ shareKey });
  });

  api.get('/paylasim/:anahtar', shareLimiter, (req, res) => {
    const key = req.params.anahtar;
    const person = SHARE_KEY_RE.test(key) ? db.prepare('SELECT id, name FROM people WHERE share_key = ?').get(key) : null;
    if (!person) throw new HttpError(404, 'Bu link geçersiz ya da yenilenmiş.');
    const range = monthRange(req);
    const sql = `SELECT region, date, note, status FROM trips WHERE person_id = ? ${range ? 'AND date BETWEEN ? AND ?' : ''} ORDER BY date, id`;
    const trips = db.prepare(sql).all(person.id, ...(range ? [range.from, range.to] : []));
    res.json({ name: person.name, kayitlar: trips });
  });

  api.use((req, res, next) => next(new HttpError(404, 'Bulunamadı.')));
  app.use('/api', api);

  app.use((req, res) => {
    res.status(404).type('text/plain; charset=utf-8').send('Sayfa bulunamadı.');
  });

  // ---- Hata işleyici: ayrıntılar yalnızca sunucu kaydına ----
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let status = Number(err.status || err.statusCode) || 500;
    let message;
    if (err.type === 'entity.too.large') message = 'İstek gövdesi çok büyük (en fazla 10 KB).';
    else if (err.type === 'entity.parse.failed') message = 'Geçersiz JSON.';
    else if (err.type === 'charset.unsupported' || err.type === 'encoding.unsupported') { status = 415; message = 'Desteklenmeyen kodlama.'; }
    else if (err.expose && status < 500) message = err.message;
    else if (status === 404) message = 'Bulunamadı.';
    else if (status === 403) message = 'Erişim reddedildi.';
    else if (status < 500) message = 'Geçersiz istek.';
    else { status = 500; message = 'Sunucu hatası.'; }
    if (status >= 500) logger.error(`[hata] ${req.method} ${req.originalUrl}`, err);
    if (res.headersSent) return;
    if (req.originalUrl.startsWith('/api/')) res.status(status).json({ error: message });
    else res.status(status).type('text/plain; charset=utf-8').send(message);
  });

  return app;
}
