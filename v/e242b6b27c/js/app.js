// Seyahat Defteri — ana sayfa. Dört bölüm: Seyahatler, Yıl, Özet, Kişiler.
// Kullanıcı verisi DOM'a yalnızca textContent / createElement ile yazılır.
import { el, clear, api, setCsrf, ApiError, ROLE_LABEL, yollar, todayISO, firstName } from './ortak.js';
import { toast } from './sheet.js';
import { fold } from './sehirler.js';
import { openTripForm, openTripDetail } from './form.js';
import { renderTripList } from './liste.js';
import { renderYearGrid, scrollToCurrentWeek, weekDays } from './hafta.js';
import { renderSummary } from './ozet.js';
import { renderPeople } from './kisiler.js';

const $ = (id) => document.getElementById(id);

function readPref(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function writePref(key, value) {
  try { localStorage.setItem(key, value); } catch { /* depolama kapalı */ }
}

// ---------- Simgeler (SVG, DOM ile) ----------
const NS = 'http://www.w3.org/2000/svg';
function icon(paths) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'ico');
  for (const d of paths) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}
const ICONS = {
  seyahatler: ['M4 7h16', 'M4 12h16', 'M4 17h10'],
  yil: ['M5 5h14v15H5z', 'M5 10h14', 'M9 3v4', 'M15 3v4'],
  ozet: ['M6 20V11', 'M12 20V5', 'M18 20v-6'],
  kisiler: ['M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', 'M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5'],
  ekle: ['M12 5v14', 'M5 12h14'],
};

const VIEWS = [
  { key: 'seyahatler', label: 'Seyahatler' },
  { key: 'yil', label: 'Yıl' },
  { key: 'ozet', label: 'Özet' },
  { key: 'kisiler', label: 'Kişiler' },
];

const state = {
  user: null,
  people: [],
  trips: [],
  view: VIEWS.some((v) => v.key === readPref('seyahat_bolum', '')) ? readPref('seyahat_bolum', '') : 'seyahatler',
  status: 'planned',
  personId: null,
  year: new Date().getFullYear(),
  sumMonth: 0,
  scrollToWeek: true,
  selfId: null, // giriş yapan kullanıcının kişi kaydı (kullanıcı adı = kişinin adı, ör. kursat → Kürşat Akkoca)
  filterSet: false,
};

const canEdit = () => state.user && (state.user.role === 'admin' || state.user.role === 'editor');
const isAdmin = () => state.user?.role === 'admin';
// Herkes kendi seyahatini ekler ve yönetir; yönetici herkesinkini yönetebilir.
const canManage = (t) => canEdit() && (isAdmin() || state.selfId === null || t.personId === state.selfId);
const canAddFor = (personId) => canEdit() && (state.selfId === null || personId === state.selfId);

function findSelf() {
  const key = fold(state.user?.username ?? '');
  return state.people.find((p) => fold(firstName(p.name)) === key || fold(p.name) === key)?.id ?? null;
}

function handleError(err) {
  if (err instanceof ApiError && err.status === 401) {
    location.assign(yollar.giris);
    return;
  }
  toast(err.message || 'İşlem tamamlanamadı. Bağlantınızı kontrol edip tekrar deneyin.', 'error');
}

// ---------- Veri ----------
async function load() {
  const [kisiler, kayitlar] = await Promise.all([api('GET', '/api/kisiler'), api('GET', '/api/kayitlar')]);
  state.people = kisiler.kisiler;
  state.trips = kayitlar.kayitlar;
  state.selfId = findSelf();
  // İlk açılışta liste kişinin kendi seyahatlerini gösterir.
  if (!state.filterSet) { state.personId = state.selfId; state.filterSet = true; }
}

// Bir değişiklik: hata panelde gösterilsin diye fırlatılır; başarıda veri yenilenir ve bildirim çıkar.
async function change(fn, message, undo) {
  try {
    await fn();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) handleError(err);
    throw err;
  }
  try { await load(); } catch (err) { handleError(err); }
  render();
  if (message) toast(message, 'ok', undo);
}

const actions = {
  create: (list, progress) => change(async () => {
    let done = 0;
    for (const payload of list) {
      try {
        await api('POST', '/api/kayitlar', payload);
      } catch (err) {
        if (done) { await load().catch(() => {}); render(); }
        throw new ApiError(err.status, done ? `${done} seyahat kaydedildi, sonrakinde hata oluştu: ${err.message}` : err.message);
      }
      done += 1;
      progress?.(done);
    }
  }, list.length > 1 ? `${list.length} seyahat kaydedildi.` : `${list[0].region} seyahati kaydedildi.`),
  update: (t, payload) => change(() => api('PATCH', `/api/kayitlar/${t.id}`, payload), 'Değişiklikler kaydedildi.'),
  status: (t, status) => change(() => api('PATCH', `/api/kayitlar/${t.id}`, { status }),
    status === 'done' ? `${t.region} gerçekleşti olarak işaretlendi.` : `${t.region} yeniden planlandı.`),
  remove: (t) => change(() => api('DELETE', `/api/kayitlar/${t.id}`), `${t.region} seyahati silindi.`),
};

