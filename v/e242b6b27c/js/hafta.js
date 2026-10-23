// Yıl görünümü: ISO haftaları (1–52/53) satırlarda, kişiler sütunlarda; ayrıca hafta hesapları.
// Kullanıcı verisi yalnızca textContent / createElement ile yazılır.
import { el, todayISO, tripDays, isOverdue, firstName, rangeLabel } from './ortak.js';

const DAY = 86_400_000;
const AY_KISA = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const AY_ADI = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

// ---------- Hafta hesapları (UTC, saat dilimi kaymasız) ----------
const toISO = (d) => d.toISOString().slice(0, 10);
const fromISO = (s) => new Date(`${s}T00:00:00Z`);
const addDays = (d, n) => new Date(d.getTime() + n * DAY);
const weekday = (d) => (d.getUTCDay() + 6) % 7; // 0 = pazartesi

export function isoWeekStart(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  return addDays(jan4, -weekday(jan4) + (week - 1) * 7);
}

export function isoWeekOf(iso) {
  const d = fromISO(iso);
  const thursday = addDays(d, 3 - weekday(d));
  const year = thursday.getUTCFullYear();
  return { year, week: Math.round((thursday - isoWeekStart(year, 1)) / (7 * DAY)) + 1 };
}

export const weeksInYear = (year) => isoWeekOf(`${year}-12-28`).week;

export function yearRange(year) {
  return { bas: toISO(isoWeekStart(year, 1)), bit: toISO(addDays(isoWeekStart(year, weeksInYear(year)), 6)) };
}

export const weekDays = (year, week) => Array.from({ length: 7 }, (_, i) => toISO(addDays(isoWeekStart(year, week), i)));

