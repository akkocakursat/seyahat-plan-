// Kullanım: npm run yedek — VACUUM INTO ile tutarlı bir kopya alır, son 30 yedeği tutar.
import { readdirSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig, ROOT } from '../src/config.js';

const KEEP = 30;
const config = loadConfig();
if (config.dbPath === ':memory:' || !existsSync(config.dbPath)) {
  console.error(`Veritabanı bulunamadı: ${config.dbPath}`);
  process.exit(1);
}
const dir = resolve(ROOT, 'yedekler');
mkdirSync(dir, { recursive: true, mode: 0o700 });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = join(dir, `seyahat-${stamp}.db`);

const db = new DatabaseSync(config.dbPath);
try {
  db.prepare('VACUUM INTO ?').run(target);
} finally {
  db.close();
}
console.log(`Yedek alındı: ${target}`);

const files = readdirSync(dir).filter((f) => /^seyahat-.*\.db$/.test(f)).sort();
for (const old of files.slice(0, Math.max(0, files.length - KEEP))) {
  unlinkSync(join(dir, old));
  console.log(`Eski yedek silindi: ${old}`);
}
