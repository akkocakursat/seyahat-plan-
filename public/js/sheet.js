// Alttan açılan panel (telefonda) / ortadaki pencere (geniş ekranda) ve kısa bildirim.
// Telefonun geri tuşu paneli kapatır.
import { el, ApiError } from './ortak.js';

let openCount = 0;

export function openSheet(title, body, { wide = false } = {}) {
  const dlg = el('dialog', { class: `sheet${wide ? ' sheet-wide' : ''}`, 'aria-label': title });
  const close = () => { if (dlg.open) dlg.close(); };
  dlg.append(el('div', { class: 'sheet-inner' },
    el('div', { class: 'sheet-grip', 'aria-hidden': 'true' }),
    el('div', { class: 'sheet-head' },
      el('h2', { text: title }),
      el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Kapat', text: '×', onclick: close })),
    body));
  dlg.addEventListener('click', (ev) => { if (ev.target === dlg) close(); });

  // Geri tuşu: panel açılırken tarihçeye bir adım eklenir, geri gelince panel kapanır.
  history.pushState({ sheet: true }, '');
  openCount += 1;
  const onPop = () => { if (dlg.open) dlg.close(); };
  window.addEventListener('popstate', onPop, { once: true });
  dlg.addEventListener('close', () => {
    window.removeEventListener('popstate', onPop);
    openCount -= 1;
    if (history.state?.sheet) history.back();
    dlg.remove();
  });

  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

export const sheetIsOpen = () => openCount > 0;

// Gönderim: düğmeyi kilitler, hatayı panelde gösterir, başarıda paneli kapatır.
export async function submitIn(dlg, button, errorNode, fn) {
  button.disabled = true;
  errorNode.hidden = true;
  try {
    await fn();
    dlg.close();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) { dlg.close(); throw err; }
    errorNode.textContent = err.message || 'İşlem tamamlanamadı. Bağlantınızı kontrol edip tekrar deneyin.';
    errorNode.hidden = false;
  } finally {
    button.disabled = false;
  }
}

export const errorBox = () => el('p', { class: 'form-error', role: 'alert', hidden: true });

let toastTimer;
// action: { label, run } — örn. "Geri al"
export function toast(message, kind = 'ok', action = null) {
  const node = document.getElementById('toast');
  if (!node) return;
  node.replaceChildren(el('span', { text: message }));
  if (action) {
    node.append(el('button', {
      type: 'button', class: 'toast-action', text: action.label,
      onclick: () => { node.hidden = true; action.run(); },
    }));
  }
  node.className = `toast toast-${kind}`;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, kind === 'error' ? 7000 : action ? 6000 : 3200);
}
