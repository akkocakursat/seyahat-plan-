// Seyahatler listesi: kişi filtresi, Planlanan / Gerçekleşen, haftalara (planlanan) ya da aylara (gerçekleşen) göre gruplar.
import { el, todayISO, tripDays, isOverdue, rangeLabel, firstName, AY_KISA, MONTHS } from './ortak.js';
import { isoWeekOf, weekRange } from './hafta.js';

const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.id ?? 0) - (b.id ?? 0));

// Tek seyahat satırı: solda biniş kartı koçanı gibi tarih, sağda yer ve kişi.
export function tripRow(t, { person, onOpen, action } = {}) {
  const [, m, d] = t.date.split('-').map(Number);
  const state = isOverdue(t) ? 'overdue' : t.status;
  const days = tripDays(t);
  const open = el(onOpen ? 'button' : 'div', {
    type: onOpen ? 'button' : null, class: 'trip-open', onclick: onOpen ? () => onOpen(t) : null,
  },
  el('span', { class: `stub st-${state}`, 'aria-hidden': 'true' },
    el('span', { class: 'stub-day', text: String(d) }),
    el('span', { class: 'stub-mon', text: AY_KISA[m - 1] })),
  el('span', { class: 'trip-main' },
    el('span', { class: 'trip-region', text: t.region }),
    el('span', { class: 'trip-meta' },
      person ? el('span', { class: 'trip-person', text: person.name }) : null,
      el('span', { class: 'trip-when', text: `${rangeLabel(t)}, ${days} gün` })),
    t.note ? el('span', { class: 'trip-note', text: t.note }) : null));
  return el('li', { class: `trip st-${state}` }, open, action || null);
}

function group(title, sub, rows, extraClass = '') {
  return el('section', { class: `group ${extraClass}` },
    el('h3', { class: 'group-title' }, el('span', { text: title }), sub ? el('span', { class: 'group-sub', text: sub }) : null),
    el('ul', { class: 'trips' }, rows));
}

export function renderTripList({ trips, people, status, personId, selfId, canManage, canAdd, onStatus, onPerson, onOpen, onQuickDone, onAdd }) {
  const person = (id) => people.find((p) => p.id === id);
  const mine = personId ? trips.filter((t) => t.personId === personId) : trips;
  const planned = mine.filter((t) => t.status === 'planned');
  const done = mine.filter((t) => t.status === 'done');

  const chips = el('div', { class: 'chips', role: 'group', 'aria-label': 'Kişi' },
    [{ id: null, label: 'Herkes' }, ...people.map((p) => ({ id: p.id, label: p.id === selfId ? 'Ben' : firstName(p.name) }))]
      .sort((a, b) => (a.id === selfId ? -1 : b.id === selfId ? 1 : 0)).map((c) => el('button', {
      type: 'button', class: `chip${personId === c.id ? ' is-on' : ''}`, 'aria-pressed': String(personId === c.id), text: c.label,
      onclick: () => onPerson(c.id),
    })));

  const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Durum' },
    [['planned', 'Planlanan', planned.length], ['done', 'Gerçekleşen', done.length]].map(([key, label, n]) => el('button', {
      type: 'button', class: `seg-btn${status === key ? ' is-on' : ''}`, 'aria-pressed': String(status === key),
      onclick: () => onStatus(key),
    }, label, el('span', { class: 'seg-count', text: String(n) }))));

  const content = [];
  const rowFor = (t, action) => tripRow(t, { person: personId ? null : person(t.personId), onOpen, action });

  if (status === 'planned') {
    const overdue = planned.filter(isOverdue).sort(byDate);
    const upcoming = planned.filter((t) => !isOverdue(t)).sort(byDate);
    if (overdue.length) {
      content.push(group('Tarihi geçti', 'Gerçekleştiyse işaretleyin', overdue.map((t) => rowFor(t, canManage(t)
        ? el('button', { type: 'button', class: 'row-action', text: 'Gerçekleşti', 'aria-label': `${t.region} gerçekleşti`, onclick: () => onQuickDone(t) })
        : null)), 'group-overdue'));
    }
    // Devam eden seyahat bu haftanın grubunda görünür.
    const today = todayISO();
    const now = isoWeekOf(today);
    const groups = new Map();
    for (const t of upcoming) {
      const anchor = t.date < today ? today : t.date;
      const { year, week } = isoWeekOf(anchor);
      const key = `${year}-${String(week).padStart(2, '0')}`;
      if (!groups.has(key)) groups.set(key, { year, week, list: [] });
      groups.get(key).list.push(t);
    }
    for (const g of [...groups.values()].sort((a, b) => a.year - b.year || a.week - b.week)) {
      const nextWeek = isoWeekOf(new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10));
      const title = g.year === now.year && g.week === now.week ? 'Bu hafta'
        : g.year === nextWeek.year && g.week === nextWeek.week ? 'Gelecek hafta'
          : `${g.week}. hafta${g.year !== now.year ? ` (${g.year})` : ''}`;
      content.push(group(title, weekRange(g.year, g.week), g.list.map((t) => rowFor(t))));
    }
  } else {
    const groups = new Map();
    for (const t of [...done].sort((a, b) => -byDate(a, b))) {
      const key = t.date.slice(0, 7);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }
    for (const [key, list] of groups) {
      const [y, m] = key.split('-').map(Number);
      const days = list.reduce((s, t) => s + tripDays(t), 0);
      content.push(group(`${MONTHS[m - 1]} ${y}`, `${list.length} seyahat, ${days} gün`, list.map((t) => rowFor(t))));
    }
  }

  if (!content.length) {
    const who = personId ? firstName(person(personId)?.name ?? '') : null;
    const text = status === 'planned'
      ? `${who ? `${who} için` : 'Henüz'} planlanmış seyahat yok.`
      : `${who ? `${who} için` : 'Henüz'} gerçekleşmiş seyahat yok.`;
    content.push(el('div', { class: 'empty' },
      el('p', { text }),
      canAdd && status === 'planned' ? el('button', { type: 'button', class: 'btn btn-primary', text: 'Seyahat ekle', onclick: onAdd }) : null));
  }

  return el('div', { class: 'list-view' }, el('div', { class: 'filters' }, chips, seg), ...content);
}
