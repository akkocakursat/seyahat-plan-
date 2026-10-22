// Seyahat ekleme / düzenleme formu ve kayıt ayrıntı paneli.
import {
  el, clear, todayISO, tripDays, addDaysISO, daysBetween, isOverdue, rangeLabel, firstName, weekdayIndex, GUN_KISA,
} from './ortak.js';
import { openSheet, submitIn, errorBox } from './sheet.js';
import { isoWeekOf, weekDays, weeksInYear, parseWeeks, tripWeeks } from './hafta.js';
import { searchCities, splitCities, joinCities, SEHIRLER, fold } from './sehirler.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const QUICK_DAYS = [1, 2, 3, 5];
let uid = 0;
const nextId = (p) => `${p}-${(uid += 1)}`;

function radioGroup(name, label, options, selected, { className = '' } = {}) {
  const group = el('fieldset', { class: `choice ${className}` }, el('legend', { text: label }));
  const wrap = el('div', { class: 'choice-row' });
  for (const o of options) {
    const id = nextId(name);
    wrap.append(
      el('input', { type: 'radio', name, id, value: String(o.value), checked: String(o.value) === String(selected), class: 'choice-input' }),
      el('label', { for: id, class: `choice-pill ${o.className || ''}`, text: o.label }));
  }
  group.append(wrap);
  return group;
}
const radioValue = (root, name) => root.querySelector(`input[name="${name}"]:checked`)?.value;

// ---------- Şehir seçici (çoklu) ----------
function cityPicker(initial, recent) {
  const selected = [...initial];
  const id = nextId('sehir');
  const chips = el('div', { class: 'city-chips', 'aria-live': 'polite' });
  const input = el('input', {
    id, type: 'search', autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false', enterKeyHint: 'done',
    placeholder: 'Şehir ara, ör. Konya',
  });
  const results = el('div', { class: 'city-results' });

  const add = (city) => {
    if (!selected.some((c) => fold(c) === fold(city))) selected.push(city);
    input.value = '';
    paint();
    input.focus();
  };
  const remove = (city) => { selected.splice(selected.indexOf(city), 1); paint(); };

  function paint() {
    clear(chips).append(...selected.map((c) => el('button', {
      type: 'button', class: 'city-chip', 'aria-label': `${c} kaldır`, onclick: () => remove(c),
    }, el('span', { text: c }), el('span', { class: 'x', 'aria-hidden': 'true', text: '×' }))));
    const q = input.value.trim();
    const list = q ? searchCities(q, selected).slice(0, 8) : recent.filter((c) => !selected.some((x) => fold(x) === fold(c)));
    clear(results);
    if (!q && list.length) results.append(el('span', { class: 'city-label', text: 'Son gidilenler' }));
    if (q && !list.length) results.append(el('span', { class: 'city-label', text: 'Bu adla bir il bulunamadı.' }));
    results.append(...list.map((c) => el('button', { type: 'button', class: 'city-option', text: c, onclick: () => add(c) })));
  }
  input.addEventListener('input', paint);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      const first = searchCities(input.value, selected)[0];
      if (input.value.trim() && first) add(first);
    } else if (ev.key === 'Backspace' && !input.value && selected.length) {
      remove(selected[selected.length - 1]);
    }
  });
  paint();
  return {
    node: el('div', { class: 'field' }, el('label', { for: id, text: 'Hangi şehirler?' }), chips, input, results),
    input,
    value: () => [...selected],
  };
}

// Kişinin en sık gittiği şehirler (hızlı seçim için).
function recentCities(trips, personId) {
  const count = new Map();
  for (const t of trips) {
    if (t.personId !== personId) continue;
    for (const c of splitCities(t.region)) {
      if (SEHIRLER.some((x) => fold(x) === fold(c))) count.set(c, (count.get(c) || 0) + 1);
    }
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c]) => c);
}

