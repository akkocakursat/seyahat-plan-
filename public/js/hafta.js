// Yıllık hafta planı: ISO haftaları (1–52/53) satırlarda, kişiler sütunlarda.
// Kullanıcı verisi yalnızca textContent / createElement ile yazılır.
import {
  el, clear, ApiError, STATUS_LABEL, todayISO, formatDate, tripDays, isOverdue, dateRangeInputs, addDaysISO, daysBadge,
} from './ortak.js';

const DAY = 86_400_000;
const GUN_KISA = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const GUN_ADI = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
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

const dayLabel = (iso) => `${GUN_KISA[weekday(fromISO(iso))]} ${formatDate(iso)}`;
const tripEnd = (t) => t.endDate || t.date;
const tripLabel = (t) => (tripEnd(t) === t.date ? dayLabel(t.date) : `${dayLabel(t.date)} – ${dayLabel(tripEnd(t))}`);

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

// ---------- Pencere (dialog) ----------
function openDialog(title, body, { wide = false } = {}) {
  const dlg = el('dialog', { class: `dlg${wide ? ' dlg-wide' : ''}`, 'aria-label': title });
  const close = () => dlg.close();
  dlg.append(el('div', { class: 'dlg-inner' },
    el('div', { class: 'dlg-head' },
      el('h3', { text: title }),
      el('button', { type: 'button', class: 'btn btn-icon dlg-close', 'aria-label': 'Kapat', text: '×', onclick: close })),
    body));
  dlg.addEventListener('click', (ev) => { if (ev.target === dlg) close(); });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

// Form gönderimi: düğmeyi kilitler, hatayı pencere içinde gösterir, başarıda pencereyi kapatır.
async function submitIn(dlg, button, errorNode, fn) {
  button.disabled = true;
  errorNode.hidden = true;
  try {
    await fn();
    dlg.close();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) throw err;
    errorNode.textContent = err.message || 'Beklenmeyen bir hata oluştu.';
    errorNode.hidden = false;
  } finally {
    button.disabled = false;
  }
}

const field = (label, control, extra = '') => el('label', { class: `field ${extra}` }, el('span', { text: label }), control);
const regionInput = (value = '') => el('input', { name: 'region', required: true, maxLength: 80, autocomplete: 'off', value });
const noteInput = (value = '') => el('textarea', { name: 'note', maxLength: 500, rows: 2, value });
const personSelect = (people, selected) => el('select', { name: 'personId' },
  people.map((p) => el('option', { value: String(p.id), text: p.name, selected: p.id === selected })));
const errorBox = () => el('p', { class: 'form-error', role: 'alert', hidden: true });
const rangeEndField = (dates) => el('label', { class: 'field' }, el('span', {}, 'Bitiş ', dates.hint), dates.endInput);

function checkTrip(region, note) {
  if (!region) return 'Bölge boş olamaz.';
  if ([...region].length > 80) return 'Bölge en fazla 80 karakter olabilir.';
  if ([...note].length > 500) return 'Not en fazla 500 karakter olabilir.';
  return null;
}

// Bir kişi için seçili haftaya plan ekleme.
export function openAddDialog({ people, personId, year, week, onSubmit }) {
  const days = weekDays(year, week);
  const today = todayISO();
  const def = days.includes(today) ? today : days[0];
  const who = personSelect(people, personId);
  const dates = dateRangeInputs(def, def);
  const region = regionInput();
  const note = noteInput();
  const error = errorBox();
  const submit = el('button', { type: 'submit', class: 'btn btn-primary', text: 'Plana ekle' });
  const form = el('form', { class: 'dlg-form', novalidate: true },
    el('p', { class: 'dlg-sub', text: `${week}. hafta · ${weekRangeLabel(year, week)} ${year}` }),
    el('div', { class: 'form-grid form-grid-2' }, field('Kişi', who), field('Bölge', region),
      field('Başlangıç', dates.startInput), rangeEndField(dates), field('Not (isteğe bağlı)', note, 'field-wide')),
    error,
    el('div', { class: 'form-actions' }, submit));
  const dlg = openDialog('Seyahat planla', form);
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const payload = {
      personId: Number(who.value), region: region.value.trim(), date: dates.startInput.value, endDate: dates.endInput.value,
      note: note.value.trim(), status: 'planned',
    };
    const problem = checkTrip(payload.region, payload.note) || dates.check();
    if (problem) { error.textContent = problem; error.hidden = false; return; }
    submitIn(dlg, submit, error, () => onSubmit(payload)).catch(() => dlg.close());
  });
  region.focus();
}

