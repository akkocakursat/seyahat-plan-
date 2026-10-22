import {
  el, clear, api, setCsrf, ApiError, STATUS_LABEL, ROLE_LABEL, currentMonth, monthKey, monthLabel,
  renderMonthBar, sortTrips, todayISO, regionTag, dateText, formatDate, MONTHS, yollar,
  rangeText, tripDays, isOverdue, dateRangeInputs, daysBadge,
} from './ortak.js';
import {
  renderWeekPlan, scrollToCurrentWeek, openAddDialog, openTripDialog, openBulkDialog, yearRange,
} from './hafta.js';
import { renderSummary } from './ozet.js';

const $ = (id) => document.getElementById(id);

const state = {
  user: null,
  people: [],
  trips: [],
  month: currentMonth(),
  status: 'planned',
  personId: null,
  editingId: null,
  confirmDeleteId: null,
  confirmRenew: false,
  busy: false,
  // Kişi seçili değilken: 'ay' (aylık kartlar) ya da 'hafta' (yıllık hafta planı tablosu)
  view: ['hafta', 'ay', 'ozet'].includes(readPref('seyahat_gorunum', 'hafta')) ? readPref('seyahat_gorunum', 'hafta') : 'hafta',
  sumMonth: 0, // özet dönemi: 0 = tüm yıl, 1–12 = ay
  year: new Date().getFullYear(),
  yearTrips: [],
  yearLoaded: null,
  showDone: readPref('seyahat_gerceklesen', '1') === '1',
};

function readPref(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function writePref(key, value) {
  try { localStorage.setItem(key, value); } catch { /* depolama kapalı */ }
}

const weekMode = () => state.view === 'hafta' && !state.personId;
// Hafta planı ve özet yıllık veriyle çalışır; aylık kartlar ve kişi detayı seçili ayla.
const yearMode = () => state.view !== 'ay' && !state.personId;

const canEdit = () => state.user && (state.user.role === 'admin' || state.user.role === 'editor');
const isAdmin = () => state.user?.role === 'admin';
const person = (id) => state.people.find((p) => p.id === id);
// Hafta görünümünde menüdeki sayılar seçili yılın, aksi halde seçili ayın kayıtlarından hesaplanır.
const tripsOf = (status, personId) =>
  (yearMode() ? state.yearTrips : state.trips)
    .filter((t) => t.status === status && (personId === undefined || t.personId === personId));

// ---------- Bildirim ----------
let flashTimer;
function flash(message, kind = 'ok') {
  const node = $('flash');
  node.textContent = message;
  node.className = `flash flash-${kind}`;
  node.hidden = false;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { node.hidden = true; }, kind === 'error' ? 8000 : 4000);
}

function handleError(err) {
  if (err instanceof ApiError && err.status === 401) {
    location.assign(yollar.giris);
    return;
  }
  flash(err.message || 'Beklenmeyen bir hata oluştu.', 'error');
}

// ---------- Veri ----------
async function loadMonth() {
  const ay = monthKey(state.month);
  const [kisiler, kayitlar] = await Promise.all([
    api('GET', `/api/kisiler?ay=${ay}`),
    api('GET', `/api/kayitlar?ay=${ay}`),
  ]);
  state.people = kisiler.kisiler;
  state.trips = kayitlar.kayitlar;
}

async function loadYear() {
  // ISO hafta yılı ile takvim yılının birleşimi (hafta planı ve özet aynı veriyi kullanır).
  const iso = yearRange(state.year);
  const bas = iso.bas < `${state.year}-01-01` ? iso.bas : `${state.year}-01-01`;
  const bit = iso.bit > `${state.year}-12-31` ? iso.bit : `${state.year}-12-31`;
  const res = await api('GET', `/api/kayitlar?bas=${bas}&bit=${bit}`);
  state.yearTrips = res.kayitlar;
  state.yearLoaded = state.year;
}

async function loadAll() {
  await Promise.all([loadMonth(), state.view !== 'ay' ? loadYear() : null]);
}

async function refresh() {
  try {
    await loadAll();
  } catch (err) {
    handleError(err);
  }
  render();
}

async function mutate(fn, okMessage) {
  if (state.busy) return;
  state.busy = true;
  try {
    const result = await fn();
    if (okMessage) flash(typeof okMessage === 'function' ? okMessage(result) : okMessage);
    await loadAll();
  } catch (err) {
    handleError(err);
  } finally {
    state.busy = false;
    render();
  }
}

