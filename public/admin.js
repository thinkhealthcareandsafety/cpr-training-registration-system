import { $, el, api, camera } from './common.js';
import { niceName } from './cert-layout.js';

const A = '/api/admin';
let S = null, tid = null, people = [], tab = 'people', toastT, poll;
const T = () => S.trainings.find((t) => t.id === tid);
const toast = (m) => { $('#toast').textContent = m; $('#toast').hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { $('#toast').hidden = true; }, 4500); };
const fail = (e) => { if (e.status === 401) showLogin(); else toast(e.message); };
function showLogin() { clearTimeout(poll); $('#dlg').close(); $('#app').hidden = true; $('#login').hidden = false; $('#pw').focus(); }

$('#login').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#loginErr').textContent = '';
  try { await api(A + '/login', { method: 'POST', body: { password: $('#pw').value } }); $('#pw').value = ''; await boot(); }
  catch (x) { $('#loginErr').textContent = x.message; }
});
$('#out').onclick = async () => { try { await api(A + '/logout', { method: 'POST' }); } catch {} showLogin(); };

async function boot() {
  try { await refresh(); } catch (e) { $('#login').hidden = false; return fail(e); }
  $('#login').hidden = true;
  $('#app').hidden = false;
  fillForms();
  show(tab);
  loop();
}
async function refresh() {
  S = await api(A + '/state');
  if (!T()) tid = S.trainings[0].id;
  $('#pick').replaceChildren(...S.trainings.map((t) => el('option', { value: t.id }, `${t.title} (${t.date})${t.open ? '' : ' closed'}`)));
  $('#pick').value = tid;
  await loadPeople();
}
async function loadPeople() {
  const id = tid;
  const list = await api(`${A}/trainings/${id}/participants`);
  if (id !== tid) return;
  const changed = JSON.stringify(list) !== JSON.stringify(people);
  people = list;
  if (changed || !people.length) rows();
}
function loop() {
  clearTimeout(poll);
  poll = setTimeout(async () => {
    if (!document.hidden) { try { await loadPeople(); } catch (e) { if (e.status === 401) return showLogin(); } }
    loop();
  }, 4000);
}

const TABS = { people: 'Participants', share: 'Link and QR code', cert: 'Certificate', mail: 'Email', pw: 'Password' };
$('#tabs').append(...Object.entries(TABS).map(([k, v]) => el('button', { role: 'tab', id: 'b-' + k, onclick: () => show(k) }, v)));
function show(k) {
  tab = k;
  for (const x of Object.keys(TABS)) { $('#t-' + x).hidden = x !== k; $('#b-' + x).setAttribute('aria-selected', x === k); }
  if (k === 'cert') preview();
}
$('#pick').onchange = async (e) => {
  tid = Number(e.target.value);
  people = [];
  try { await loadPeople(); fillForms(); show(tab); } catch (x) { fail(x); }
};

