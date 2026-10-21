// Kullanım: npm run kisi-ekle -- "Ad Soyad"
import { loadConfig } from '../src/config.js';
import { openDatabase, addPerson } from '../src/db.js';
import { cleanText } from '../src/validate.js';

const name = cleanText(process.argv.slice(2).join(' '));
if (!name || [...name].length > 80) {
  console.error('Kullanım: npm run kisi-ekle -- "Ad Soyad"  (en fazla 80 karakter)');
  process.exit(2);
}

const config = loadConfig();
const db = openDatabase(config.dbPath);
try {
  if (db.prepare('SELECT 1 FROM people WHERE name = ?').get(name)) {
    console.error(`"${name}" zaten tanımlı.`);
    process.exit(1);
  }
  addPerson(db, name);
  console.log(`"${name}" eklendi.`);
} finally {
  db.close();
}