// Var olan kaydın ayrıntısı: durum değiştir, düzenle, sil, aylık görünümde aç.
export function openTripDialog({ trip, people, editable, onStatus, onUpdate, onDelete, onOpenMonth }) {
  const who = people.find((p) => p.id === trip.personId);
  const { year, week } = isoWeekOf(trip.date);
  const overdue = isOverdue(trip);
  const body = el('div', { class: 'dlg-form' });
  const dlg = openDialog(trip.region, body);

  const showDetails = () => {
    const error = errorBox();
    const actions = el('div', { class: 'form-actions' });
    clear(body).append(
      el('dl', { class: 'trip-facts' },
        el('dt', { text: 'Kişi' }), el('dd', { text: who ? who.name : '—' }),
        el('dt', { text: 'Tarih' }), el('dd', {},
          el('span', { class: 'mono', text: tripLabel(trip) }), ' ', daysBadge(tripDays(trip)),
          el('span', { class: 'muted small', text: ` · ${week}. hafta ${year}` })),
        el('dt', { text: 'Durum' }), el('dd', {},
          el('span', { class: `pill pill-${trip.status}`, text: STATUS_LABEL[trip.status] }),
          overdue ? el('span', { class: 'badge-overdue', text: 'Tarihi geçti' }) : null),
        el('dt', { text: 'Not' }), el('dd', { class: 'note', text: trip.note || '—' })),
      error, actions);
    if (editable) {
      const toDone = trip.status === 'planned';
      const statusBtn = el('button', { type: 'button', class: `btn ${toDone ? 'btn-done' : 'btn-planned'}`, text: toDone ? 'Gerçekleşti' : 'Plana al' });
      statusBtn.addEventListener('click', () => submitIn(dlg, statusBtn, error, () => onStatus(trip, toDone ? 'done' : 'planned')).catch(() => dlg.close()));
      const delBtn = el('button', { type: 'button', class: 'btn btn-ghost-danger', text: 'Sil' });
      delBtn.addEventListener('click', () => {
        const yes = el('button', { type: 'button', class: 'btn btn-danger btn-sm', text: 'Evet, sil' });
        yes.addEventListener('click', () => submitIn(dlg, yes, error, () => onDelete(trip)).catch(() => dlg.close()));
        actions.replaceChildren(el('div', { class: 'inline-confirm', role: 'group', 'aria-label': 'Silme onayı' },
          el('span', { text: 'Silinsin mi?' }), yes,
          el('button', { type: 'button', class: 'btn btn-ghost-dark btn-sm', text: 'Vazgeç', onclick: showDetails })));
      });
      actions.append(statusBtn, el('button', { type: 'button', class: 'btn btn-secondary', text: 'Düzenle', onclick: showEdit }), delBtn);
    }
    actions.append(el('button', { type: 'button', class: 'btn btn-link', text: 'Aylık görünümde aç ›', onclick: () => { dlg.close(); onOpenMonth(trip); } }));
  };

  const showEdit = () => {
    const sel = personSelect(people, trip.personId);
    const region = regionInput(trip.region);
    const dates = dateRangeInputs(trip.date, tripEnd(trip));
    const note = noteInput(trip.note);
    const error = errorBox();
    const save = el('button', { type: 'submit', class: 'btn btn-primary', text: 'Güncelle' });
    const form = el('form', { novalidate: true },
      el('div', { class: 'form-grid form-grid-2' }, field('Kişi', sel), field('Bölge', region),
        field('Başlangıç', dates.startInput), rangeEndField(dates), field('Not (isteğe bağlı)', note, 'field-wide')),
      error,
      el('div', { class: 'form-actions' }, save, el('button', { type: 'button', class: 'btn btn-ghost-dark', text: 'Vazgeç', onclick: showDetails })));
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const payload = {
        personId: Number(sel.value), region: region.value.trim(), date: dates.startInput.value, endDate: dates.endInput.value,
        note: note.value.trim(),
      };
      const problem = checkTrip(payload.region, payload.note) || dates.check();
      if (problem) { error.textContent = problem; error.hidden = false; return; }
      submitIn(dlg, save, error, () => onUpdate(trip, payload)).catch(() => dlg.close());
    });
    clear(body).append(form);
    region.focus();
  };

  showDetails();
}