// Pencerelerden yapılan işlemler: hata pencerede gösterilsin diye fırlatılır; başarıda veri yenilenir.
async function dialogAction(fn, message) {
  try {
    await fn();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) handleError(err);
    throw err;
  }
  flash(message);
  try { await loadAll(); } catch (err) { handleError(err); }
  render();
}

// ---------- Görünüm ----------
function render() {
  if (state.personId && !person(state.personId)) state.personId = null;
  renderSidebar();
  // Tablo yeniden çizilirken kaydırma konumu korunur (yıl değişince bu haftaya gidilir).
  const keepScroll = $('view').querySelector('.week-scroll')?.scrollTop;
  const view = clear($('view'));
  if (weekMode()) {
    clear($('monthbar'));
    view.append(renderViewTabs(), renderYear());
    if (state.scrollToWeek) {
      state.scrollToWeek = false;
      scrollToCurrentWeek(view);
    } else if (keepScroll) {
      view.querySelector('.week-scroll').scrollTop = keepScroll;
    }
    return;
  }
  if (state.view === 'ozet' && !state.personId) {
    clear($('monthbar'));
    view.append(renderViewTabs(), renderSummaryView());
    return;
  }
  renderMonthBar($('monthbar'), state.month, (m) => {
    state.month = m;
    state.editingId = null;
    state.confirmDeleteId = null;
    refresh();
  });
  if (state.personId) view.append(renderPerson());
  else view.append(renderViewTabs(), renderCards());
}

function renderViewTabs() {
  const tab = (key, label) => el('button', {
    type: 'button', class: `seg-btn${state.view === key ? ' is-active' : ''}`, 'aria-pressed': String(state.view === key), text: label,
    onclick: () => switchView(key),
  });
  return el('div', { class: 'view-tabs segmented', role: 'group', 'aria-label': 'Görünüm' },
    tab('hafta', 'Hafta planı'), tab('ay', 'Aylık'), tab('ozet', 'Özet'));
}

async function switchView(key) {
  if (state.view === key) return;
  state.view = key;
  writePref('seyahat_gorunum', key);
  if (key !== 'ay' && state.yearLoaded !== state.year) {
    try { await loadYear(); } catch (err) { handleError(err); }
  }
  if (key === 'hafta') state.scrollToWeek = true;
  render();
}

function renderSummaryView() {
  return renderSummary({
    year: state.year,
    month: state.sumMonth,
    trips: state.yearTrips,
    people: state.people,
    onYear: async (y) => {
      state.year = y;
      try { await loadYear(); } catch (err) { handleError(err); }
      render();
    },
    onMonth: (m) => { state.sumMonth = m; render(); },
    onPerson: (id) => {
      if (state.sumMonth) state.month = { y: state.year, m: state.sumMonth };
      openPerson(id);
      if (state.sumMonth) refresh();
    },
  });
}

function renderYear() {
  const editable = canEdit();
  return renderWeekPlan({
    year: state.year,
    trips: state.yearTrips,
    people: state.people,
    editable,
    showDone: state.showDone,
    onYear: async (y) => {
      state.year = y;
      try { await loadYear(); } catch (err) { handleError(err); }
      state.scrollToWeek = true;
      render();
    },
    onShowDone: (v) => { state.showDone = v; writePref('seyahat_gerceklesen', v ? '1' : '0'); render(); },
    onAdd: (personId, week) => openAddDialog({
      people: state.people, personId, year: state.year, week,
      onSubmit: (payload) => dialogAction(() => api('POST', '/api/kayitlar', payload), 'Plan eklendi.'),
    }),
    onTrip: (trip) => openTripDialog({
      trip, people: state.people, editable,
      onStatus: (t, status) => dialogAction(() => api('PATCH', `/api/kayitlar/${t.id}`, { status }),
        status === 'done' ? `${formatDate(t.date)} kaydı Gerçekleşen'e taşındı.` : `${formatDate(t.date)} kaydı Planlanan'a alındı.`),
      onUpdate: (t, payload) => dialogAction(() => api('PATCH', `/api/kayitlar/${t.id}`, payload), 'Kayıt güncellendi.'),
      onDelete: (t) => dialogAction(() => api('DELETE', `/api/kayitlar/${t.id}`), 'Kayıt silindi.'),
      onOpenMonth: (t) => {
        const [y, m] = t.date.split('-').map(Number);
        state.month = { y, m };
        state.personId = t.personId;
        state.status = t.status;
        state.editingId = null;
        state.confirmDeleteId = null;
        refresh();
      },
    }),
    onBulk: () => openBulkDialog({
      people: state.people, personId: state.people[0]?.id, year: state.year, trips: state.yearTrips,
      onSubmit: (payload, dates, progress) => dialogAction(async () => {
        let done = 0;
        for (const range of dates) {
          try {
            await api('POST', '/api/kayitlar', { ...payload, ...range, status: 'planned' });
          } catch (err) {
            if (done) { await loadAll().catch(() => {}); render(); }
            throw new ApiError(err.status, `${done} kayıt eklendi, sonra hata oluştu: ${err.message}`);
          }
          done += 1;
          progress(done);
        }
      }, `${dates.length} haftaya plan eklendi.`),
    }),
  });
}