// ---------- Form ----------
// trip verilirse düzenleme; aksi halde ekleme (defaults: date). Kişi, giriş yapan kişidir (selfId);
// kullanıcı bir kişiyle eşleşmiyorsa kişi seçimi gösterilir.
export function fillTripForm(dlg, body, { people, selfId, trip, defaults = {}, allTrips = [], onCreate, onUpdate }) {
  const editing = Boolean(trip);
  const start0 = trip?.date ?? defaults.date ?? todayISO();
  const end0 = trip ? (trip.endDate || trip.date) : start0;
  const fixedPerson = trip?.personId ?? selfId ?? null;
  const personId0 = fixedPerson ?? defaults.personId ?? people[0]?.id;
  const who = fixedPerson ? null
    : radioGroup('kisi', 'Kim gidiyor?', people.map((p) => ({ value: p.id, label: firstName(p.name) })), personId0, { className: 'choice-people' });
  const currentPerson = () => (fixedPerson ?? Number(radioValue(body, 'kisi')));
  const cities = cityPicker(splitCities(trip?.region), recentCities(allTrips, personId0));
  const start = el('input', { id: nextId('bas'), name: 'date', type: 'date', required: true, min: '2000-01-01', max: '2100-12-31', value: start0 });
  const end = el('input', { id: nextId('bit'), name: 'endDate', type: 'date', required: true, min: start0, max: '2100-12-31', value: end0 });
  const quick = el('div', { class: 'quick-days', role: 'group', 'aria-label': 'Süre' });
  const summary = el('p', { class: 'date-summary', 'aria-live': 'polite' });
  const status = radioGroup('durum', 'Durum', [
    { value: 'planned', label: 'Planlandı', className: 'pill-planned' },
    { value: 'done', label: 'Gerçekleşti', className: 'pill-done' },
  ], trip?.status ?? defaults.status ?? 'planned', { className: 'choice-status' });
  const note = el('textarea', { id: nextId('not'), name: 'note', maxLength: 500, rows: 3, placeholder: 'Toplantı, ziyaret edilecek yer…', value: trip?.note ?? '' });
  const noteField = el('div', { class: 'field', hidden: !trip?.note }, el('label', { for: note.id, text: 'Not' }), note);
  const noteToggle = el('button', {
    type: 'button', class: 'text-btn', text: '+ Not ekle', hidden: Boolean(trip?.note),
    onclick: () => { noteField.hidden = false; noteToggle.hidden = true; note.focus(); },
  });

  // Çoklu hafta (yalnızca eklemede)
  const multi = el('input', { type: 'checkbox', id: nextId('coklu') });
  const weeksText = el('input', { id: nextId('haftalar'), autocomplete: 'off', inputMode: 'numeric', placeholder: 'Örn. 1-5, 35, 37' });
  const picker = el('div', { class: 'week-picker', role: 'group', 'aria-label': 'Haftalar' });
  const pickerNote = el('p', { class: 'hint', 'aria-live': 'polite' });
  const multiBox = el('div', { class: 'multi', hidden: true },
    el('div', { class: 'field' }, el('label', { for: weeksText.id, text: 'Haftalar' }), weeksText),
    picker, pickerNote);
  const selected = new Set();

  const error = errorBox();
  const submit = el('button', { type: 'submit', class: 'btn btn-primary btn-wide' });

  const days = () => (ISO.test(start.value) && ISO.test(end.value) && end.value >= start.value ? daysBetween(start.value, end.value) : 0);
  const pickerYear = () => (ISO.test(start.value) ? isoWeekOf(start.value).year : new Date().getFullYear());

  function paintPicker() {
    const year = pickerYear();
    const max = weeksInYear(year);
    if (picker.dataset.year !== String(year)) {
      picker.dataset.year = String(year);
      clear(picker);
      selected.clear();
      if (ISO.test(start.value)) selected.add(isoWeekOf(start.value).week);
      const now = isoWeekOf(todayISO());
      for (let w = 1; w <= max; w += 1) {
        picker.append(el('button', {
          type: 'button', class: `wk${year === now.year && w === now.week ? ' is-now' : ''}`, dataset: { week: String(w) }, text: String(w),
          onclick: () => { if (selected.has(w)) selected.delete(w); else selected.add(w); weeksText.value = ''; paintPicker(); },
        }));
      }
    }
    const busy = new Set(allTrips.filter((t) => t.personId === currentPerson())
      .flatMap(tripWeeks).filter((w) => w.year === year).map((w) => w.week));
    for (const b of picker.children) {
      const w = Number(b.dataset.week);
      b.classList.toggle('is-on', selected.has(w));
      b.classList.toggle('is-busy', busy.has(w));
      b.setAttribute('aria-pressed', String(selected.has(w)));
    }
    const list = [...selected].sort((a, b) => a - b);
    pickerNote.textContent = list.length
      ? `${year}: ${list.length} hafta seçili (${list.join(', ')}). Her haftanın ${weekdayName()} günü başlar, ${days() || 1} gün sürer.`
      : 'Eklemek istediğiniz haftaları seçin. Noktalı haftalarda bu kişinin zaten seyahati var.';
  }
  const weekdayName = () => (ISO.test(start.value) ? GUN_KISA[weekdayIndex(start.value)] : 'Pzt');

  function refresh() {
    if (ISO.test(start.value)) end.min = start.value;
    const n = days();
    for (const b of quick.children) b.classList.toggle('is-on', Number(b.dataset.days) === n);
    summary.textContent = n ? `${rangeLabel({ date: start.value, endDate: end.value })}, ${n} gün` : 'Dönüş, gidişten önce olamaz.';
    summary.classList.toggle('is-bad', !n);
    const count = multi.checked ? selected.size : 1;
    submit.textContent = editing ? 'Değişiklikleri kaydet' : count > 1 ? `${count} seyahati kaydet` : 'Seyahati kaydet';
  }

  for (const n of QUICK_DAYS) {
    quick.append(el('button', {
      type: 'button', class: 'quick', dataset: { days: String(n) }, text: n === 1 ? '1 gün' : `${n} gün`,
      onclick: () => { if (ISO.test(start.value)) { end.value = addDaysISO(start.value, n - 1); refresh(); paintIfMulti(); } },
    }));
  }
  let prevStart = start0;
  start.addEventListener('change', () => {
    // Başlangıç değişince süre korunur.
    if (ISO.test(prevStart) && ISO.test(start.value) && ISO.test(end.value) && end.value >= prevStart) {
      end.value = addDaysISO(start.value, daysBetween(prevStart, end.value) - 1);
    } else if (ISO.test(start.value) && (!ISO.test(end.value) || end.value < start.value)) {
      end.value = start.value;
    }
    prevStart = start.value;
    refresh();
    paintIfMulti();
  });
  end.addEventListener('input', refresh);
  end.addEventListener('change', refresh);
  const paintIfMulti = () => { if (multi.checked) paintPicker(); };
  multi.addEventListener('change', () => { multiBox.hidden = !multi.checked; if (multi.checked) paintPicker(); refresh(); });
  weeksText.addEventListener('input', () => {
    const r = parseWeeks(weeksText.value, weeksInYear(pickerYear()));
    if (!r.error && weeksText.value.trim()) { selected.clear(); r.weeks.forEach((w) => selected.add(w)); paintPicker(); refresh(); }
  });
  body.addEventListener('change', (ev) => { if (ev.target.name === 'kisi' && multi.checked) paintPicker(); });

  const form = el('form', { class: 'trip-form', novalidate: true },
    who,
    cities.node,
    el('div', { class: 'dates' },
      el('div', { class: 'field' }, el('label', { for: start.id, text: 'Gidiş' }), start),
      el('div', { class: 'field' }, el('label', { for: end.id, text: 'Dönüş' }), end)),
    quick,
    summary,
    status,
    noteToggle,
    noteField,
    editing ? null : el('label', { class: 'switch', for: multi.id }, multi, el('span', { text: 'Başka haftalara da ekle' })),
    editing ? null : multiBox,
    error,
    el('div', { class: 'sheet-actions' }, submit));

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    // Yazılıp seçilmemiş tek bir şehir adı varsa o da eklenir.
    const typed = cities.input.value.trim() ? searchCities(cities.input.value, cities.value())[0] : null;
    const chosen = typed && fold(typed) === fold(cities.input.value) ? [...cities.value(), typed] : cities.value();
    const payload = {
      personId: currentPerson(),
      region: joinCities(chosen),
      date: start.value,
      endDate: end.value,
      note: note.value.trim(),
      status: radioValue(form, 'durum'),
    };
    const n = days();
    let problem = !payload.personId ? 'Kimin gideceğini seçin.'
      : !payload.region ? 'En az bir şehir seçin.'
        : [...payload.region].length > 80 ? 'Seçilen şehirler çok uzun; bir seyahatte en fazla 80 karakterlik şehir adı olabilir.'
          : !ISO.test(payload.date) || !ISO.test(payload.endDate) ? 'Gidiş ve dönüş tarihlerini seçin.'
            : !n ? 'Dönüş, gidişten önce olamaz.'
              : n > 365 ? 'Bir seyahat en fazla 365 gün olabilir.'
                : [...payload.note].length > 500 ? 'Not en fazla 500 karakter olabilir.' : null;
    let list = [payload];
    if (!problem && !editing && multi.checked) {
      if (weeksText.value.trim()) {
        const r = parseWeeks(weeksText.value, weeksInYear(pickerYear()));
        if (r.error) problem = r.error;
        else { selected.clear(); r.weeks.forEach((w) => selected.add(w)); }
      }
      if (!problem && !selected.size) problem = 'En az bir hafta seçin.';
      const dayIdx = weekdayIndex(payload.date);
      list = [...selected].sort((a, b) => a - b).map((w) => {
        const d = weekDays(pickerYear(), w)[dayIdx];
        return { ...payload, date: d, endDate: addDaysISO(d, n - 1) };
      });
    }
    if (problem) { error.textContent = problem; error.hidden = false; return; }
    submitIn(dlg, submit, error, () => (editing ? onUpdate(trip, payload)
      : onCreate(list, (done) => { submit.textContent = `Kaydediliyor… ${done}/${list.length}`; }))).catch(() => {});
  });

  clear(body).append(form);
  refresh();
  if (!editing) setTimeout(() => cities.input.focus(), 50);
}

