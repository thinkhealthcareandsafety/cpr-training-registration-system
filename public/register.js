import { $, el, api, header, drawCert } from './common.js';

const slug = location.pathname.split('/')[2] || '';
const key = 'reg-' + slug;
let info = null, picked = null, findT;
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
  // Only the registration form's fields; the organiser login box has its own messages.
  for (const f of document.querySelectorAll('#form .field')) { f.classList.remove('bad'); const e = $('.err', f); if (e) e.textContent = ''; }
}

$('#name').addEventListener('input', draw);
// Guest list lookup: only a few matching names come back, with the email hidden.
$('#findName').addEventListener('input', () => {
  clearTimeout(findT);
  const term = $('#findName').value.trim();
  if (term.length < 3) { $('#found').replaceChildren(); $('#foundHint').textContent = ''; return; }
  findT = setTimeout(async () => {
    try {
      const list = await api(`/api/find/${encodeURIComponent(slug)}?q=${encodeURIComponent(term)}`);
      if ($('#findName').value.trim() !== term) return;
      $('#found').replaceChildren(...list.map((p) => el('button', { type: 'button', role: 'listitem', class: 'pick', onclick: () => pick(p) }, el('b', {}, p.name), el('small', {}, p.hint))));
      $('#foundHint').textContent = list.length ? 'Tap your name.' : 'No match. Fill in the form below to register.';
    } catch { /* lookup is optional */ }
  }, 300);
});
function pick(p) {
  picked = p;
  $('#name').value = p.name;
  draw();
  $('#found').replaceChildren();
  $('#findName').value = '';
  $('#foundHint').textContent = `Found you. Now enter your email (${p.hint}) to confirm, then press Register.`;
  $('#email').focus();
}
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
  if (!$('#consent').checked) return setErr('consent', 'Tick the box to agree before registering.');
  $('#go').disabled = true;
  $('#go').textContent = 'Registering…';
  try {
    const r = await api('/api/register/' + encodeURIComponent(slug), { method: 'POST', body: { name: v('name'), email: v('email'), cc: v('cc'), phone: v('phone'), consent: true, listId: picked?.id } });
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
  else {
    $('#form').hidden = false;
    $('#lookup').hidden = false;
  }
  let saved = null;
  try { saved = localStorage.getItem(key); } catch {}
  if (saved) { $('#mine').hidden = false; $('#mineLink').href = '/p/' + encodeURIComponent(saved); }
} catch (e) {
  $('#cert').hidden = true;
  closed('Registration is not available', e.message);
}
