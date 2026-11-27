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
      svgEl('image', { href: '/static/art/cert.jpg?v=11', width: SHEET.w, height: SHEET.h }),
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

// Lets the operator move, zoom, turn and brighten the picture inside the certificate's photo frame.
function editor(box, src, w, h, onUse, extra) {
  const ratio = PHOTO.w / PHOTO.h, view = el('canvas', { class: 'edit', width: 720, height: Math.round(720 / ratio) });
  const ctx = view.getContext('2d');
  let rot = 0, zoom = 1, ox = 0, oy = 0, light = 100;
  const dims = () => (rot % 180 ? [h, w] : [w, h]);
  const scale = () => { const [iw, ih] = dims(); return Math.max(view.width / iw, view.height / ih) * zoom; };
  const clamp = () => {
    const [iw, ih] = dims(), s = scale(), mx = Math.max(0, (iw * s - view.width) / 2), my = Math.max(0, (ih * s - view.height) / 2);
    ox = Math.min(mx, Math.max(-mx, ox)); oy = Math.min(my, Math.max(-my, oy));
  };
  const paint = (c, W, H, k) => {
    c.save(); c.fillStyle = '#fff'; c.fillRect(0, 0, W, H);
    c.filter = light === 100 ? 'none' : `brightness(${light}%)`;
    c.translate(W / 2 + ox * k, H / 2 + oy * k); c.rotate((rot * Math.PI) / 180);
    const sc = scale() * k; c.drawImage(src, (-w * sc) / 2, (-h * sc) / 2, w * sc, h * sc); c.restore();
  };
  const draw = () => { clamp(); paint(ctx, view.width, view.height, 1); };
  // Start near the top, where faces usually are.
  const reset = () => { rot = 0; zoom = 1; light = 100; ox = 0; oy = 1e6; zoomIn.value = 1; lightIn.value = 100; draw(); };
  const zoomIn = el('input', { type: 'range', min: 1, max: 4, step: 0.01, value: 1, id: 'edZoom', oninput: (e) => { zoom = Number(e.target.value); draw(); } });
  const lightIn = el('input', { type: 'range', min: 60, max: 160, step: 1, value: 100, id: 'edLight', oninput: (e) => { light = Number(e.target.value); draw(); } });
  let drag = null;
  view.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; view.setPointerCapture(e.pointerId); });
  view.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const k = view.width / view.getBoundingClientRect().width;
    ox += (e.clientX - drag.x) * k; oy += (e.clientY - drag.y) * k; drag = { x: e.clientX, y: e.clientY }; draw();
  });
  const end = () => { drag = null; };
  view.addEventListener('pointerup', end); view.addEventListener('pointercancel', end);
  view.addEventListener('wheel', (e) => { e.preventDefault(); zoom = Math.min(4, Math.max(1, zoom * (e.deltaY < 0 ? 1.08 : 0.93))); zoomIn.value = zoom; draw(); }, { passive: false });
  const use = () => {
    const across = view.width / scale() * (w / Math.max(w, 1));
    const OW = Math.round(Math.min(1400, Math.max(600, across))), OH = Math.round(OW / ratio), c = el('canvas', { width: OW, height: OH });
    paint(c.getContext('2d'), OW, OH, OW / view.width);
    onUse(c.toDataURL('image/jpeg', 0.9));
  };
  const btn = (label, fn, cls = 'btn small') => el('button', { type: 'button', class: cls, onclick: fn }, label);
  box.replaceChildren(...box.querySelectorAll('input[type=file]'),
    el('p', { class: 'hint' }, 'Drag the photo to move it. Use the sliders to zoom and brighten.'),
    el('div', { class: 'view editing' }, view),
    el('div', { class: 'edtools' },
      el('label', { htmlFor: 'edZoom' }, 'Zoom'), zoomIn, el('label', { htmlFor: 'edLight' }, 'Brightness'), lightIn),
    el('div', { class: 'row' }, btn('Turn', () => { rot = (rot + 90) % 360; draw(); }), btn('Reset', reset), ...extra.map(([l, f]) => btn(l, f))),
    btn('Use this photo', use, 'btn primary wide'));
  reset();
}

/** Live camera. onPhoto receives a JPEG data URL, or null when the photo is cleared. */
export function camera(box, onPhoto, facing = 'user', upload = false) {
  let stream = null, run = 0;
  const stop = () => { run++; stream?.getTracks().forEach((t) => t.stop()); stream = null; };
  // Browsers opened inside other apps can refuse the live camera; the phone's camera app then takes over.
  const file = el('input', { type: 'file', accept: 'image/*', hidden: true });
  file.setAttribute('capture', facing);
  // Without "capture", the same picker opens the computer's files instead of the camera.
  const pick = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/heic,image/*', hidden: true });
  const read = (input) => () => {
    const f = input.files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    const im = new Image();
    im.onload = () => { adjust(im, im.naturalWidth, im.naturalHeight); URL.revokeObjectURL(url); };
    im.onerror = () => { idle('That photo could not be read. Try again.'); URL.revokeObjectURL(url); };
    im.src = url;
    input.value = '';
  };
  file.addEventListener('change', read(file));
  pick.addEventListener('change', read(pick));
  const show = (...n) => box.replaceChildren(file, pick, ...n);
  const button = (label, fn, cls = 'btn') => el('button', { type: 'button', class: cls, onclick: fn }, label);
  function idle(msg) {
    stop();
    show(...(msg ? [el('p', { class: 'formerr' }, msg)] : []), el('div', { class: 'row' },
      button('Capture live photo', start, 'btn primary'),
      upload ? button('Upload from computer', () => pick.click()) : null,
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
        button('Take photo', () => { if (v.videoWidth) adjust(frame(v, mirror), v.videoWidth, v.videoHeight); }, 'btn primary'),
        button('Switch camera', () => { facing = facing === 'user' ? 'environment' : 'user'; start(); }),
        button('Cancel', () => idle())));
      await v.play().catch(() => {});
    } catch (e) {
      if (mine !== run) return;
      idle(e.name === 'NotAllowedError' ? 'Camera access is blocked. Allow the camera for this site in your browser settings, or use the phone camera.'
        : 'The camera could not start. Close other apps using it and try again, or use the phone camera.');
    }
  }
  // The whole camera frame is kept, so it can still be moved and zoomed afterwards.
  const frame = (v, mirror) => {
    const c = el('canvas', { width: v.videoWidth, height: v.videoHeight }), x = c.getContext('2d');
    if (mirror) { x.translate(c.width, 0); x.scale(-1, 1); }
    x.drawImage(v, 0, 0); return c;
  };
  let last = null;
  function adjust(src, w, h) {
    stop();
    onPhoto(null);
    last = [src, w, h];
    editor(box, src, w, h, done, [['Retake', start], ...(upload ? [['Another file', () => pick.click()]] : [])]);
  }
  function done(data) {
    show(el('div', { class: 'view shot' }, el('img', { src: data, alt: 'Captured photo' })), el('div', { class: 'row' },
      button('Adjust', () => adjust(...last)), button('Retake photo', () => { onPhoto(null); start(); }), upload ? button('Upload another', () => pick.click()) : null));
    onPhoto(data);
  }
  addEventListener('pagehide', stop);
  idle();
  return { idle };
}