export function openTripForm(opts) {
  const body = el('div');
  const dlg = openSheet(opts.trip ? 'Seyahati düzenle' : 'Yeni seyahat', body);
  fillTripForm(dlg, body, opts);
}

// ---------- Ayrıntı ----------
export function openTripDetail({ trip, people, editable, allTrips, onStatus, onUpdate, onDelete, onShowPerson }) {
  const who = people.find((p) => p.id === trip.personId);
  const body = el('div');
  const dlg = openSheet(trip.region, body);
  const n = tripDays(trip);
  const overdue = isOverdue(trip);
  const { week } = isoWeekOf(trip.date);

  const show = () => {
    dlg.querySelector('.sheet-head h2').textContent = trip.region;
    const error = errorBox();
    const actions = el('div', { class: 'sheet-actions stacked' });
    clear(body).append(
      el('div', { class: `detail-status st-${overdue ? 'overdue' : trip.status}` },
        trip.status === 'done' ? 'Gerçekleşti' : overdue ? 'Tarihi geçti, hâlâ planlı görünüyor' : 'Planlandı'),
      el('dl', { class: 'facts' },
        el('dt', { text: 'Kim' }), el('dd', { text: who ? who.name : '—' }),
        el('dt', { text: 'Ne zaman' }), el('dd', {}, `${rangeLabel(trip)} `, el('span', { class: 'muted', text: `(${n} gün, ${week}. hafta)` })),
        trip.note ? el('dt', { text: 'Not' }) : null, trip.note ? el('dd', { class: 'note', text: trip.note }) : null),
      error, actions);
    if (editable) {
      const toDone = trip.status === 'planned';
      const statusBtn = el('button', { type: 'button', class: `btn ${toDone ? 'btn-done' : 'btn-quiet'} btn-wide`, text: toDone ? 'Gerçekleşti olarak işaretle' : 'Planlandıya geri al' });
      statusBtn.addEventListener('click', () => submitIn(dlg, statusBtn, error, () => onStatus(trip, toDone ? 'done' : 'planned')).catch(() => {}));
      const editBtn = el('button', {
        type: 'button', class: 'btn btn-quiet btn-wide', text: 'Düzenle',
        onclick: () => { dlg.querySelector('.sheet-head h2').textContent = 'Seyahati düzenle'; fillTripForm(dlg, body, { people, trip, allTrips, onUpdate }); },
      });
      const delBtn = el('button', { type: 'button', class: 'btn btn-danger-quiet btn-wide', text: 'Sil' });
      delBtn.addEventListener('click', () => {
        const yes = el('button', { type: 'button', class: 'btn btn-danger', text: 'Evet, sil' });
        yes.addEventListener('click', () => submitIn(dlg, yes, error, () => onDelete(trip)).catch(() => {}));
        actions.replaceChildren(el('div', { class: 'confirm', role: 'group', 'aria-label': 'Silme onayı' },
          el('p', { text: `${trip.region} seyahati silinsin mi?` }),
          el('div', { class: 'confirm-row' }, yes, el('button', { type: 'button', class: 'btn btn-quiet', text: 'Vazgeç', onclick: show }))));
      });
      actions.append(statusBtn, editBtn, delBtn);
    }
    if (onShowPerson && who) {
      actions.append(el('button', { type: 'button', class: 'text-btn', text: `${firstName(who.name)} adlı kişinin tüm seyahatleri`, onclick: () => { dlg.close(); onShowPerson(who.id); } }));
    }
  };
  show();
}
