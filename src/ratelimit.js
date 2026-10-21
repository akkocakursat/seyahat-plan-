// Bellek içi sabit pencereli sayaçlar. Tek süreçli kurulum için yeterlidir.
export class Counter {
  constructor({ limit, windowMs, max = 50_000 }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.max = max;
    this.map = new Map();
  }

  #entry(key, now) {
    let e = this.map.get(key);
    if (!e || e.reset <= now) {
      if (!e && this.map.size >= this.max) this.prune(now);
      e = { count: 0, reset: now + this.windowMs };
      this.map.set(key, e);
    }
    return e;
  }

  // Sınır aşıldıysa kalan saniye, aşılmadıysa 0 döner (saymaz).
  blockedFor(key, now = Date.now()) {
    const e = this.map.get(key);
    if (!e || e.reset <= now || e.count < this.limit) return 0;
    return Math.max(1, Math.ceil((e.reset - now) / 1000));
  }

  hit(key, now = Date.now()) {
    const e = this.#entry(key, now);
    e.count += 1;
    return e;
  }

  // Önceden sayılmış bir denemeyi geri alır.
  undo(key) {
    const e = this.map.get(key);
    if (e && e.count > 0) e.count -= 1;
  }

  reset(key) {
    this.map.delete(key);
  }

  prune(now = Date.now()) {
    for (const [k, e] of this.map) if (e.reset <= now) this.map.delete(k);
    // Hâlâ çok doluysa en eskileri at (bellek tüketimi saldırısına karşı).
    if (this.map.size >= this.max) {
      const drop = this.map.size - Math.floor(this.max * 0.9);
      let i = 0;
      for (const k of this.map.keys()) {
        if (i++ >= drop) break;
        this.map.delete(k);
      }
    }
  }
}

// Express ara katmanı: her isteği sayar, sınır aşılınca 429 + Retry-After.
export function rateLimit({ limit, windowMs, keyFn = (req) => req.ip }) {
  const counter = new Counter({ limit, windowMs });
  return (req, res, next) => {
    const now = Date.now();
    const e = counter.hit(keyFn(req), now);
    if (e.count > limit) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((e.reset - now) / 1000))));
      return res.status(429).json({ error: 'Çok fazla istek. Lütfen biraz sonra tekrar deneyin.' });
    }
    next();
  };
}
