// Özet: kişi başına seyahat ve gün sayıları (planlanan / gerçekleşen / oran) ve aylara göre gün dağılımı.
// Döneme taşan seyahatlerin yalnızca dönem içindeki günleri sayılır.
import { el, MONTHS, daysBetween, isOverdue } from './ortak.js';

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

const ratio = (s) => (s.days ? Math.round((s.doneDays / s.days) * 100) : 0);

function dayCell(days, trips, extra) {
  return el('td', { class: 'num' },
    el('span', { class: 'big', text: days ? `${days} gün` : '—' }),
    trips ? el('span', { class: 'sub', text: `${trips} seyahat` }) : null,
    extra || null);
}

function ratioCell(s) {
  if (!s.days) return el('td', { class: 'ratio-cell' }, el('span', { class: 'muted', text: '—' }));
  const pct = ratio(s);
  const fill = el('span', { class: 'bar-fill' });
  fill.style.width = `${pct}%`; // CSSOM ataması CSP'ye takılmaz (satır içi style özniteliği değildir)
  return el('td', { class: 'ratio-cell' },
    el('div', { class: 'ratio' },
      el('div', { class: 'bar', role: 'img', 'aria-label': `Yüzde ${pct} gerçekleşti` }, fill),
      el('span', { class: 'pct', text: `%${pct}` })));
}

function statRow(label, s, { isTotal = false, onClick } = {}) {
  const name = onClick && !isTotal
    ? el('button', { type: 'button', class: 'link-name', text: label, onclick: onClick })
    : el('span', { text: label });
  return el('tr', { class: isTotal ? 'total-row' : '' },
    el('th', { scope: 'row' }, name),
    el('td', { class: 'num' }, el('span', { class: 'big', text: String(s.trips || '—') })),
    dayCell(s.days, 0),
    dayCell(s.doneDays, s.doneTrips),
    dayCell(s.planDays, s.planTrips, s.overdue ? el('span', { class: 'sub warn', text: `${s.overdue} tarihi geçti` }) : null),
    ratioCell(s));
}

function monthlyTable(trips, people, year) {
  const months = Array.from({ length: 12 }, (_, i) => period(year, i + 1));
  const cell = (n) => el('td', { class: `num${n ? '' : ' zero'}`, text: n ? String(n) : '·' });
  const rowFor = (label, list, isTotal) => {
    const perMonth = months.map(({ from, to }) => list.reduce((sum, t) => sum + daysWithin(t, from, to), 0));
    return el('tr', { class: isTotal ? 'total-row' : '' },
      el('th', { scope: 'row', text: label }),
      perMonth.map(cell),
      el('td', { class: 'num strong', text: String(perMonth.reduce((a, b) => a + b, 0)) }));
  };
  return el('div', { class: 'card summary-card' },
    el('div', { class: 'summary-scroll' },
      el('table', { class: 'summary monthly' },
        el('thead', {}, el('tr', {},
          el('th', { scope: 'col', text: 'Kişi' }),
          AY_KISA.map((m) => el('th', { scope: 'col', class: 'num', text: m })),
          el('th', { scope: 'col', class: 'num', text: 'Toplam' }))),
        el('tbody', {},
          people.map((p) => rowFor(p.name, trips.filter((t) => t.personId === p.id), false)),
          rowFor('Toplam', trips, true)))));
}

export function renderSummary({ year, month, trips, people, onYear, onMonth, onPerson }) {
  const { from, to } = period(year, month);
  const { rows, total } = summarize(trips, people, from, to);
  const label = month ? `${MONTHS[month - 1]} ${year}` : String(year);
  const thisYear = new Date().getFullYear();

  const bar = el('div', { class: 'weekplan-bar' },
    el('div', { class: 'month-nav' },
      el('button', { type: 'button', class: 'btn btn-icon', 'aria-label': 'Önceki yıl', text: '‹', onclick: () => onYear(year - 1) }),
      el('span', { class: 'month-label', text: String(year) }),
      el('button', { type: 'button', class: 'btn btn-icon', 'aria-label': 'Sonraki yıl', text: '›', onclick: () => onYear(year + 1) })),
    el('select', { class: 'period-select', 'aria-label': 'Dönem', onchange: (ev) => onMonth(Number(ev.target.value)) },
      el('option', { value: '0', text: 'Tüm yıl', selected: !month }),
      MONTHS.map((m, i) => el('option', { value: String(i + 1), text: m, selected: month === i + 1 }))),
    year === thisYear ? null : el('button', { type: 'button', class: 'btn btn-ghost-dark', text: 'Bu yıla dön', onclick: () => onYear(thisYear) }));

  const section = el('section', { class: 'summary-view', 'aria-label': `${label} özeti` }, bar);
  if (!total.trips) {
    section.append(el('div', { class: 'card empty' }, el('p', { class: 'muted', text: `${label} için kayıtlı seyahat yok.` })));
    return section;
  }

  section.append(
    el('h2', { class: 'summary-title', text: `${label} · kişi bazında seyahat günleri` }),
    el('div', { class: 'card summary-card' },
      el('div', { class: 'summary-scroll' },
        el('table', { class: 'summary' },
          el('thead', {}, el('tr', {},
            el('th', { scope: 'col', text: 'Kişi' }),
            el('th', { scope: 'col', class: 'num', text: 'Seyahat' }),
            el('th', { scope: 'col', class: 'num', text: 'Toplam gün' }),
            el('th', { scope: 'col', class: 'num', text: 'Gerçekleşen' }),
            el('th', { scope: 'col', class: 'num', text: 'Bekleyen plan' }),
            el('th', { scope: 'col', text: 'Gerçekleşme' }))),
          el('tbody', {}, people.map((p) => statRow(p.name, rows.get(p.id), { onClick: () => onPerson(p.id) }))),
          el('tfoot', {}, statRow('Toplam', total, { isTotal: true }))))),
    el('p', { class: 'muted small summary-note', text: 'Gerçekleşme: gerçekleşen günlerin toplam günlere oranı. Döneme taşan seyahatlerin yalnızca dönem içindeki günleri sayılır.' }));

  if (!month) {
    section.append(el('h2', { class: 'summary-title', text: `${year} · aylara göre seyahat günleri` }), monthlyTable(trips, people, year));
  }
  return section;
}
