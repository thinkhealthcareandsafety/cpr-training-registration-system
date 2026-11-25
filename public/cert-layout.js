// Where the participant's details go on the supplied certificate (2800 x 1980), shared by the PDF and the preview.
export const SHEET = { w: 2800, h: 1980 };
export const PHOTO = { w: 618, h: 794 };
const TILT = { rot: -3.5, cx: 532.7, cy: 903.6 };
// Great Vibes has no Hindi letters, so Hindi names use a Hindi handwriting face.
export const fontFor = (f, t) => (/\p{Script=Devanagari}/u.test(t) ? 'hand' : f);

/** A name typed all in capitals or all in small letters is unreadable in cursive. */
export function niceName(n) {
  if (n !== n.toUpperCase() && n !== n.toLowerCase()) return n;
  return n.toLowerCase().replace(/(^|[\s.'’(-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
}

/** d: {name, photo: bool, signature: bool}; measure(text, font, size) -> width */
export function layout(d, measure) {
  const out = [];
  if (d.photo) {
    out.push({ type: 'image', key: 'photo', x: TILT.cx - PHOTO.w / 2, y: TILT.cy - PHOTO.h / 2, ...PHOTO, cover: true, ...TILT });
    out.push({ type: 'image', key: 'tape', x: 404, y: 418, w: 256, h: 108 });
  }
  const text = d.name ? niceName(d.name) : 'Your name';
  const font = fontFor('script', text);
  let size = font === 'hand' ? 126 : 196;
  while (size > 40 && measure(text, font, size) > 1340) size -= 2;
  out.push({ type: 'text', text, font, size, x: 1108, y: 990, color: '#FFFFFF', opacity: d.name ? 1 : 0.35 });
  if (d.signature) out.push({ type: 'image', key: 'signature', x: 289, y: 1515, w: 460, h: 150 });
  return out;
}