// ---- participants ----
const STATUS = { ready: ['Issued, not emailed', 'warn'], queued: ['Waiting to send', 'warn'], sending: ['Sending', 'warn'], sent: ['Emailed', 'ok'], failed: ['Sending failed', 'bad'] };
const matches = (p) => { const f = $('#find').value.trim().toLowerCase(); return !f || `${p.name} ${p.email} ${p.phone}`.toLowerCase().includes(f); };
function rows() {
  $('#nReg').textContent = people.length;
  $('#nDone').textContent = people.filter((p) => p.completed).length;
  $('#nSent').textContent = people.filter((p) => p.delivery === 'sent').length;
  const waiting = people.filter((p) => ['ready', 'failed'].includes(p.delivery)).length;
  $('#waiting').hidden = !waiting || !S.mailReady;
  $('#waiting').textContent = `Email ${waiting} unsent`;
  // People still waiting for a photo come first, in the order they registered.
  const list = people.filter(matches).sort((x, y) => Boolean(x.completed) - Boolean(y.completed) || (x.completed ? y.completed - x.completed : x.created - y.created));
  $('#rows').replaceChildren(...list.map(row));
  $('#none').hidden = list.length > 0;
  $('#none').textContent = people.length ? 'No participant matches this search.' : 'No one has registered yet. Share the link or QR code, and participants appear here as they register.';
}
const act = (label, fn, cls = '') => el('button', { type: 'button', class: 'btn small ' + cls, onclick: fn }, label);
function row(p) {
  const [label, cls] = p.completed ? STATUS[p.delivery] || STATUS.ready : ['Photo needed', ''];
  const photo = `/file/${p.token}/photo.jpg?view`;
  return el('tr', {},
    el('td', { class: 'c-photo' }, p.has_photo ? el('a', { href: photo, target: '_blank' }, el('img', { class: 'thumb', src: photo, alt: 'Photo of ' + p.name })) : el('small', {}, 'None')),
    el('td', {}, el('b', {}, p.name), el('small', {}, p.email)),
    el('td', {}, '+' + p.phone),
    el('td', {}, el('span', { class: 'pill ' + cls }, label), p.delivery === 'failed' ? el('small', {}, p.delivery_error) : null, p.cert_no ? el('small', {}, p.cert_no) : null),
    el('td', {}, el('div', { class: 'acts' },
      act(p.completed ? 'Replace photo' : 'Add photo and send', () => takePhoto(p), p.completed ? '' : 'go'),
      p.completed && S.mailReady && !['queued', 'sending'].includes(p.delivery) ? act(p.delivery === 'sent' ? 'Send again' : 'Send email', () => resend(p), p.delivery === 'sent' ? '' : 'primary') : null,
      p.completed ? el('a', { class: 'btn small', href: `/file/${p.token}/certificate.pdf?view`, target: '_blank' }, 'Certificate') : null,
      act('Edit', () => edit(p)), act('Copy link', () => copy(p.link)), act('Delete', () => del(p), 'danger'))));
}
$('#find').oninput = rows;
$('#waiting').onclick = async () => {
  try { const r = await api(`${A}/trainings/${tid}/send-waiting`, { method: 'POST' }); toast(`Emailing ${r.queued}`); await loadPeople(); } catch (e) { fail(e); }
};
function takePhoto(p) {
  let photo = null, busy = false;
  const err = el('p', { class: 'formerr', role: 'alert' });
  const box = el('div', { class: 'cam' });
  const send = async (body) => {
    if (busy) return;
    busy = true;
    for (const b of [save, saved, cancel]) b.disabled = true;
    err.textContent = '';
    try {
      const r = await api(`${A}/participants/${p.id}/certificate`, { method: 'POST', body });
      d.close();
      toast(r.emailing ? `Emailing the certificate to ${p.email}` : 'Certificate issued. Connect an account in the Email tab to send it.');
      await loadPeople();
    } catch (x) { if (x.status === 401) showLogin(); else err.textContent = x.message; }
    busy = false;
    for (const b of [save, saved, cancel]) b.disabled = false;
  };
  const save = el('button', { type: 'button', class: 'btn go wide', hidden: true, onclick: () => send({ photo, replace: Boolean(p.completed) }) }, p.completed ? 'Replace photo and email again' : 'Save photo and email certificate');
  const saved = el('button', { type: 'button', class: 'btn wide', hidden: !p.has_photo || Boolean(p.completed), onclick: () => send({ useSaved: true }) }, 'Use the photo already saved');
  const cancel = el('button', { type: 'button', class: 'btn wide', onclick: () => d.close() }, 'Cancel');
  const cam = camera(box, (x) => { photo = x; save.hidden = !x; if (x) save.scrollIntoView({ block: 'nearest' }); }, 'environment');
  const d = dialog(el('div', { class: 'stack' }, el('div', {}, el('h2', {}, niceName(p.name)), el('p', { class: 'hint link' }, `+${p.phone}, ${p.email}`)), box, err, save, saved, cancel));
  d.addEventListener('close', () => cam.idle(), { once: true });
}
async function resend(p) { try { await api(`${A}/participants/${p.id}/send`, { method: 'POST' }); await loadPeople(); } catch (e) { fail(e); } }
async function copy(t) { try { await navigator.clipboard.writeText(t); toast('Link copied'); } catch { ask('Copy this link', t, null); } }

