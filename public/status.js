import { $, api, header, drawCert } from './common.js';
import { niceName } from './cert-layout.js';

const token = encodeURIComponent(location.pathname.split('/')[2] || '');
let last = '', timer, gone = false;
async function load() {
  clearTimeout(timer);
  if (gone) return;
  let wait = 5000;
  try {
    const d = await api('/api/p/' + token);
    const now = JSON.stringify(d);
    if (now !== last) { last = now; render(d); }
    if (d.completed) wait = 20000;
  } catch (e) {
    if (e.status === 404) {
      gone = true;
      $('#stTitle').textContent = 'Link not found';
      $('#stMsg').textContent = 'Check the link, or ask the trainer for yours.';
      for (const id of ['#cert', '#files', '#save']) $(id).hidden = true;
      return;
    }
    if (!last) { $('#stTitle').textContent = 'Not connected'; $('#stMsg').textContent = e.message; }
  }
  clearTimeout(timer);
  timer = setTimeout(load, wait);
}
function render(d) {
  header(d.brand, d.training);
  const photoUrl = d.hasPhoto ? `/file/${token}/photo.jpg?view&t=${Date.now()}` : null;
  drawCert($('#cert'), { ...d, photo: photoUrl });
  $('#state').classList.toggle('done', d.completed);
  $('#stTitle').textContent = d.completed ? `Congratulations, ${niceName(d.name)}` : `You are registered, ${niceName(d.name)}`;
  $('#stMsg').textContent = !d.completed ? `Next, go to the CPR station. Our team takes your photo, and your certificate is emailed to ${d.email} once it is added.`
    : d.sent ? `Your certificate was emailed to ${d.email}. Check the spam folder too. You can also download it here.`
      : d.sending ? `Your certificate is being emailed to ${d.email}. You can also download it here.` : 'Your certificate is ready to download.';
  $('#files').hidden = !d.completed;
  $('#save').hidden = d.completed;
  $('#pdf').href = `/file/${token}/certificate.pdf`;
  $('#jpg').href = `/file/${token}/photo.jpg`;
  $('#jpg').hidden = !d.hasPhoto;
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
load();
