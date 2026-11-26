import { layout, SHEET, PHOTO } from './cert-layout.js';

export const $ = (s, r = document) => r.querySelector(s);
export function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k in n) n[k] = v;
    else n.setAttribute(k, v);
  }
  n.append(...kids.filter((k) => k != null && k !== false));
  return n;
}
export async function api(url, opts = {}) {
  let res;
  try {
    res = await fetch(url, { ...opts, headers: opts.body ? { 'Content-Type': 'application/json' } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined });
  } catch { throw Object.assign(new Error('No connection to the site. Check your internet and try again.'), { status: 0 }); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Try again.'), { status: res.status, field: data.field });
  return data;
}

export function header(brand, training) {
  if (!$('#logos').children.length) {
    $('#logos').replaceChildren(...brand.logos.map((k) => el('img', {
      src: `/api/brand/${k}?v=2`, alt: '',
      // Each logo gets a share of the row by its shape, so all look the same height. Compact logos get a little more.
      onload: (e) => e.target.style.setProperty('--a', Math.max(2.15, e.target.naturalWidth / e.target.naturalHeight)),
    })));
  }
  $('#logoBar').hidden = !brand.logos.length;
  $('#org').textContent = brand.logos.length ? '' : brand.orgName;
  $('#tag').textContent = `${brand.pledge} ${brand.pledgeBig}`;
  $('#title').textContent = training.title;
  $('#meta').textContent = [training.date, training.venue].filter(Boolean).join(', ');
}

const FACE = { script: "400 1px 'Great Vibes'", hand: "700 1px Kalam" };
const ctx = document.createElement('canvas').getContext('2d');
const measure = (t, f, size) => { ctx.font = FACE[f].replace('1px', '100px'); return (ctx.measureText(t).width * size) / 100; };
const fonts = (t) => Promise.all(Object.values(FACE).map((f) => document.fonts.load(f.replace('1px', '20px'), 'Aa' + t)));
const svgEl = (tag, attrs, ...kids) => {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  n.append(...kids);
  return n;
};
/** Draws the on-screen certificate. */
export function drawCert(box, d) {
  const paint = () => {
    const items = layout({ name: d.name, photo: Boolean(d.photo), watermark: d.brand.watermark }, measure);
    const src = (k) => (k === 'photo' ? d.photo : `/static/art/${k}.png?v=6`);
    box.replaceChildren(svgEl('svg', { viewBox: `0 0 ${SHEET.w} ${SHEET.h}`, role: 'img', 'aria-label': 'Certificate preview' },
      svgEl('image', { href: '/static/art/cert.jpg?v=10', width: SHEET.w, height: SHEET.h }),
      ...items.map((i) => {
        const transform = i.rot ? `rotate(${i.rot} ${i.cx} ${i.cy})` : null;
        if (i.type === 'image') return svgEl('image', { href: src(i.key), x: i.x, y: i.y, width: i.w, height: i.h, preserveAspectRatio: i.cover ? 'xMidYMin slice' : 'xMidYMid meet', transform });
        const [, slant, w, fam] = /^(italic )?(\d+) 1px (.+)$/.exec(FACE[i.font]);
        return svgEl('text', { x: i.x, y: i.y, 'font-family': fam, 'font-weight': w, 'font-style': slant ? 'italic' : null, 'font-size': i.size, fill: i.color, 'fill-opacity': i.opacity, transform, 'xml:space': 'preserve' }, i.text);
      })));
  };
  paint();
  const stamp = (box._stamp = {});
  fonts(d.name || 'Your name').then(() => { if (box._stamp === stamp) paint(); }).catch(() => {});
}

// Crops to the photo window of the certificate, so what the camera frame shows is what is printed.
function toJpeg(src, w, h, mirror, up = 0.5) {
  const ratio = PHOTO.w / PHOTO.h;
  const cw = Math.min(w, h * ratio), ch = cw / ratio;
  const k = Math.min(1, 1200 / cw);
  const c = el('canvas', { width: Math.round(cw * k), height: Math.round(ch * k) });
  const x = c.getContext('2d');
  if (mirror) { x.translate(c.width, 0); x.scale(-1, 1); }
  x.drawImage(src, (w - cw) / 2, (h - ch) * up, cw, ch, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.9);
}

/** Live camera. onPhoto receives a JPEG data URL, or null when the photo is cleared. */
export function camera(box, onPhoto, facing = 'user') {
  let stream = null, run = 0;
  const stop = () => { run++; stream?.getTracks().forEach((t) => t.stop()); stream = null; };
  // Browsers opened inside other apps can refuse the live camera; the phone's camera app then takes over.
  const file = el('input', { type: 'file', accept: 'image/*', hidden: true });
  file.setAttribute('capture', facing);
  file.addEventListener('change', () => {
    const f = file.files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    const im = new Image();
    im.onload = () => { done(toJpeg(im, im.naturalWidth, im.naturalHeight, false, 0.2)); URL.revokeObjectURL(url); };
    im.onerror = () => { idle('That photo could not be read. Try again.'); URL.revokeObjectURL(url); };
    im.src = url;
    file.value = '';
  });
  const show = (...n) => box.replaceChildren(file, ...n);
  const button = (label, fn, cls = 'btn') => el('button', { type: 'button', class: cls, onclick: fn }, label);
  function idle(msg) {
    stop();
    show(...(msg ? [el('p', { class: 'formerr' }, msg)] : []), el('div', { class: 'row' },
      button('Capture live photo', start, 'btn primary'),
      msg ? button('Use phone camera', () => file.click()) : null));
  }
  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) return file.click();
    stop();
    const mine = ++run;
    show(el('p', { class: 'hint' }, 'Allow camera access when your phone asks.'));
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1440 } } });
      if (mine !== run) return s.getTracks().forEach((t) => t.stop());
      stream = s;
      const v = el('video', { muted: true, autoplay: true, playsInline: true, srcObject: s });
      v.setAttribute('playsinline', '');
      v.classList.toggle('mirror', facing === 'user');
      const mirror = facing === 'user';
      show(el('p', { class: 'hint' }, 'Keep the face and hands inside the frame.'), el('div', { class: 'view' }, v), el('div', { class: 'row' },
        button('Take photo', () => { if (v.videoWidth) done(toJpeg(v, v.videoWidth, v.videoHeight, mirror)); }, 'btn primary'),
        button('Switch camera', () => { facing = facing === 'user' ? 'environment' : 'user'; start(); }),
        button('Cancel', () => idle())));
      await v.play().catch(() => {});
    } catch (e) {
      if (mine !== run) return;
      idle(e.name === 'NotAllowedError' ? 'Camera access is blocked. Allow the camera for this site in your browser settings, or use the phone camera.'
        : 'The camera could not start. Close other apps using it and try again, or use the phone camera.');
    }
  }
  function done(data) {
    stop();
    show(el('div', { class: 'view shot' }, el('img', { src: data, alt: 'Captured photo' })), el('div', { class: 'row' }, button('Retake photo', () => { onPhoto(null); start(); })));
    onPhoto(data);
  }
  addEventListener('pagehide', stop);
  idle();
  return { idle };
}