function dialog(...kids) { const d = $('#dlg'); d.replaceChildren(...kids); if (!d.open) d.showModal(); return d; }
function ask(title, msg, ok, fn, danger) {
  const err = el('p', { class: 'formerr' });
  const go = async (e) => {
    e.target.disabled = true;
    try { await fn(); d.close(); } catch (x) { e.target.disabled = false; err.textContent = x.message; }
  };
  const d = dialog(el('div', { class: 'stack' }, el('h2', {}, title), el('p', { class: 'link' }, msg), err, el('div', { class: 'row' },
    ok ? el('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: go }, ok) : null,
    el('button', { class: 'btn', onclick: () => d.close() }, ok ? 'Cancel' : 'Close'))));
}
function formDialog(title, fields, ok, fn) {
  const err = el('p', { class: 'formerr' });
  const ins = fields.map(([k, label, value, type]) => [k, label, el('input', { id: 'd-' + k, type: type || 'text', maxLength: 140, value: value || '' })]);
  const submit = async (e) => {
    e.preventDefault();
    err.textContent = '';
    try { await fn(Object.fromEntries(ins.map(([k, , i]) => [k, i.value]))); d.close(); } catch (x) { err.textContent = x.message; }
  };
  const d = dialog(el('form', { class: 'stack', onsubmit: submit, noValidate: true },
    el('h2', {}, title), ...ins.map(([k, label, i]) => el('div', { class: 'field' }, el('label', { htmlFor: 'd-' + k }, label), i)), err,
    el('div', { class: 'row' }, el('button', { class: 'btn primary' }, ok), el('button', { type: 'button', class: 'btn', onclick: () => d.close() }, 'Cancel'))));
}
const edit = (p) => formDialog('Edit participant', [['name', 'Full name', p.name], ['email', 'Email', p.email, 'email'], ['phone', 'Phone with country code', '+' + p.phone, 'tel']], 'Save', async (v) => {
  await api(`${A}/participants/${p.id}`, { method: 'PUT', body: v });
  toast(p.completed ? 'Saved. The certificate was updated.' : 'Saved');
  await loadPeople();
});
const del = (p) => ask(`Delete ${p.name}?`, 'Their details, photo and certificate are removed. This cannot be undone.', 'Delete', async () => {
  await api(`${A}/participants/${p.id}`, { method: 'DELETE' });
  toast('Deleted');
  await loadPeople();
}, true);
$('#newT').onclick = () => formDialog('New training', [['title', 'Training name', ''], ['date', 'Date', new Date().toLocaleDateString('en-CA'), 'date'], ['venue', 'Event name', '']], 'Create training', async (v) => {
  const r = await api(A + '/trainings', { method: 'POST', body: v });
  tid = r.id;
  people = [];
  await refresh();
  fillForms();
  show('share');
  toast('Training created');
});

// ---- forms ----
const IMG = { logo1: ['Left logo on the website', 'image/png', 1100], logo2: ['Middle logo on the website', 'image/png', 1100], logo3: ['Right logo on the website', 'image/png', 1100], signature: ['Signature above Sumit Shah (dark ink on white paper; it prints in white)', 'image/png', 900] };
function fillForms() {
  const t = T(), link = `${S.base}/r/${t.slug}`, s = S.settings;
  $('#link').textContent = link;
  $('#open').href = link;
  $('#copy').onclick = () => copy(link);
  $('#qr').src = `${A}/trainings/${t.id}/qr.png?v=${encodeURIComponent(S.base)}`;
  $('#qrdl').href = `${A}/trainings/${t.id}/qr.png?download`;
  $('#csv').href = `${A}/trainings/${t.id}/export.csv`;
  $('#ttitle').value = t.title;
  $('#tdate').value = t.date;
  $('#tvenue').value = t.venue;
  $('#topen').checked = Boolean(t.open);
  for (const i of document.querySelectorAll('[data-s]')) { if (i.type === 'checkbox') i.checked = s[i.id]; else i.value = s[i.id]; }
  for (const k of ['mailUser', 'mailHost', 'mailSubject', 'mailBody']) $('#' + k).value = s[k];
  $('#passHint').textContent = s.mailPassSet ? 'An app password is saved. Leave blank to keep it.' : '';
  $('#mailState').textContent = S.mailReady ? 'Connected: certificates are emailed automatically' : 'Not connected';
  $('#mailState').className = 'pill ' + (S.mailReady ? 'ok' : 'warn');
  $('#mailOff').hidden = !s.mailPassSet;
  $('#waNote').hidden = S.mailReady;
  $('#waNote').textContent = 'Email is not connected yet, so certificates are issued but not emailed. Connect an account in the Email tab.';
  $('#imgs').replaceChildren(...Object.entries(IMG).map(([k, [label]]) => el('div', { class: 'field' }, el('label', { htmlFor: 'i-' + k }, label),
    el('input', { id: 'i-' + k, type: 'file', accept: 'image/png,image/jpeg', onchange: (e) => upload(k, e.target.files[0]) }),
    S.images[k] ? el('div', {}, act('Remove', () => removeImage(k), 'danger')) : null)));
  rows();
}
async function removeImage(k) {
  try { await api(`${A}/image/${k}`, { method: 'DELETE' }); await refresh(); fillForms(); preview(); } catch (e) { fail(e); }
}
function upload(kind, file) {
  if (!file) return;
  const [, type, max] = IMG[kind], url = URL.createObjectURL(file), im = new Image();
  im.onerror = () => { URL.revokeObjectURL(url); toast('That image could not be read. Choose a PNG or JPG.'); };
  im.onload = async () => {
    const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
    const c = el('canvas', { width: Math.round(im.naturalWidth * k), height: Math.round(im.naturalHeight * k) });
    const x = c.getContext('2d');
    x.drawImage(im, 0, 0, c.width, c.height);
    if (kind === 'signature') {
      // The certificate is dark, so ink becomes white and paper becomes transparent.
      const px = x.getImageData(0, 0, c.width, c.height), d = px.data;
      for (let i = 0; i < d.length; i += 4) {
        const light = (0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) / 255;
        d[i + 3] = Math.min(1, Math.max(0, (0.8 - light) * 1.8)) * d[i + 3];
        d[i] = d[i + 1] = d[i + 2] = 255;
      }
      x.putImageData(px, 0, 0);
    }
    URL.revokeObjectURL(url);
    try { await api(`${A}/image/${kind}`, { method: 'PUT', body: { image: c.toDataURL(type, 0.92) } }); await refresh(); fillForms(); preview(); toast('Image saved'); } catch (e) { fail(e); }
  };
  im.src = url;
}
function preview() {
  const u = `${A}/trainings/${tid}/preview.pdf?t=${Date.now()}`;
  $('#pdf').src = u + '#toolbar=0&navpanes=0&view=FitH';
  $('#pdfOpen').href = u;
}
function onSubmit(id, fn) {
  const f = $(id);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.formerr', f);
    err.textContent = '';
    try { await fn(); } catch (x) { if (x.status === 401) showLogin(); else err.textContent = x.message; }
  });
}
onSubmit('#tform', async () => {
  await api(`${A}/trainings/${tid}`, { method: 'PUT', body: { title: $('#ttitle').value, date: $('#tdate').value, venue: $('#tvenue').value, open: $('#topen').checked } });
  await refresh();
  fillForms();
  toast('Training saved');
});
onSubmit('#cform', async () => {
  await api(A + '/settings', { method: 'PUT', body: Object.fromEntries([...document.querySelectorAll('[data-s]')].map((i) => [i.id, i.type === 'checkbox' ? i.checked : i.value])) });
  await refresh();
  fillForms();
  preview();
  toast('Certificate saved');
});
onSubmit('#mform', async () => {
  const b = $('#mgo');
  b.disabled = true;
  b.textContent = 'Connecting…';
  try {
    await api(A + '/mail', { method: 'PUT', body: Object.fromEntries(['mailUser', 'mailPass', 'mailHost'].map((k) => [k, $('#' + k).value])) });
    $('#mailPass').value = '';
    await refresh();
    fillForms();
    toast('Connected. A test certificate was sent to ' + S.settings.mailUser);
  } finally { b.disabled = false; b.textContent = 'Connect and send test'; }
});
onSubmit('#bform', async () => {
  await api(A + '/settings', { method: 'PUT', body: { mailSubject: $('#mailSubject').value, mailBody: $('#mailBody').value } });
  await refresh();
  fillForms();
  toast('Email text saved');
});
$('#mailOff').onclick = async () => { try { await api(A + '/mail-disconnect', { method: 'POST' }); await refresh(); fillForms(); toast('Email disconnected'); } catch (e) { fail(e); } };
onSubmit('#pform', async () => { await api(A + '/password', { method: 'PUT', body: { password: $('#npw').value } }); $('#npw').value = ''; toast('Admin password changed'); });
boot();