function quickDone(t) {
  change(() => api('PATCH', `/api/kayitlar/${t.id}`, { status: 'done' }), `${t.region} gerçekleşti olarak işaretlendi.`, {
    label: 'Geri al',
    run: () => change(() => api('PATCH', `/api/kayitlar/${t.id}`, { status: 'planned' }), 'Geri alındı.').catch(handleError),
  }).catch(handleError);
}

function addTrip(defaults = {}) {
  openTripForm({
    people: state.people,
    selfId: state.selfId,
    allTrips: state.trips,
    defaults,
    onCreate: actions.create,
  });
}

function openTrip(t) {
  openTripDetail({
    trip: t,
    people: state.people,
    editable: canManage(t),
    allTrips: state.trips,
    onStatus: actions.status,
    onUpdate: actions.update,
    onDelete: actions.remove,
    onShowPerson: state.view === 'seyahatler' && state.personId ? null : (id) => showTripsOf(id),
  });
}

function showTripsOf(personId) {
  state.personId = personId;
  state.status = 'planned';
  go('seyahatler');
}

// ---------- Görünüm ----------
function go(view) {
  if (state.view !== view) {
    state.view = view;
    writePref('seyahat_bolum', view);
    if (view === 'yil') state.scrollToWeek = true;
    window.scrollTo(0, 0);
  }
  render();
}

function renderTabs() {
  clear($('tabs')).append(...VIEWS.map((v) => el('button', {
    type: 'button', class: `tab${state.view === v.key ? ' is-on' : ''}`, 'aria-current': state.view === v.key ? 'page' : null,
    onclick: () => go(v.key),
  }, icon(ICONS[v.key]), el('span', { text: v.label }))));
}

function render() {
  renderTabs();
  $('fab').hidden = !canEdit();
  const view = $('view');
  const keepScroll = view.querySelector('.yg-scroll')?.scrollTop;
  clear(view);

  if (state.view === 'seyahatler') {
    view.append(renderTripList({
      trips: state.trips,
      people: state.people,
      status: state.status,
      personId: state.personId,
      selfId: state.selfId,
      canManage,
      canAdd: canEdit(),
      onStatus: (s) => { state.status = s; render(); },
      onPerson: (id) => { state.personId = id; render(); },
      onOpen: openTrip,
      onQuickDone: quickDone,
      onAdd: () => addTrip(),
    }));
  } else if (state.view === 'yil') {
    view.append(renderYearGrid({
      year: state.year,
      trips: state.trips,
      people: state.people,
      canAddFor,
      onYear: (y) => { state.year = y; state.scrollToWeek = true; render(); },
      onAdd: (personId, week) => {
        const days = weekDays(state.year, week);
        const today = todayISO();
        addTrip({ personId, date: days.includes(today) ? today : days[0] });
      },
      onOpen: openTrip,
    }));
    if (state.scrollToWeek) {
      state.scrollToWeek = false;
      requestAnimationFrame(() => scrollToCurrentWeek(view));
    } else if (keepScroll) {
      view.querySelector('.yg-scroll').scrollTop = keepScroll;
    }
  } else if (state.view === 'ozet') {
    view.append(renderSummary({
      year: state.year,
      month: state.sumMonth,
      trips: state.trips,
      people: state.people,
      onYear: (y) => { state.year = y; render(); },
      onMonth: (m) => { state.sumMonth = m; render(); },
      onPerson: showTripsOf,
    }));
  } else {
    view.append(renderPeople({
      people: state.people,
      trips: state.trips,
      selfId: state.selfId,
      onShowTrips: showTripsOf,
    }));
  }
}

// ---------- Başlangıç ----------
async function init() {
  let session;
  try {
    session = await api('GET', '/api/oturum');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) { location.replace(yollar.giris); return; }
    $('loading').textContent = err.message;
    return;
  }
  state.user = session.user;
  setCsrf(session.csrfToken);
  $('me-name').textContent = session.user.username;
  $('me-role').textContent = ROLE_LABEL[session.user.role] || session.user.role;
  $('me').hidden = false;
  $('logout').addEventListener('click', async () => {
    try { await api('POST', '/api/cikis'); } catch { /* yine de çık */ }
    location.replace(yollar.giris);
  });
  $('fab').prepend(icon(ICONS.ekle));
  $('fab').addEventListener('click', () => addTrip());
  try {
    await load();
  } catch (err) {
    handleError(err);
  }
  $('loading').hidden = true;
  $('main').hidden = false;
  render();
}

init();
