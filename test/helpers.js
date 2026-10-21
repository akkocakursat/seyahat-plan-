import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
import { upsertUser } from '../src/auth.js';

export const PASSWORDS = {
  yonetici: 'yonetici-parola-123',
  editor: 'editor-parola-1234',
  izleyici: 'izleyici-parola-12',
};

const silentLogger = { error() {}, warn() {}, log() {} };

export async function startServer({ limits, env = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'seyahat-test-'));
  const config = loadConfig({ skipEnvFile: true, env: { NODE_ENV: 'test', DB_PATH: join(dir, 'test.db'), COOKIE_SECURE: 'false', PUBLIC_URL: '', TRUST_PROXY: '', ...env } });
  const db = openDatabase(config.dbPath);
  await upsertUser(db, 'yonetici', PASSWORDS.yonetici, 'admin');
  await upsertUser(db, 'editor', PASSWORDS.editor, 'editor');
  await upsertUser(db, 'izleyici', PASSWORDS.izleyici, 'viewer');
  const app = createApp({ config, db, logger: silentLogger, limits });
  const server = await new Promise((res) => {
    const s = app.listen(0, '127.0.0.1', () => res(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function req(method, path, { session, body, rawBody, origin = base, headers = {}, csrf } = {}) {
    const h = { ...headers };
    if (origin) h.Origin = origin;
    if (session) h.Cookie = session.cookie;
    const token = csrf === undefined ? session?.csrf : csrf;
    if (token) h['X-CSRF-Token'] = token;
    let payload;
    if (rawBody !== undefined) payload = rawBody;
    else if (body !== undefined) {
      payload = JSON.stringify(body);
      h['Content-Type'] ??= 'application/json';
    }
    const res = await fetch(base + path, { method, headers: h, body: payload, redirect: 'manual' });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* JSON değil */ }
    return { status: res.status, headers: res.headers, text, json };
  }

  async function login(username, password = PASSWORDS[username]) {
    const res = await req('POST', '/api/giris', { body: { username, password } });
    if (res.status !== 200) throw new Error(`giriş başarısız: ${res.status} ${res.text}`);
    const setCookie = res.headers.get('set-cookie');
    const cookie = setCookie.split(';')[0];
    return { cookie, csrf: res.json.csrfToken, setCookie, user: res.json.user };
  }

  async function close() {
    await new Promise((res) => server.close(res));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }

  return { base, db, config, req, login, close };
}
