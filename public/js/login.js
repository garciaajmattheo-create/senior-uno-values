import { sb, configured, cleanError } from './supa.js';

const forms = {
  login: document.getElementById('loginForm'),
  signup: document.getElementById('signupForm'),
  reset: document.getElementById('resetForm'),
  newpass: document.getElementById('newPassForm'),
};
const tabLogin = document.getElementById('tabLogin');
const tabSignup = document.getElementById('tabSignup');

function show(which) {
  Object.entries(forms).forEach(([k, f]) => { f.hidden = k !== which; });
  tabLogin.setAttribute('aria-selected', String(which === 'login'));
  tabSignup.setAttribute('aria-selected', String(which === 'signup'));
  tabLogin.parentElement.hidden = which === 'newpass';
}
function msg(form, sel, text) {
  const el = form.querySelector(sel);
  if (!el) return;
  el.textContent = text || '';
  el.hidden = !text;
}
function busy(form, on, label) {
  const b = form.querySelector('button[type=submit]');
  if (!b.dataset.label) b.dataset.label = b.textContent;
  b.disabled = on;
  b.textContent = on ? (label || 'Please wait…') : b.dataset.label;
}

tabLogin.addEventListener('click', () => show('login'));
tabSignup.addEventListener('click', () => show('signup'));
document.getElementById('forgotLink').addEventListener('click', (e) => { e.preventDefault(); show('reset'); });
document.getElementById('backToLogin').addEventListener('click', (e) => { e.preventDefault(); show('login'); });
if (location.hash === '#signup') show('signup');

if (!configured) {
  msg(forms.login, '.form-error', 'This website is not connected to its database yet. The administrator needs to fill in js/config.js.');
}

// Already logged in → go to the app (unless this is a password-reset link).
if (sb) {
  sb.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') show('newpass');
  });
  sb.auth.getSession().then(({ data }) => {
    if (data.session && !location.hash.includes('type=recovery')) location.replace('app.html');
  });
}

forms.login.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target; msg(f, '.form-error');
  if (!sb) return;
  busy(f, true, 'Logging in…');
  const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
  busy(f, false);
  if (error) return msg(f, '.form-error', cleanError(error));
  window.suGo ? window.suGo('app.html', true) : location.replace('app.html');
});

forms.signup.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target; msg(f, '.form-error'); msg(f, '.form-ok');
  if (!sb) return;
  busy(f, true, 'Creating account…');
  const { data, error } = await sb.auth.signUp({
    email: f.email.value.trim(),
    password: f.password.value,
    options: { data: { full_name: f.full_name.value.trim() }, emailRedirectTo: new URL('app.html', location.href).href },
  });
  busy(f, false);
  if (error) return msg(f, '.form-error', cleanError(error));
  if (data.session) return window.suGo ? window.suGo('app.html', true) : location.replace('app.html');
  f.reset();
  msg(f, '.form-ok', 'Account created! Check your email for a confirmation link. After that, the principal will approve your account.');
});

forms.reset.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target; msg(f, '.form-error'); msg(f, '.form-ok');
  if (!sb) return;
  busy(f, true);
  const { error } = await sb.auth.resetPasswordForEmail(f.email.value.trim(), { redirectTo: new URL('login.html', location.href).href });
  busy(f, false);
  if (error) return msg(f, '.form-error', cleanError(error));
  msg(f, '.form-ok', 'If that email has an account, a reset link is on its way.');
});

forms.newpass.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target; msg(f, '.form-error');
  busy(f, true);
  const { error } = await sb.auth.updateUser({ password: f.password.value });
  busy(f, false);
  if (error) return msg(f, '.form-error', cleanError(error));
  window.suGo ? window.suGo('app.html', true) : location.replace('app.html');
});
