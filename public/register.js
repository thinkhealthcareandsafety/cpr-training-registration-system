import { $, api, header, drawCert } from './common.js';

const slug = location.pathname.split('/')[2] || '';
const key = 'reg-' + slug;
let info = null;
const draw = () => info && drawCert($('#cert'), { ...info, name: $('#name').value.trim() });
function closed(title, msg) {
  $('#closed').hidden = false;
  $('#closedTitle').textContent = title;
  $('#closedMsg').textContent = msg;
}
function setErr(field, msg) {
  const f = field && $(`[data-f="${field}"]`);
  if (!f) { $('#err').textContent = msg; return; }
  f.classList.add('bad');
  $('.err', f).textContent = msg;
  $('input:not(#cc)', f)?.focus();
  f.scrollIntoView({ block: 'center' });
}
function clear() {
  $('#err').textContent = '';
  for (const f of document.querySelectorAll('.field')) { f.classList.remove('bad'); $('.err', f).textContent = ''; }
}

$('#name').addEventListener('input', draw);
// Organisers sign in from this same page and go to the dashboard.
$('#orgLogin').onclick = async () => {
  try { const r = await fetch('/api/admin/state'); if (r.ok) { location.href = '/admin'; return; } } catch {}
  $('#loginErr').textContent = '';
  $('#loginDlg').showModal();
  $('#opw').focus();
};
$('#loginCancel').onclick = () => $('#loginDlg').close();
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { await api('/api/admin/login', { method: 'POST', body: { password: $('#opw').value } }); location.href = '/admin'; }
  catch (x) { $('#loginErr').textContent = x.message; }
});
$('#form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  clear();
  const v = (id) => $('#' + id).value.trim();
  if (!v('name')) return setErr('name', 'Enter your full name.');
  if (!v('email')) return setErr('email', 'Enter your email address.');
  if (!v('phone')) return setErr('phone', 'Enter your phone number.');
  if (!$('#consent').checked) return setErr('consent', 'Tick the box to agree before registering.');
  $('#go').disabled = true;
  $('#go').textContent = 'Registering…';
  try {
    const r = await api('/api/register/' + encodeURIComponent(slug), { method: 'POST', body: { name: v('name'), email: v('email'), cc: v('cc'), phone: v('phone'), consent: true } });
    try { localStorage.setItem(key, r.token); } catch {}
    location.href = '/p/' + r.token;
  } catch (e) {
    $('#go').disabled = false;
    $('#go').textContent = 'Register';
    setErr(e.field, e.message);
  }
});

try {
  if (!slug) throw new Error('There is no open training right now.');
  info = await api('/api/training/' + encodeURIComponent(slug));
  header(info.brand, info.training);
  draw();
  if (!info.training.open) closed('Registration closed', 'Registration for this training is closed. If you already registered, open the link you saved.');
  else $('#form').hidden = false;
  let saved = null;
  try { saved = localStorage.getItem(key); } catch {}
  if (saved) { $('#mine').hidden = false; $('#mineLink').href = '/p/' + encodeURIComponent(saved); }
} catch (e) {
  $('#cert').hidden = true;
  closed('Registration is not available', e.message);
}
