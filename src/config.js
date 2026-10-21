import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// .env dosyasını ek kütüphane olmadan okur. Ortamda zaten tanımlı olan değerler ezilmez.
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'evet'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// TRUST_PROXY: "true"/"false", sayı (atlama sayısı) ya da "loopback" gibi bir değer olabilir.
function trustProxy(value) {
  if (value === undefined || value === '') return false;
  if (/^\d+$/.test(value)) return Number(value);
  if (['true', 'false'].includes(value.toLowerCase())) return value.toLowerCase() === 'true';
  return value;
}

function publicUrl(value) {
  if (!value) return '';
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`PUBLIC_URL geçerli bir adres değil: ${value}`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('PUBLIC_URL http:// ya da https:// ile başlamalıdır.');
  return url.origin;
}

export function loadConfig(overrides = {}) {
  if (!overrides.skipEnvFile) loadEnvFile(resolve(ROOT, '.env'));
  const env = { ...process.env, ...overrides.env };
  const nodeEnv = env.NODE_ENV || 'development';
  const production = nodeEnv === 'production';
  const host = env.HOST || '127.0.0.1';
  const port = env.PORT !== undefined ? Number.parseInt(env.PORT, 10) : 3000;
  const cookieSecure = bool(env.COOKIE_SECURE, production);
  const dbPath = env.DB_PATH || 'data/seyahat.db';
  return {
    nodeEnv,
    production,
    host,
    port: Number.isFinite(port) && port >= 0 ? port : 3000,
    publicUrl: publicUrl(env.PUBLIC_URL),
    trustProxy: trustProxy(env.TRUST_PROXY),
    cookieSecure,
    cookieName: cookieSecure ? '__Host-seyahat_oturum' : 'seyahat_oturum',
    sessionHours: int(env.SESSION_HOURS, 8),
    dbPath: dbPath === ':memory:' ? dbPath : resolve(ROOT, dbPath),
  };
}
