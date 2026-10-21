import {
  el, clear, api, ApiError, STATUS_LABEL, currentMonth, monthKey, monthLabel, renderMonthBar, sortTrips, regionTag, dateText,
} from './ortak.js';

const $ = (id) => document.getElementById(id);
const key = location.pathname.split('/').filter(Boolean)[1] || '';

const state = { month: currentMonth(), status: 'planned', name: '', trips: [] };

function showMessage(text) {
  $('share-tools').hidden = true;
  clear($('view')).append(el('div', { class: 'card empty' }, el('p', { class: 'notice', text })));
}

async function load() {
  try {
    const data = await api('GET', `/api/paylasim/${encodeURIComponent(key)}?ay=${monthKey(state.month)}`);
    state.name = data.name;
    state.trips = data.kayitlar;
    render();
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) showMessage('Bu link geçersiz ya da yenilenmiş.');
    else if (err instanceof ApiError && err.status === 429) showMessage('Çok fazla istek yapıldı. Lütfen bir dakika sonra tekrar deneyin.');
    else showMessage(err.message);
  }
}

function render() {
  $('person-name').textContent = state.name;
  document.title = `${state.name} · Seyahat Defteri`;
  $('share-tools').hidden = false;

  const toggle = clear($('status-toggle'));
  for (const s of ['planned', 'done']) {
    const n = state.trips.filter((t) => t.status === s).length;
    toggle.append(el('button', {
      type: 'button', class: `seg-btn seg-${s}${state.status === s ? ' is-active' : ''}`, 'aria-pressed': String(state.status === s),
      onclick: () => { state.status = s; render(); },
    }, STATUS_LABEL[s], el('span', { class: 'count', text: String(n) })));
  }
  renderMonthBar($('monthbar'), state.month, (m) => { state.month = m; load(); });

  const trips = sortTrips(state.trips.filter((t) => t.status === state.status), state.status);
  const view = clear($('view'));
  view.append(el('h2', { class: 'section-title', text: `${STATUS_LABEL[state.status]} · ${monthLabel(state.month)}` }));
  if (!trips.length) {
    view.append(el('div', { class: 'card empty' }, el('p', { class: 'muted', text: 'Bu ay için kayıt yok.' })));
    return;
  }
  view.append(el('div', { class: 'card table-card' }, el('table', { class: 'trips' },
    el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: 'Bölge' }), el('th', { scope: 'col', text: 'Tarih' }), el('th', { scope: 'col', text: 'Not' }))),
    el('tbody', {}, trips.map((t) => el('tr', {},
      el('td', { 'data-label': 'Bölge' }, regionTag(t.region)),
      el('td', { 'data-label': 'Tarih' }, dateText(t.date)),
      el('td', { 'data-label': 'Not', class: 'note' }, t.note || el('span', { class: 'muted', text: '—' }))))))));
}

if (!/^[A-Za-z0-9_-]{32}$/.test(key)) showMessage('Bu link geçersiz ya da yenilenmiş.');
else load();