function renderSidebar() {
  const nav = clear($('sidebar'));
  for (const status of ['planned', 'done']) {
    const active = state.status === status;
    nav.append(el('button', {
      type: 'button',
      class: `status-btn status-${status}${active ? ' is-active' : ''}`,
      'aria-pressed': String(active),
      onclick: () => {
        state.status = status;
        state.editingId = null;
        state.confirmDeleteId = null;
        render();
      },
    }, el('span', { class: 'status-name', text: STATUS_LABEL[status] }),
    el('span', { class: 'count', text: String(tripsOf(status).length) })));

    if (active) {
      nav.append(el('ul', { class: 'people-list' }, state.people.map((p) => el('li', {},
        el('button', {
          type: 'button',
          class: `person-btn${state.personId === p.id ? ' is-active' : ''}`,
          'aria-current': state.personId === p.id ? 'true' : null,
          onclick: () => openPerson(p.id),
        }, el('span', { class: 'person-name', text: p.name }),
        el('span', { class: 'count', text: String(tripsOf(status, p.id).length) }))))));
    }
  }
}

function openPerson(id) {
  state.personId = id;
  state.editingId = null;
  state.confirmDeleteId = null;
  state.confirmRenew = false;
  render();
  $('content').scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function renderCards() {
  const grid = el('div', { class: 'cards' });
  for (const p of state.people) {
    const trips = sortTrips(tripsOf(state.status, p.id), state.status);
    grid.append(el('article', { class: `card person-card accent-${state.status}` },
      el('header', { class: 'card-head' },
        el('h3', { text: p.name }),
        el('span', { class: `pill pill-${state.status}`, text: `${trips.length} seyahat` })),
      trips.length
        ? el('ul', { class: 'mini-list' }, trips.slice(0, 3).map((t) => el('li', {}, dateText(t.date), regionTag(t.region), tripDays(t) > 1 ? daysBadge(tripDays(t)) : null)))
        : el('p', { class: 'muted', text: 'Bu ay kayıt yok.' }),
      trips.length > 3 ? el('p', { class: 'muted small', text: `+${trips.length - 3} kayıt daha` }) : null,
      el('button', { type: 'button', class: 'btn btn-link', text: 'Detayları gör ›', onclick: () => openPerson(p.id) })));
  }
  return el('section', { 'aria-label': 'Kişi özetleri' },
    el('h2', { class: 'section-title', text: `${STATUS_LABEL[state.status]} · ${monthLabel(state.month)}` }),
    grid);
}

function renderPerson() {
  const p = person(state.personId);
  const wrap = el('section', { class: 'person-detail' });
  wrap.append(
    el('button', {
      type: 'button', class: 'btn btn-ghost-dark back', text: '‹ Tüm kişiler',
      onclick: () => { state.personId = null; state.editingId = null; render(); },
    }),
    el('div', { class: 'detail-head' },
      el('div', {},
        el('h2', { class: 'person-title', text: p.name }),
        el('p', { class: `subtitle sub-${state.status}`, text: `${STATUS_LABEL[state.status]} · ${monthLabel(state.month)}` })),
      renderLinkTools(p)),
  );
  if (canEdit()) wrap.append(renderForm(p));
  wrap.append(renderTable(p));
  return wrap;
}

function shareUrl(p) {
  return yollar.kisiLinki(p.shareKey);
}

function renderLinkTools(p) {
  if (!canEdit() || !p.shareKey) return null;
  const box = el('div', { class: 'link-tools' });
  box.append(el('button', {
    type: 'button', class: 'btn btn-secondary', text: 'Kişi linkini kopyala',
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(shareUrl(p));
        flash('Kişi linki panoya kopyalandı.');
      } catch {
        showLinkFallback(box, p);
      }
    },
  }));
  if (isAdmin()) {
    if (state.confirmRenew) {
      box.append(el('div', { class: 'inline-confirm', role: 'group', 'aria-label': 'Link yenileme onayı' },
        el('span', { text: 'Eski link hemen geçersiz olacak. Emin misiniz?' }),
        el('button', {
          type: 'button', class: 'btn btn-danger', text: 'Evet, yenile',
          onclick: () => {
            state.confirmRenew = false;
            mutate(() => api('POST', `/api/kisiler/${p.id}/link-yenile`), 'Link yenilendi; eski link artık çalışmıyor.');
          },
        }),
        el('button', { type: 'button', class: 'btn btn-ghost-dark', text: 'Vazgeç', onclick: () => { state.confirmRenew = false; render(); } })));
    } else {
      box.append(el('button', {
        type: 'button', class: 'btn btn-ghost-dark', text: 'Linki yenile',
        onclick: () => { state.confirmRenew = true; render(); },
      }));
    }
  }
  return box;
}

