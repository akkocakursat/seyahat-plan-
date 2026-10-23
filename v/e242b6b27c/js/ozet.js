// Özet: kişi başına seyahat ve gün sayıları (planlanan / gerçekleşen / oran) ve aylara göre gün dağılımı.
// Döneme taşan seyahatlerin yalnızca dönem içindeki günleri sayılır.
import { el, MONTHS, daysBetween, isOverdue, firstName } from './ortak.js';

const AY_KISA = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const pad = (n) => String(n).padStart(2, '0');

function period(year, month) {
  if (!month) return { from: `${year}-01-01`, to: `${year}-12-31` };
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` };
}

// Seyahatin [from, to] aralığına düşen gün sayısı.
export function daysWithin(t, from, to) {
  const start = t.date > from ? t.date : from;
  const end = (t.endDate || t.date) < to ? (t.endDate || t.date) : to;
  return start > end ? 0 : daysBetween(start, end);
}

function emptyStats() {
  return { trips: 0, days: 0, doneTrips: 0, doneDays: 0, planTrips: 0, planDays: 0, overdue: 0 };
}

export function summarize(trips, people, from, to) {
  const rows = new Map(people.map((p) => [p.id, emptyStats()]));
  const total = emptyStats();
  for (const t of trips) {
    const d = daysWithin(t, from, to);
    const r = rows.get(t.personId);
    if (!d || !r) continue;
    for (const s of [r, total]) {
      s.trips += 1;
      s.days += d;
      if (t.status === 'done') { s.doneTrips += 1; s.doneDays += d; } else { s.planTrips += 1; s.planDays += d; }
      if (isOverdue(t)) s.overdue += 1;
    }
  }
  return { rows, total };
}

const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);

// Kişileri karşılaştıran çubuk: uzunluk en çok gün yapan kişiye göre; yeşil gerçekleşen, mavi planlanan.
function compareBar(s, maxDays) {
  const wrap = el('div', { class: 'cmp', role: 'img', 'aria-label': `${s.doneDays} gün gerçekleşti, ${s.planDays} gün planlı` });
  const done = el('span', { class: 'cmp-done' });
  const plan = el('span', { class: 'cmp-plan' });
  // CSSOM ile genişlik atanır (satır içi style özniteliği değildir, CSP'ye takılmaz).
  done.style.width = `${pct(s.doneDays, maxDays)}%`;
  plan.style.width = `${pct(s.planDays, maxDays)}%`;
  wrap.append(done, plan);
  return wrap;
}

function personRow(p, s, maxDays, onPerson) {
  if (!s.trips) {
    return el('li', { class: 'sum-row is-empty' },
      el('button', { type: 'button', class: 'sum-name', text: p.name, onclick: () => onPerson(p.id) }),
      el('span', { class: 'sum-days' }, el('strong', { text: '0' }), ' gün'),
      el('span', { class: 'sum-meta', text: 'Bu dönemde seyahati yok.' }));
  }
  return el('li', { class: 'sum-row' },
    el('button', { type: 'button', class: 'sum-name', text: p.name, onclick: () => onPerson(p.id) }),
    el('span', { class: 'sum-days' }, el('strong', { text: String(s.days) }), ' gün'),
    compareBar(s, maxDays),
    el('span', { class: 'sum-meta' },
      el('span', { class: 'm-done', text: `${s.doneDays} gün gerçekleşti` }),
      el('span', { class: 'm-plan', text: `${s.planDays} gün planlı` }),
      el('span', { text: `${s.trips} seyahat` }),
      s.overdue ? el('span', { class: 'm-overdue', text: `${s.overdue} seyahatin tarihi geçti` }) : null));
}

function monthlyTable(trips, people, year) {
  const months = Array.from({ length: 12 }, (_, i) => period(year, i + 1));
  const rowFor = (label, list, isTotal) => {
    const perMonth = months.map(({ from, to }) => list.reduce((sum, t) => sum + daysWithin(t, from, to), 0));
    return el('tr', { class: isTotal ? 'is-total' : '' },
      el('th', { scope: 'row', text: label }),
      perMonth.map((n) => el('td', { class: n ? '' : 'zero', text: n ? String(n) : '·' })),
      el('td', { class: 'strong', text: String(perMonth.reduce((a, b) => a + b, 0)) }));
  };
  return el('div', { class: 'month-table' },
    el('table', {},
      el('caption', { text: `${year} yılında aylara göre seyahat günleri` }),
      el('thead', {}, el('tr', {},
        el('th', { scope: 'col', text: 'Kişi' }),
        AY_KISA.map((m) => el('th', { scope: 'col', text: m })),
        el('th', { scope: 'col', text: 'Toplam' }))),
      el('tbody', {},
        people.map((p) => rowFor(firstName(p.name), trips.filter((t) => t.personId === p.id), false)),
        rowFor('Toplam', trips, true))));
}

export function renderSummary({ year, month, trips, people, onYear, onMonth, onPerson }) {
  const { from, to } = period(year, month);
  const { rows, total } = summarize(trips, people, from, to);
  const label = month ? `${MONTHS[month - 1]} ${year}` : String(year);
  const thisYear = new Date().getFullYear();

  const bar = el('div', { class: 'toolbar' },
    el('div', { class: 'stepper' },
      el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Önceki yıl', text: '‹', onclick: () => onYear(year - 1) }),
      el('span', { class: 'stepper-value', text: String(year) }),
      el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Sonraki yıl', text: '›', onclick: () => onYear(year + 1) })),
    el('select', { class: 'select', 'aria-label': 'Dönem', onchange: (ev) => onMonth(Number(ev.target.value)) },
      el('option', { value: '0', text: 'Tüm yıl', selected: !month }),
      MONTHS.map((m, i) => el('option', { value: String(i + 1), text: m, selected: month === i + 1 }))),
    year === thisYear ? null : el('button', { type: 'button', class: 'text-btn', text: 'Bu yıla dön', onclick: () => onYear(thisYear) }));

  const view = el('div', { class: 'summary' }, bar);
  if (!total.trips) {
    view.append(el('div', { class: 'empty' }, el('p', { text: `${label} için kayıtlı seyahat yok.` })));
    return view;
  }

  const maxDays = Math.max(...people.map((p) => rows.get(p.id).days), 1);
  view.append(
    el('p', { class: 'sum-lead' },
      `${label}: toplam `,
      el('strong', { text: `${total.days} gün` }),
      ` seyahat (${total.trips} seyahat). Bunun ${total.doneDays} günü gerçekleşti, ${total.planDays} günü planlı.`),
    el('ul', { class: 'sum-list' }, people.map((p) => personRow(p, rows.get(p.id), maxDays, onPerson))),
    el('p', { class: 'hint', text: 'Döneme taşan seyahatlerin yalnızca dönem içindeki günleri sayılır. Bir kişiye dokunun, seyahatleri açılsın.' }));
  if (!month) view.append(monthlyTable(trips, people, year));
  return view;
}
