// Where the photo and name go on the supplied certificate (2160 x 2700), shared by the PDF and the preview.
export const SHEET = { w: 2160, h: 2700 };
export const PHOTO = { w: 1484, h: 1430 };
const TILT = { rot: -2.5, cx: 1070.6, cy: 1226.1 };
// Great Vibes has no Hindi letters, so Hindi names use a Hindi handwriting face.
export const fontFor = (f, t) => (/\p{Script=Devanagari}/u.test(t) ? 'hand' : f);

/** A name typed all in capitals or all in small letters is unreadable in cursive. */
export function niceName(n) {
  if (n !== n.toUpperCase() && n !== n.toLowerCase()) return n;
  return n.toLowerCase().replace(/(^|[\s.'’(-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
}

/** d: {name, photo: bool}; measure(text, font, size) -> width */
export function layout(d, measure) {
  const out = [];
  if (d.photo) out.push({ type: 'image', key: 'photo', x: TILT.cx - PHOTO.w / 2, y: TILT.cy - PHOTO.h / 2, ...PHOTO, cover: true, ...TILT });
  const text = d.name ? niceName(d.name) : 'Your name';
  const font = fontFor('script', text);
  let size = font === 'hand' ? 98 : 144;
  while (size > 40 && measure(text, font, size) > 1400) size -= 2;
  out.push({ type: 'text', text, font, size, x: TILT.cx - measure(text, font, size) / 2, y: 2090, color: '#034E70', opacity: d.name ? 1 : 0.35, ...TILT });
  return out;
}