function showLinkFallback(box, p) {
  const input = el('input', { class: 'link-input', readOnly: true, value: shareUrl(p), 'aria-label': 'Kişi linki' });
  box.append(input);
  input.focus();
  input.select();
  flash('Panoya erişilemedi; linki seçili alandan kopyalayabilirsiniz.', 'warn');
}

function defaultDate() {
  const today = todayISO();
  return today.startsWith(monthKey(state.month)) ? today : `${monthKey(state.month)}-01`;
}

function renderForm(p) {
  const editing = state.editingId ? state.trips.find((t) => t.id === state.editingId) : null;
  const personSelect = el('select', { name: 'personId', required: true },
    state.people.map((x) => el('option', { value: String(x.id), text: x.name, selected: (editing ? editing.personId : p.id) === x.id })));
  const region = el('input', { name: 'region', required: true, maxLength: 80, autocomplete: 'off', value: editing?.region ?? '' });
  const dates = dateRangeInputs(editing?.date ?? defaultDate(), editing?.endDate ?? editing?.date ?? defaultDate());
  const note = el('textarea', { name: 'note', maxLength: 500, rows: 2, value: editing?.note ?? '' });
  const error = el('p', { class: 'form-error', role: 'alert', hidden: true });

  const form = el('form', { class: `card trip-form${editing ? ' is-editing' : ''}`, novalidate: true },
    el('h3', { class: 'form-title', text: editing ? 'Kaydı düzenle' : `Yeni ${STATUS_LABEL[state.status].toLocaleLowerCase('tr')} kayıt` }),
    el('div', { class: 'form-grid form-grid-4' },
      el('label', { class: 'field' }, el('span', { text: 'Kişi' }), personSelect),
      el('label', { class: 'field' }, el('span', { text: 'Bölge' }), region),
      el('label', { class: 'field' }, el('span', { text: 'Başlangıç' }), dates.startInput),
      el('label', { class: 'field' }, el('span', {}, 'Bitiş ', dates.hint), dates.endInput),
      el('label', { class: 'field field-wide' }, el('span', { text: 'Not (isteğe bağlı)' }), note)),
    error,
    el('div', { class: 'form-actions' },
      el('button', { type: 'submit', class: 'btn btn-primary', text: editing ? 'Güncelle' : 'Ekle' }),
      editing ? el('button', { type: 'button', class: 'btn btn-ghost-dark', text: 'Vazgeç', onclick: () => { state.editingId = null; render(); } }) : null));

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const payload = {
      personId: Number(personSelect.value),
      region: region.value.trim(),
      date: dates.startInput.value,
      endDate: dates.endInput.value,
      note: note.value.trim(),
    };
    const problem = !payload.region ? 'Bölge boş olamaz.'
      : [...payload.region].length > 80 ? 'Bölge en fazla 80 karakter olabilir.'
        : dates.check() || ([...payload.note].length > 500 ? 'Not en fazla 500 karakter olabilir.' : null);
    if (problem) {
      error.textContent = problem;
      error.hidden = false;
      return;
    }
    const targetMonth = payload.date.slice(0, 7);
    const elsewhere = targetMonth !== monthKey(state.month);
    const monthText = `${MONTHS[Number(targetMonth.slice(5)) - 1]} ${targetMonth.slice(0, 4)}`;
    if (editing) {
      const id = editing.id;
      state.editingId = null;
      mutate(() => api('PATCH', `/api/kayitlar/${id}`, payload),
        elsewhere ? `Kayıt güncellendi ve ${monthText} ayına taşındı.` : 'Kayıt güncellendi.');
    } else {
      mutate(() => api('POST', '/api/kayitlar', { ...payload, status: state.status }),
        elsewhere ? `Kayıt eklendi (${monthText}).` : 'Kayıt eklendi.');
    }
  });
  if (editing) queueMicrotask(() => region.focus());
  return form;
}

