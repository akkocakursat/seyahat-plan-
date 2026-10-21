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

// Veri katmanı: Express sürümünde ./arka-uc.js sunucu API'sine, GitHub Pages sürümünde Supabase'e bağlanır.
export { api, setCsrf, yollar, paylasimAnahtari } from './arka-uc.js';
export { ApiError } from './hata.js';