function weekRangeLabel(year, week) {
  const a = isoWeekStart(year, week);
  const b = addDays(a, 6);
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${a.getUTCDate()}–${b.getUTCDate()} ${AY_KISA[b.getUTCMonth()]}`
    : `${a.getUTCDate()} ${AY_KISA[a.getUTCMonth()]} – ${b.getUTCDate()} ${AY_KISA[b.getUTCMonth()]}`;
}

const tripEnd = (t) => t.endDate || t.date;

// Seyahatin kapsadığı ISO haftaları (çok günlük seyahat birden fazla haftaya yayılabilir).
export function tripWeeks(t) {
  const out = [];
  const first = isoWeekOf(t.date);
  for (let d = isoWeekStart(first.year, first.week); toISO(d) <= tripEnd(t); d = addDays(d, 7)) out.push(isoWeekOf(toISO(d)));
  return out;
}

// "1-5, 35, 37" ya da "1-2-3-4-5-35-37": iki parçalı tire aralık, daha uzun zincir liste sayılır.
export function parseWeeks(text, max) {
  const weeks = new Set();
  for (const token of String(text).split(/[\s,;]+/).filter(Boolean)) {
    if (!/^\d+(-\d+)*$/.test(token)) return { error: `"${token.slice(0, 12)}" anlaşılamadı.` };
    const nums = token.split('-').map(Number);
    if (nums.some((n) => n < 1 || n > max)) return { error: `Hafta numaraları 1–${max} arasında olmalı.` };
    if (nums.length === 2) {
      const [a, b] = nums;
      if (a > b) return { error: `"${token}" aralığı ters.` };
      for (let n = a; n <= b; n += 1) weeks.add(n);
    } else {
      nums.forEach((n) => weeks.add(n));
    }
  }
  return { weeks };
}

// ---------- Yıl ızgarası ----------
export function weekRange(year, week) {
  return weekRangeLabel(year, week);
}

export function renderYearGrid({ year, trips, people, canAddFor, onYear, onAdd, onOpen }) {
  const max = weeksInYear(year);
  const now = isoWeekOf(todayISO());
  const thisYear = new Date().getFullYear();

  // Çok günlük seyahat kapsadığı her haftada görünür; ilk hafta dışındakiler "devam" çizgisidir.
  const byCell = new Map();
  for (const t of trips) {
    tripWeeks(t).forEach((w, i) => {
      if (w.year !== year) return;
      const key = `${t.personId}:${w.week}`;
      if (!byCell.has(key)) byCell.set(key, []);
      byCell.get(key).push({ t, cont: i > 0 });
    });
  }

  const bar = el('div', { class: 'toolbar' },
    el('div', { class: 'stepper' },
      el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Önceki yıl', text: '‹', onclick: () => onYear(year - 1) }),
      el('span', { class: 'stepper-value', text: String(year) }),
      el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Sonraki yıl', text: '›', onclick: () => onYear(year + 1) })),
    year === thisYear ? null : el('button', { type: 'button', class: 'text-btn', text: 'Bu yıla dön', onclick: () => onYear(thisYear) }),
    el('div', { class: 'legend', 'aria-label': 'Renkler' },
      el('span', { class: 'lg lg-planned', text: 'Planlandı' }),
      el('span', { class: 'lg lg-done', text: 'Gerçekleşti' }),
      el('span', { class: 'lg lg-overdue', text: 'Tarihi geçti' })));

  const head = el('tr', {},
    el('th', { scope: 'col', class: 'yg-week', text: 'Hafta' }),
    people.map((p) => el('th', { scope: 'col', class: 'yg-person', title: p.name },
      el('span', { class: 'yg-first', text: firstName(p.name) }),
      el('span', { class: 'yg-full', text: p.name }))));

  const body = el('tbody');
  let lastMonth = -1;
  for (let w = 1; w <= max; w += 1) {
    const month = addDays(isoWeekStart(year, w), 3).getUTCMonth(); // hafta, perşembesinin ayına aittir
    if (month !== lastMonth) {
      lastMonth = month;
      body.append(el('tr', { class: 'yg-month' }, el('th', { colspan: String(people.length + 1), scope: 'colgroup', text: AY_ADI[month] })));
    }
    const isNow = year === now.year && w === now.week;
    const isPast = year < now.year || (year === now.year && w < now.week);
    body.append(el('tr', { class: `yg-row${isNow ? ' is-now' : ''}${isPast ? ' is-past' : ''}`, id: isNow ? 'bu-hafta' : null },
      el('th', { scope: 'row', class: 'yg-week' },
        el('span', { class: 'yg-no', text: String(w) }),
        el('span', { class: 'yg-range', text: weekRangeLabel(year, w) })),
      people.map((p) => {
        const list = (byCell.get(`${p.id}:${w}`) || []).sort((a, b) => (a.t.date < b.t.date ? -1 : a.t.date > b.t.date ? 1 : 0));
        const cell = el('td', { class: 'yg-cell' });
        for (const { t, cont } of list) {
          const state = isOverdue(t) ? 'overdue' : t.status;
          const days = tripDays(t);
          cell.append(el('button', {
            type: 'button',
            class: `yg-trip st-${state}${cont ? ' is-cont' : ''}`,
            title: `${t.region}, ${rangeLabel(t)}, ${days} gün`,
            'aria-label': `${p.name}: ${t.region}, ${rangeLabel(t)}${cont ? ' (devam ediyor)' : ''}`,
            onclick: () => onOpen(t),
          }, el('span', { class: 'yg-region', text: t.region }), !cont && days > 1 ? el('span', { class: 'yg-days', text: `${days}g` }) : null));
        }
        if (canAddFor(p.id)) {
          cell.append(el('button', {
            type: 'button', class: `yg-add${list.length ? ' is-small' : ''}`, 'aria-label': `${p.name} için ${w}. haftaya seyahat ekle`,
            onclick: () => onAdd(p.id, w),
          }, el('span', { 'aria-hidden': 'true', text: '+' })));
        }
        return cell;
      })));
  }

  return el('section', { class: 'year', 'aria-label': `${year} yılı` },
    bar,
    el('div', { class: 'yg-scroll' }, el('table', { class: 'yeargrid' }, el('thead', {}, head), body)));
}

export function scrollToCurrentWeek(root) {
  const row = root.querySelector('#bu-hafta');
  const box = root.querySelector('.yg-scroll');
  if (row && box) box.scrollTop = Math.max(0, row.offsetTop - 120);
}