function renderTable(p) {
  const trips = sortTrips(tripsOf(state.status, p.id), state.status);
  if (!trips.length) {
    return el('div', { class: 'card empty' }, el('p', { class: 'muted', text: `${monthLabel(state.month)} için ${STATUS_LABEL[state.status].toLocaleLowerCase('tr')} seyahat yok.` }));
  }
  const edit = canEdit();
  const head = el('tr', {}, el('th', { scope: 'col', text: 'Bölge' }), el('th', { scope: 'col', text: 'Tarih' }),
    el('th', { scope: 'col', text: 'Not' }), edit ? el('th', { scope: 'col', class: 'col-actions', text: 'İşlemler' }) : null);
  const body = el('tbody');
  for (const t of trips) {
    const overdue = isOverdue(t);
    body.append(el('tr', { class: `${overdue ? 'is-overdue' : ''}${state.editingId === t.id ? ' is-editing' : ''}` },
      el('td', { 'data-label': 'Bölge' }, regionTag(t.region)),
      el('td', { 'data-label': 'Tarih' }, el('span', {}, rangeText(t), overdue ? el('span', { class: 'badge-overdue', text: 'Tarihi geçti' }) : null)),
      el('td', { 'data-label': 'Not', class: 'note' }, t.note ? t.note : el('span', { class: 'muted', text: '—' })),
      edit ? el('td', { 'data-label': 'İşlemler', class: 'col-actions' }, rowActions(t)) : null));
  }
  return el('div', { class: 'card table-card' }, el('table', { class: 'trips' }, el('thead', {}, head), body));
}

function rowActions(t) {
  if (state.confirmDeleteId === t.id) {
    return el('div', { class: 'inline-confirm', role: 'group', 'aria-label': 'Silme onayı' },
      el('span', { text: 'Silinsin mi?' }),
      el('button', {
        type: 'button', class: 'btn btn-danger btn-sm', text: 'Evet, sil',
        onclick: () => {
          state.confirmDeleteId = null;
          if (state.editingId === t.id) state.editingId = null;
          mutate(() => api('DELETE', `/api/kayitlar/${t.id}`), 'Kayıt silindi.');
        },
      }),
      el('button', { type: 'button', class: 'btn btn-ghost-dark btn-sm', text: 'Vazgeç', onclick: () => { state.confirmDeleteId = null; render(); } }));
  }
  const toDone = t.status === 'planned';
  return el('div', { class: 'row-actions' },
    el('button', {
      type: 'button', class: `btn btn-sm ${toDone ? 'btn-done' : 'btn-planned'}`, text: toDone ? 'Gerçekleşti' : 'Plana al',
      onclick: () => mutate(() => api('PATCH', `/api/kayitlar/${t.id}`, { status: toDone ? 'done' : 'planned' }),
        toDone ? `${formatDate(t.date)} kaydı Gerçekleşen'e taşındı.` : `${formatDate(t.date)} kaydı Planlanan'a alındı.`),
    }),
    el('button', {
      type: 'button', class: 'btn btn-secondary btn-sm', text: 'Düzenle',
      onclick: () => { state.editingId = t.id; state.confirmDeleteId = null; render(); document.querySelector('.trip-form')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); },
    }),
    el('button', { type: 'button', class: 'btn btn-ghost-danger btn-sm', text: 'Sil', onclick: () => { state.confirmDeleteId = t.id; render(); } }));
}

// ---------- Başlangıç ----------
async function init() {
  let session;
  try {
    session = await api('GET', '/api/oturum');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return location.replace(yollar.giris);
    $('loading').textContent = err.message;
    return;
  }
  state.user = session.user;
  setCsrf(session.csrfToken);
  $('who-name').textContent = session.user.username;
  $('who-role').textContent = ROLE_LABEL[session.user.role] || session.user.role;
  $('who').hidden = false;
  $('logout').addEventListener('click', async () => {
    try { await api('POST', '/api/cikis'); } catch { /* yine de çık */ }
    location.replace(yollar.giris);
  });
  try {
    await loadAll();
  } catch (err) {
    handleError(err);
  }
  state.scrollToWeek = true;
  $('loading').hidden = true;
  $('layout').hidden = false;
  render();
}

init();
