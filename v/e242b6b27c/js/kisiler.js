// Kişiler: bu yılki seyahat günleri, sıradaki seyahat ve seyahatlerine geçiş.
import { el, todayISO, rangeLabel } from './ortak.js';
import { daysWithin } from './ozet.js';

export function renderPeople({ people, trips, selfId, onShowTrips }) {
  const year = new Date().getFullYear();
  const today = todayISO();

  const rows = people.map((p) => {
    const mine = trips.filter((t) => t.personId === p.id);
    const days = mine.reduce((s, t) => s + daysWithin(t, `${year}-01-01`, `${year}-12-31`), 0);
    const next = mine.filter((t) => t.status === 'planned' && (t.endDate || t.date) >= today)
      .sort((a, b) => (a.date < b.date ? -1 : 1))[0];

    return el('li', { class: 'person' },
      el('div', { class: 'person-head' },
        el('h3', { text: p.name }),
        el('span', { class: 'person-days' }, el('strong', { text: String(days) }), ` gün (${year})`)),
      el('p', { class: 'person-next' }, next
        ? `Sıradaki: ${next.region}, ${rangeLabel(next)}`
        : 'Planlanmış seyahati yok.'),
      el('div', { class: 'person-actions' },
        el('button', { type: 'button', class: 'btn btn-quiet', text: p.id === selfId ? 'Seyahatlerim' : 'Seyahatleri', onclick: () => onShowTrips(p.id) })));
  });

  return el('div', { class: 'people-view' }, el('ul', { class: 'people' }, rows));
}
