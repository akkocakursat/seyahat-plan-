import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/db.js';

test('bitiş tarihi olmayan eski veritabanı açılışta güncellenir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'seyahat-goc-'));
  const path = join(dir, 'eski.db');
  try {
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE trips (id INTEGER PRIMARY KEY, person_id INTEGER NOT NULL, region TEXT NOT NULL, date TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, created_by INTEGER, created_at TEXT, updated_at TEXT)`);
    old.exec("INSERT INTO trips (person_id, region, date, status) VALUES (1, 'Ankara', '2026-10-01', 'planned')");
    old.close();
    const db = openDatabase(path);
    assert.deepEqual({ ...db.prepare('SELECT date, end_date FROM trips').get() }, { date: '2026-10-01', end_date: '2026-10-01' });
    db.close();
    openDatabase(path).close(); // ikinci açılış da sorunsuz
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