// Bir kişiyi birden çok haftaya tek seferde planlama.
export function openBulkDialog({ people, personId, year, trips, onSubmit }) {
  const max = weeksInYear(year);
  const current = isoWeekOf(todayISO());
  const selected = new Set();
  const who = personSelect(people, personId ?? people[0]?.id);
  const region = regionInput();
  const note = noteInput();
  const dayOfWeek = el('select', { name: 'gun' }, GUN_ADI.map((g, i) => el('option', { value: String(i), text: g })));
  const length = el('input', { name: 'gunSayisi', type: 'number', min: '1', max: '365', step: '1', value: '1', inputMode: 'numeric' });
  const weeksText = el('input', { name: 'haftalar', autocomplete: 'off', placeholder: 'Örn. 1-5, 35, 37 ya da 1-2-3-4-5-35-37' });
  const summary = el('p', { class: 'muted small', 'aria-live': 'polite' });
  const grid = el('div', { class: 'week-picker', role: 'group', 'aria-label': `${year} haftaları` });
  const error = errorBox();
  const submit = el('button', { type: 'submit', class: 'btn btn-primary', text: 'Seçili haftalara planla' });

  const busyWeeks = () => new Set(trips.filter((t) => t.personId === Number(who.value))
    .flatMap(tripWeeks).filter((w) => w.year === year).map((w) => w.week));

  const paint = () => {
    const busy = busyWeeks();
    for (const btn of grid.children) {
      const w = Number(btn.dataset.week);
      btn.classList.toggle('is-selected', selected.has(w));
      btn.classList.toggle('has-trip', busy.has(w));
      btn.setAttribute('aria-pressed', String(selected.has(w)));
    }
    const list = [...selected].sort((a, b) => a - b);
    summary.textContent = list.length ? `${list.length} hafta seçili: ${list.join(', ')}` : 'Henüz hafta seçilmedi. Numaralara tıklayın ya da yukarıya yazın.';
    submit.textContent = list.length ? `${list.length} haftaya planla` : 'Seçili haftalara planla';
  };

  for (let w = 1; w <= max; w += 1) {
    const past = year < current.year || (year === current.year && w < current.week);
    grid.append(el('button', {
      type: 'button',
      class: `wk-pick${past ? ' is-past' : ''}${year === current.year && w === current.week ? ' is-now' : ''}`,
      dataset: { week: String(w) },
      title: `${w}. hafta · ${weekRangeLabel(year, w)}`,
      text: String(w),
      onclick: () => { if (selected.has(w)) selected.delete(w); else selected.add(w); weeksText.value = ''; paint(); },
    }));
  }

  const applyText = () => {
    if (!weeksText.value.trim()) return true;
    const r = parseWeeks(weeksText.value, max);
    if (r.error) { error.textContent = r.error; error.hidden = false; return false; }
    error.hidden = true;
    selected.clear();
    r.weeks.forEach((w) => selected.add(w));
    paint();
    return true;
  };
  weeksText.addEventListener('input', () => {
    const r = parseWeeks(weeksText.value, max);
    if (!r.error) { selected.clear(); r.weeks.forEach((w) => selected.add(w)); error.hidden = true; paint(); }
  });
  weeksText.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); applyText(); } });
  who.addEventListener('change', paint);

  const form = el('form', { class: 'dlg-form', novalidate: true },
    el('p', { class: 'dlg-sub', text: `${year} · bir kişi için seçtiğiniz her haftaya ayrı bir planlanan kayıt eklenir.` }),
    el('div', { class: 'form-grid form-grid-4' }, field('Kişi', who), field('Bölge', region), field('Başlangıç günü', dayOfWeek),
      field('Kaç gün', length), field('Not (isteğe bağlı)', note, 'field-wide')),
    field('Haftalar', weeksText, 'field-wide'),
    grid,
    el('div', { class: 'picker-foot' }, summary,
      el('span', { class: 'legend-inline' }, el('i', { class: 'dot dot-trip' }), 'kişinin o haftada kaydı var'),
      el('button', { type: 'button', class: 'btn btn-ghost-dark btn-sm', text: 'Temizle', onclick: () => { selected.clear(); weeksText.value = ''; paint(); } })),
    error,
    el('div', { class: 'form-actions' }, submit));
  const dlg = openDialog('Haftalara toplu planla', form, { wide: true });
  paint();

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (!applyText()) return;
    const payload = { personId: Number(who.value), region: region.value.trim(), note: note.value.trim() };
    const n = Number(length.value);
    const problem = checkTrip(payload.region, payload.note)
      || (Number.isInteger(n) && n >= 1 && n <= 365 ? null : 'Gün sayısı 1 ile 365 arasında olmalı.')
      || (selected.size ? null : 'En az bir hafta seçin.');
    if (problem) { error.textContent = problem; error.hidden = false; return; }
    const dates = [...selected].sort((a, b) => a - b).map((w) => {
      const start = weekDays(year, w)[Number(dayOfWeek.value)];
      return { date: start, endDate: addDaysISO(start, n - 1) };
    });
    submitIn(dlg, submit, error, () => onSubmit(payload, dates, (done) => { submit.textContent = `Ekleniyor… ${done}/${dates.length}`; }))
      .catch(() => dlg.close());
  });
  region.focus();
}

