import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

export const INITIAL_PEOPLE = ['Selim Kutlubay', 'Yusuf Özoğlu', 'Selahattin Çomuoğlu', 'Kürşat Akkoca'];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS people (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  share_key  TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash    TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS trips (
  id         INTEGER PRIMARY KEY,
  person_id  INTEGER NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
  region     TEXT NOT NULL CHECK (length(region) BETWEEN 1 AND 80),
  date       TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  end_date   TEXT CHECK (end_date >= date),
  note       TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  details    TEXT CHECK (length(details) <= 5000),  -- not (en fazla 5000 karakter); eski kısa notlar "note" sütunundadır
  status     TEXT NOT NULL CHECK (status IN ('planned', 'done')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS trips_date ON trips(date);
CREATE INDEX IF NOT EXISTS trips_person ON trips(person_id, date);

CREATE TABLE IF NOT EXISTS audit (
  id       INTEGER PRIMARY KEY,
  at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  user_id  INTEGER,
  username TEXT,
  action   TEXT NOT NULL,
  detail   TEXT,
  ip       TEXT
);
CREATE INDEX IF NOT EXISTS audit_at ON audit(at);
`;

export function newShareKey() {
  // 24 bayt -> 32 karakter base64url
  return randomBytes(24).toString('base64url');
}

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec(SCHEMA);
  migrate(db);
  seedPeople(db);
  return db;
}

// Eski veritabanlarını günceller: seyahatlere bitiş tarihi (mevcut kayıtlar tek günlük sayılır).
function migrate(db) {
  const cols = db.prepare('PRAGMA table_info(trips)').all().map((c) => c.name);
  if (!cols.includes('end_date')) db.exec('ALTER TABLE trips ADD COLUMN end_date TEXT');
  if (!cols.includes('details')) db.exec('ALTER TABLE trips ADD COLUMN details TEXT');
  db.exec('UPDATE trips SET end_date = date WHERE end_date IS NULL OR end_date < date');
}

function seedPeople(db) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM people').get();
  if (n > 0) return;
  const insert = db.prepare('INSERT INTO people (name, share_key) VALUES (?, ?)');
  db.exec('BEGIN');
  try {
    for (const name of INITIAL_PEOPLE) insert.run(name, newShareKey());
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function addPerson(db, name) {
  const info = db.prepare('INSERT INTO people (name, share_key) VALUES (?, ?)').run(name, newShareKey());
  return Number(info.lastInsertRowid);
}

export function audit(db, { userId = null, username = null, action, detail = null, ip = null }) {
  db.prepare('INSERT INTO audit (user_id, username, action, detail, ip) VALUES (?, ?, ?, ?, ?)')
    .run(userId, username, action, detail === null ? null : JSON.stringify(detail), ip);
}
