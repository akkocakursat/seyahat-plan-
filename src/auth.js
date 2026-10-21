import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;
// N=32768, r=8 için ~32 MB bellek gerekir; Node varsayılanı (32 MB) sınırda olduğundan açıkça yükseltilir.
const MAXMEM = 64 * 1024 * 1024;

export const MIN_PASSWORD_LENGTH = 12;
export const ROLES = ['admin', 'editor', 'viewer'];

// Biçim: scrypt$N$r$p$tuz(base64)$özet(base64)
export async function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES);
  const key = await scryptAsync(password.normalize('NFC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scryptAsync(String(password).normalize('NFC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Kullanıcı bulunamadığında da aynı maliyette doğrulama yapmak için sabit bir sahte özet.
let dummyHashPromise;
export function dummyHash() {
  dummyHashPromise ??= hashPassword(randomBytes(32).toString('base64'));
  return dummyHashPromise;
}

export function newToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function safeEqualStrings(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function createSession(db, userId, hours) {
  const id = newToken(32);
  const csrf = newToken(32);
  const now = Date.now();
  db.prepare('INSERT INTO sessions (id_hash, user_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run(sha256(id), userId, csrf, now, now + hours * 3600_000);
  return { id, csrf };
}

export function findSession(db, id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(id)) return null;
  const row = db.prepare(`
    SELECT s.id_hash, s.csrf_token, s.expires_at, u.id AS user_id, u.username, u.role
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id_hash = ?`).get(sha256(id));
  if (!row) return null;
  if (row.expires_at <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(row.id_hash);
    return null;
  }
  return row;
}

export function touchSession(db, idHash, hours) {
  db.prepare('UPDATE sessions SET expires_at = ? WHERE id_hash = ?').run(Date.now() + hours * 3600_000, idHash);
}

export function deleteSession(db, idHash) {
  db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(idHash);
}

export function purgeExpiredSessions(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
}

export async function upsertUser(db, username, password, role) {
  const hash = await hashPassword(password);
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    db.exec('BEGIN');
    try {
      db.prepare(`UPDATE users SET password_hash = ?, role = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
        .run(hash, role, existing.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return { id: existing.id, created: false };
  }
  const info = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, hash, role);
  return { id: Number(info.lastInsertRowid), created: true };
}

export function validUsername(username) {
  return typeof username === 'string' && /^[A-Za-z0-9._-]{3,40}$/.test(username);
}
