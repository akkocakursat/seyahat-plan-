export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
    this.expose = true;
  }
}

// C0/C1 kontrol karakterleri ile görünmez yön/biçim karakterleri (Trojan Source vb.).
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const INVISIBLE = /[؜​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

export function cleanText(value, { multiline = false } = {}) {
  let s = String(value).normalize('NFC').replace(/\r\n?/g, '\n');
  s = s.replace(INVISIBLE, '');
  s = multiline ? s.replace(CONTROL, '').replace(/\t/g, ' ') : s.replace(/[\n\t]/g, ' ').replace(CONTROL, '');
  return s.trim();
}

export function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= daysInMonth;
}

export function parseMonth(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) return null;
  const [y, m] = value.split('-').map(Number);
  if (y < 2000 || y > 2100 || m < 1 || m > 12) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}

export function parseId(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^[1-9]\d{0,15}$/.test(value)) {
    const n = Number(value);
    if (Number.isSafeInteger(n)) return n;
  }
  return null;
}

const TRIP_FIELDS = ['personId', 'region', 'date', 'endDate', 'note', 'status'];
export const MAX_TRIP_DAYS = 365;

// İki tarih arasındaki gün sayısı (başlangıç ve bitiş dahil).
export function tripDays(start, end) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

export function shiftDate(iso, days) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function checkTripRange(start, end) {
  if (end < start) throw new ValidationError('Bitiş tarihi başlangıç tarihinden önce olamaz.');
  if (tripDays(start, end) > MAX_TRIP_DAYS) throw new ValidationError(`Bir seyahat en fazla ${MAX_TRIP_DAYS} gün olabilir.`);
}
export const STATUSES = ['planned', 'done'];

function assertPlainObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('Geçersiz istek gövdesi.');
}

function rejectUnknown(body, allowed) {
  const unknown = Object.keys(body).filter((k) => !allowed.includes(k));
  if (unknown.length) throw new ValidationError(`Bilinmeyen alan: ${unknown.slice(0, 3).join(', ').slice(0, 60)}`);
}

function field(name, value) {
  switch (name) {
    case 'personId': {
      const id = parseId(value);
      if (id === null) throw new ValidationError('Kişi seçilmelidir.');
      return id;
    }
    case 'region': {
      if (typeof value !== 'string') throw new ValidationError('Bölge metin olmalıdır.');
      const s = cleanText(value);
      if (!s) throw new ValidationError('Bölge boş olamaz.');
      if ([...s].length > 80) throw new ValidationError('Bölge en fazla 80 karakter olabilir.');
      return s;
    }
    case 'date': {
      if (!isValidDate(value)) throw new ValidationError('Tarih geçerli bir YYYY-AA-GG tarihi olmalıdır (2000–2100).');
      return value;
    }
    case 'endDate': {
      if (!isValidDate(value)) throw new ValidationError('Bitiş tarihi geçerli bir YYYY-AA-GG tarihi olmalıdır (2000–2100).');
      return value;
    }
    case 'note': {
      if (value === null || value === undefined) return '';
      if (typeof value !== 'string') throw new ValidationError('Not metin olmalıdır.');
      const s = cleanText(value, { multiline: true });
      if ([...s].length > 500) throw new ValidationError('Not en fazla 500 karakter olabilir.');
      return s;
    }
    case 'status': {
      if (!STATUSES.includes(value)) throw new ValidationError('Durum "planned" ya da "done" olmalıdır.');
      return value;
    }
    default:
      throw new ValidationError('Bilinmeyen alan.');
  }
}

export function validateTripCreate(body) {
  assertPlainObject(body);
  rejectUnknown(body, TRIP_FIELDS);
  for (const k of ['personId', 'region', 'date']) {
    if (body[k] === undefined) throw new ValidationError(`Eksik alan: ${k}`);
  }
  const out = {};
  for (const k of TRIP_FIELDS) {
    const value = k === 'status' ? (body.status ?? 'planned') : k === 'endDate' ? (body.endDate ?? body.date) : body[k];
    out[k] = field(k, value);
  }
  checkTripRange(out.date, out.endDate);
  return out;
}

export function validateTripPatch(body) {
  assertPlainObject(body);
  rejectUnknown(body, TRIP_FIELDS);
  const keys = Object.keys(body);
  if (!keys.length) throw new ValidationError('Güncellenecek alan yok.');
  const out = {};
  for (const k of keys) out[k] = field(k, body[k]);
  return out;
}

export function validateLogin(body) {
  assertPlainObject(body);
  rejectUnknown(body, ['username', 'password']);
  const { username, password } = body;
  if (typeof username !== 'string' || typeof password !== 'string' || username.length > 100 || password.length > 1024) {
    return null;
  }
  return { username: username.trim(), password };
}
