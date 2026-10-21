// Kullanım: npm run kullanici-ekle -- --rol admin|editor|viewer [kullanici_adi]
import { createInterface } from 'node:readline';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { upsertUser, validUsername, ROLES, MIN_PASSWORD_LENGTH } from '../src/auth.js';

function parseArgs(argv) {
  const out = { rol: null, username: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--rol' || a === '-r') out.rol = argv[++i];
    else if (a.startsWith('--rol=')) out.rol = a.slice(6);
    else if (a === '--kullanici' || a === '-k') out.username = argv[++i];
    else if (!a.startsWith('-') && !out.username) out.username = a;
  }
  return out;
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(question, (answer) => { rl.close(); res(answer.trim()); }));
}

// Parolayı ekrana yansıtmadan okur.
function askHidden(question) {
  return new Promise((res, rej) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) {
      // Boru ile verilen girdi (otomasyon): ilk satır okunur.
      const rl = createInterface({ input: stdin });
      rl.once('line', (line) => { res(line); rl.close(); });
      rl.once('close', () => res(''));
      return;
    }
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          stdout.write('\n');
          return res(value);
        }
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          stdout.write('\n');
          return rej(new Error('İptal edildi.'));
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!ROLES.includes(args.rol)) {
    console.error('Kullanım: npm run kullanici-ekle -- --rol admin|editor|viewer [kullanici_adi]');
    process.exit(2);
  }
  const username = args.username || await ask('Kullanıcı adı: ');
  if (!validUsername(username)) {
    console.error('Kullanıcı adı 3–40 karakter olmalı; yalnızca harf, rakam, nokta, alt çizgi ve tire içerebilir.');
    process.exit(2);
  }
  const password = await askHidden(`Parola (en az ${MIN_PASSWORD_LENGTH} karakter): `);
  if ([...password].length < MIN_PASSWORD_LENGTH) {
    console.error(`Parola en az ${MIN_PASSWORD_LENGTH} karakter olmalıdır.`);
    process.exit(2);
  }
  if (process.stdin.isTTY) {
    const again = await askHidden('Parola (tekrar): ');
    if (again !== password) {
      console.error('Parolalar eşleşmiyor.');
      process.exit(2);
    }
  }
  const config = loadConfig();
  const db = openDatabase(config.dbPath);
  const result = await upsertUser(db, username, password, args.rol);
  db.close();
  console.log(result.created
    ? `"${username}" kullanıcısı ${args.rol} rolüyle oluşturuldu.`
    : `"${username}" kullanıcısının parolası ve rolü (${args.rol}) güncellendi; açık oturumları kapatıldı.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
