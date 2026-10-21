import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { createApp } from './app.js';
import { purgeExpiredSessions } from './auth.js';

const config = loadConfig();
const db = openDatabase(config.dbPath);
const app = createApp({ config, db });

purgeExpiredSessions(db);
const cleanup = setInterval(() => purgeExpiredSessions(db), 60 * 60_000);
cleanup.unref();

if (config.production && !config.cookieSecure) {
  console.warn('[uyarı] Üretimde COOKIE_SECURE=false: çerezler HTTPS dışında da gönderilir.');
}

const server = app.listen(config.port, config.host, () => {
  console.log(`Seyahat Defteri http://${config.host}:${server.address().port} adresinde çalışıyor (${config.nodeEnv}).`);
});
server.headersTimeout = 20_000;
server.requestTimeout = 30_000;

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
