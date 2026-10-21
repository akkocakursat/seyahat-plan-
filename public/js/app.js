import {
  el, clear, api, setCsrf, ApiError, STATUS_LABEL, ROLE_LABEL, currentMonth, monthKey, monthLabel,
  renderMonthBar, sortTrips, todayISO, regionTag, dateText, formatDate, MONTHS,
} from './ortak.js';

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
};

const canEdit = () => state.user && (state.user.role === 'admin' || state.user.role === 'editor');
const isAdmin = () => state.user?.role === 'admin';
const person = (id) => state.people.find((p) => p.id === id);
const tripsOf = (status, personId) =>
  state.trips.filter((t) => t.status === status && (personId === undefined || t.personId === personId));

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
    location.assign('/giris');
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

async function refresh() {
  try {
    await loadMonth();
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
    await loadMonth();
  } catch (err) {
    handleError(err);
  } finally {
    state.busy = false;
    render();
  }
}

// ---------- Görünüm ----------
function render() {
  renderSidebar();
  renderMonthBar($('monthbar'), state.month, (m) => {
    state.month = m;
    state.editingId = null;
    state.confirmDeleteId = null;
    refresh();
  });
  const view = clear($('view'));
  if (state.personId && person(state.personId)) view.append(renderPerson());
  else {
    state.personId = null;
    view.append(renderCards());
  }
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
        ? el('ul', { class: 'mini-list' }, trips.slice(0, 3).map((t) => el('li', {}, dateText(t.date), regionTag(t.region))))
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
  return `${location.origin}/kisi/${p.shareKey}`;
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
  const date = el('input', { name: 'date', type: 'date', required: true, min: '2000-01-01', max: '2100-12-31', value: editing?.date ?? defaultDate() });
  const note = el('textarea', { name: 'note', maxLength: 500, rows: 2, value: editing?.note ?? '' });
  const error = el('p', { class: 'form-error', role: 'alert', hidden: true });

  const form = el('form', { class: `card trip-form${editing ? ' is-editing' : ''}`, novalidate: true },
    el('h3', { class: 'form-title', text: editing ? 'Kaydı düzenle' : `Yeni ${STATUS_LABEL[state.status].toLocaleLowerCase('tr')} kayıt` }),
    el('div', { class: 'form-grid' },
      el('label', { class: 'field' }, el('span', { text: 'Kişi' }), personSelect),
      el('label', { class: 'field' }, el('span', { text: 'Bölge' }), region),
      el('label', { class: 'field' }, el('span', { text: 'Tarih' }), date),
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
      date: date.value,
      note: note.value.trim(),
    };
    const problem = !payload.region ? 'Bölge boş olamaz.'
      : [...payload.region].length > 80 ? 'Bölge en fazla 80 karakter olabilir.'
        : !/^\d{4}-\d{2}-\d{2}$/.test(payload.date) ? 'Geçerli bir tarih seçin.'
          : [...payload.note].length > 500 ? 'Not en fazla 500 karakter olabilir.' : null;
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
  const today = todayISO();
  const edit = canEdit();
  const head = el('tr', {}, el('th', { scope: 'col', text: 'Bölge' }), el('th', { scope: 'col', text: 'Tarih' }),
    el('th', { scope: 'col', text: 'Not' }), edit ? el('th', { scope: 'col', class: 'col-actions', text: 'İşlemler' }) : null);
  const body = el('tbody');
  for (const t of trips) {
    const overdue = t.status === 'planned' && t.date < today;
    body.append(el('tr', { class: `${overdue ? 'is-overdue' : ''}${state.editingId === t.id ? ' is-editing' : ''}` },
      el('td', { 'data-label': 'Bölge' }, regionTag(t.region)),
      el('td', { 'data-label': 'Tarih' }, el('span', {}, dateText(t.date), overdue ? el('span', { class: 'badge-overdue', text: 'Tarihi geçti' }) : null)),
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
    if (err instanceof ApiError && err.status === 401) return location.replace('/giris');
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
    location.replace('/giris');
  });
  try {
    await loadMonth();
  } catch (err) {
    handleError(err);
  }
  $('loading').hidden = true;
  $('layout').hidden = false;
  render();
}

init();