// ---------- Tablo ----------
export function renderWeekPlan({ year, trips, people, editable, showDone, onYear, onShowDone, onAdd, onTrip, onBulk }) {
  const max = weeksInYear(year);
  const today = todayISO();
  const now = isoWeekOf(today);
  const thisYear = new Date().getFullYear();

  // Çok günlük seyahat kapsadığı her haftada görünür; ilk hafta dışındakiler "devam" olarak işaretlenir.
  const byCell = new Map();
  const yearTrips = [];
  for (const t of trips) {
    const weeks = tripWeeks(t);
    if (weeks.some((w) => w.year === year)) yearTrips.push(t);
    if (!showDone && t.status === 'done') continue;
    weeks.forEach((w, i) => {
      if (w.year !== year) return;
      const key = `${t.personId}:${w.week}`;
      if (!byCell.has(key)) byCell.set(key, []);
      byCell.get(key).push({ t, cont: i > 0 });
    });
  }

  const bar = el('div', { class: 'weekplan-bar' },
    el('div', { class: 'month-nav' },
      el('button', { type: 'button', class: 'btn btn-icon', 'aria-label': 'Önceki yıl', text: '‹', onclick: () => onYear(year - 1) }),
      el('span', { class: 'month-label', text: String(year) }),
      el('button', { type: 'button', class: 'btn btn-icon', 'aria-label': 'Sonraki yıl', text: '›', onclick: () => onYear(year + 1) })),
    year === thisYear ? null : el('button', { type: 'button', class: 'btn btn-ghost-dark', text: 'Bu yıla dön', onclick: () => onYear(thisYear) }),
    el('span', { class: 'spacer' }),
    el('label', { class: 'check' },
      el('input', { type: 'checkbox', checked: showDone, onchange: (ev) => onShowDone(ev.target.checked) }),
      'Gerçekleşenleri göster'),
    editable ? el('button', { type: 'button', class: 'btn btn-primary', text: '+ Toplu planla', onclick: onBulk }) : null);

  const legend = el('div', { class: 'weekplan-legend' },
    el('span', {}, el('i', { class: 'swatch swatch-planned' }), 'Planlanan'),
    el('span', {}, el('i', { class: 'swatch swatch-done' }), 'Gerçekleşen'),
    el('span', {}, el('i', { class: 'swatch swatch-overdue' }), 'Tarihi geçti'));

  const head = el('tr', {},
    el('th', { scope: 'col', class: 'wk-col', text: 'Hafta' }),
    people.map((p) => {
      const mine = yearTrips.filter((t) => t.personId === p.id);
      return el('th', { scope: 'col', class: 'person-col' },
        el('span', { class: 'pc-name', text: p.name }),
        el('span', { class: 'pc-count' },
          `${mine.filter((t) => t.status === 'planned').length} planlı · ${mine.filter((t) => t.status === 'done').length} gerçekleşen`));
    }));

  const body = el('tbody');
  let lastMonth = -1;
  for (let w = 1; w <= max; w += 1) {
    const start = isoWeekStart(year, w);
    const month = addDays(start, 3).getUTCMonth(); // hafta, perşembesinin ayına aittir
    if (month !== lastMonth) {
      lastMonth = month;
      body.append(el('tr', { class: 'month-row' }, el('th', { colspan: String(people.length + 1), scope: 'colgroup', text: `${AY_ADI[month]} ${year}` })));
    }
    const isNow = year === now.year && w === now.week;
    const isPast = year < now.year || (year === now.year && w < now.week);
    body.append(el('tr', { class: `week-row${isNow ? ' is-now' : ''}${isPast ? ' is-past' : ''}`, id: isNow ? 'bu-hafta' : null },
      el('th', { scope: 'row', class: 'wk-col' },
        el('span', { class: 'wk-no', text: String(w) }),
        el('span', { class: 'wk-range', text: weekRangeLabel(year, w) }),
        isNow ? el('span', { class: 'wk-now', text: 'bu hafta' }) : null),
      people.map((p) => {
        const list = (byCell.get(`${p.id}:${w}`) || [])
          .sort((a, b) => (a.t.date < b.t.date ? -1 : a.t.date > b.t.date ? 1 : a.t.id - b.t.id));
        return el('td', { class: 'wk-cell' },
          list.map(({ t, cont }) => {
            const days = tripDays(t);
            return el('button', {
              type: 'button',
              class: `chip chip-${isOverdue(t) ? 'overdue' : t.status}${cont ? ' chip-cont' : ''}`,
              title: `${t.region} · ${tripLabel(t)} · ${days} gün${t.note ? ` · ${t.note}` : ''}`,
              onclick: () => onTrip(t),
            },
            el('span', { class: 'chip-day', text: cont ? '↳' : GUN_KISA[weekday(fromISO(t.date))] }),
            el('span', { class: 'chip-region', text: t.region }),
            days > 1 && !cont ? el('span', { class: 'chip-days', text: `${days}g` }) : null);
          }),
          editable ? el('button', {
            type: 'button', class: 'cell-add', text: '+', 'aria-label': `${p.name} için ${w}. haftaya plan ekle`,
            onclick: () => onAdd(p.id, w),
          }) : null);
      })));
  }

  const scroller = el('div', { class: 'card week-scroll' },
    el('table', { class: 'weeks' }, el('thead', {}, head), body));
  return el('section', { class: 'weekplan', 'aria-label': `${year} yılı hafta planı` }, bar, legend, scroller);
}

export function scrollToCurrentWeek(root) {
  const row = root.querySelector('#bu-hafta');
  const box = root.querySelector('.week-scroll');
  if (row && box) box.scrollTop = Math.max(0, row.offsetTop - box.clientHeight / 3);
}
