// Ortak yardımcılar. Kullanıcı verisi DOM'a yalnızca textContent / createElement ile yazılır.

export const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
export const STATUS_LABEL = { planned: 'Planlanan', done: 'Gerçekleşen' };
export const ROLE_LABEL = { admin: 'Yönetici', editor: 'Düzenleyici', viewer: 'Görüntüleyici' };

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'value') node.value = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key in node && typeof value !== 'string') node[key] = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

const pad = (n) => String(n).padStart(2, '0');

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function currentMonth() {
  const d = new Date();
  return { y: d.getFullYear(), m: d.getMonth() + 1 };
}

export function shiftMonth({ y, m }, delta) {
  const idx = y * 12 + (m - 1) + delta;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

export const monthKey = ({ y, m }) => `${y}-${pad(m)}`;
export const monthLabel = ({ y, m }) => `${MONTHS[m - 1]} ${y}`;
export const sameMonth = (a, b) => a.y === b.y && a.m === b.m;

export function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

export function sortTrips(trips, status) {
  const dir = status === 'done' ? -1 : 1;
  return [...trips].sort((a, b) => (a.date < b.date ? -dir : a.date > b.date ? dir : (a.id ?? 0) - (b.id ?? 0)));
}

// Ay seçici: "‹ Ekim 2026 ›" ve gerekirse "Bu aya dön".
export function renderMonthBar(container, month, onChange) {
  const now = currentMonth();
  const nodes = [
    el('div', { class: 'month-nav' },
      el('button', { type: 'button', class: 'btn btn-icon', 'aria-label': 'Önceki ay', text: '‹', onclick: () => onChange(shiftMonth(month, -1)) }),
      el('span', { class: 'month-label', 'aria-live': 'polite', text: monthLabel(month) }),
      el('button', { type: 'button', class: 'btn btn-icon', 'aria-label': 'Sonraki ay', text: '›', onclick: () => onChange(shiftMonth(month, 1)) })),
  ];
  if (!sameMonth(month, now)) {
    nodes.push(el('button', { type: 'button', class: 'btn btn-ghost-dark', text: 'Bu aya dön', onclick: () => onChange(now) }));
  }
  clear(container).append(...nodes);
}

export function regionTag(text) {
  return el('span', { class: 'tag', text });
}

export function dateText(iso) {
  return el('time', { class: 'mono', datetime: iso, text: formatDate(iso) });
}

const isoMs = (iso) => Date.parse(`${iso}T00:00:00Z`);

// Seyahatin gün sayısı (başlangıç ve bitiş dahil). Bitişi olmayan eski kayıtlar tek gün sayılır.
export function tripDays(t) {
  return Math.round((isoMs(t.endDate || t.date) - isoMs(t.date)) / 86_400_000) + 1;
}

export function addDaysISO(iso, n) {
  return new Date(isoMs(iso) + n * 86_400_000).toISOString().slice(0, 10);
}

export const daysBetween = (start, end) => Math.round((isoMs(end) - isoMs(start)) / 86_400_000) + 1;

// Tarihi geçmiş plan: bitişi bugünden önce olduğu halde hâlâ Planlanan'da duran kayıt.
export const isOverdue = (t) => t.status === 'planned' && (t.endDate || t.date) < todayISO();

export function daysBadge(n) {
  return el('span', { class: 'days', text: `${n} gün` });
}

// "21.10.2026" ya da "21.10.2026 – 23.10.2026" + gün sayısı
export function rangeText(t) {
  const end = t.endDate || t.date;
  return el('span', { class: 'range' },
    dateText(t.date),
    end !== t.date ? el('span', { class: 'range-sep', text: '–' }) : null,
    end !== t.date ? dateText(end) : null,
    daysBadge(tripDays(t)));
}

// Veri katmanı: Express sürümünde ./arka-uc.js sunucu API'sine, GitHub Pages sürümünde Supabase'e bağlanır.
export { api, setCsrf, yollar } from './arka-uc.js';
export { ApiError } from './hata.js';

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

// Başlangıç + bitiş tarihi alanları ve canlı "x gün" bilgisi. Başlangıç değişince süre korunur.
export function dateRangeInputs(start, end) {
  const startInput = el('input', { name: 'date', type: 'date', required: true, min: '2000-01-01', max: '2100-12-31', value: start });
  const endInput = el('input', { name: 'endDate', type: 'date', required: true, min: start, max: '2100-12-31', value: end || start });
  const hint = el('span', { class: 'days-hint', 'aria-live': 'polite' });
  let prevStart = start;
  const update = () => {
    if (ISO_RE.test(startInput.value)) endInput.min = startInput.value;
    const ok = ISO_RE.test(startInput.value) && ISO_RE.test(endInput.value) && endInput.value >= startInput.value;
    hint.textContent = ok ? `${daysBetween(startInput.value, endInput.value)} gün` : '';
  };
  startInput.addEventListener('change', () => {
    if (ISO_RE.test(prevStart) && ISO_RE.test(endInput.value) && ISO_RE.test(startInput.value) && endInput.value >= prevStart) {
      endInput.value = addDaysISO(startInput.value, daysBetween(prevStart, endInput.value) - 1);
    } else if (ISO_RE.test(startInput.value) && (!ISO_RE.test(endInput.value) || endInput.value < startInput.value)) {
      endInput.value = startInput.value;
    }
    prevStart = startInput.value;
    update();
  });
  endInput.addEventListener('input', update);
  endInput.addEventListener('change', update);
  update();
  return {
    startInput,
    endInput,
    hint,
    check() {
      if (!ISO_RE.test(startInput.value)) return 'Geçerli bir başlangıç tarihi seçin.';
      if (!ISO_RE.test(endInput.value)) return 'Geçerli bir bitiş tarihi seçin.';
      if (endInput.value < startInput.value) return 'Bitiş tarihi başlangıç tarihinden önce olamaz.';
      if (daysBetween(startInput.value, endInput.value) > 365) return 'Bir seyahat en fazla 365 gün olabilir.';
      return null;
    },
  };
}

// ---------- Kısa tarih gösterimleri ----------
export const AY_KISA = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
export const GUN_KISA = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

const parts = (iso) => iso.split('-').map(Number);
export const weekdayIndex = (iso) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7; // 0 = pazartesi

// "21 Eki" (farklı yılsa "21 Eki 2027")
export function shortDate(iso, withYear = false) {
  const [y, m, d] = parts(iso);
  return `${d} ${AY_KISA[m - 1]}${withYear ? ` ${y}` : ''}`;
}

// "21–23 Eki", "30 Eki – 2 Kas", tek günse "21 Eki"; içinde bulunulan yıldan farklıysa yıl eklenir.
export function rangeLabel(t) {
  const end = t.endDate || t.date;
  const [y1, m1, d1] = parts(t.date);
  const [y2, m2, d2] = parts(end);
  const year = new Date().getFullYear();
  const tail = y2 !== year ? ` ${y2}` : '';
  if (end === t.date) return `${d1} ${AY_KISA[m1 - 1]}${tail}`;
  if (y1 === y2 && m1 === m2) return `${d1}–${d2} ${AY_KISA[m2 - 1]}${tail}`;
  return `${d1} ${AY_KISA[m1 - 1]}${y1 !== y2 ? ` ${y1}` : ''} – ${d2} ${AY_KISA[m2 - 1]}${tail}`;
}

export const firstName = (name) => String(name).split(/\s+/)[0];
