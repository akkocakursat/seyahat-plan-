import { api, ApiError } from './ortak.js';

const form = document.getElementById('login-form');
const error = document.getElementById('login-error');
const submit = document.getElementById('login-submit');

// Zaten oturum varsa ana sayfaya geç.
api('GET', '/api/oturum').then(() => location.replace('/'), () => {});

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  error.hidden = true;
  const username = form.username.value.trim();
  const password = form.password.value;
  if (!username || !password) {
    error.textContent = 'Kullanıcı adı ve parola gereklidir.';
    error.hidden = false;
    return;
  }
  submit.disabled = true;
  try {
    await api('POST', '/api/giris', { username, password });
    location.replace('/');
  } catch (err) {
    let msg = err.message;
    if (err instanceof ApiError && err.status === 429 && err.retryAfter) {
      msg += ` (${Math.ceil(Number(err.retryAfter) / 60)} dk sonra)`;
    }
    error.textContent = msg;
    error.hidden = false;
    form.password.value = '';
    form.password.focus();
  } finally {
    submit.disabled = false;
  }
});
