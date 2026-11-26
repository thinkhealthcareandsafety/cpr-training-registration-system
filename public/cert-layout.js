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

const WM = { w: 330, h: Math.round(330 * 0.815000) };
/** d: {name, photo: bool, watermark: 'white' | 'red' | 'none'}; measure(text, font, size) -> width */
export function layout(d, measure) {
  const out = [];
  if (d.photo) {
    out.push({ type: 'image', key: 'photo', x: TILT.cx - PHOTO.w / 2, y: TILT.cy - PHOTO.h / 2, ...PHOTO, cover: true, ...TILT });
    // The CPR heart sits in the lower right corner of the photo, turned with it.
    if (d.watermark === 'white' || d.watermark === 'red') out.push({ type: 'image', key: 'watermark-' + d.watermark, x: TILT.cx + PHOTO.w / 2 - WM.w - 46, y: TILT.cy + PHOTO.h / 2 - WM.h - 46, ...WM, ...TILT });
  }
  const text = d.name ? niceName(d.name) : 'Your name';
  const font = fontFor('script', text);
  let size = font === 'hand' ? 92 : 132;
  while (size > 36 && measure(text, font, size) > 1000) size -= 2;
  // Sits on the "I, ____" line, which slopes with the photo.
  out.push({ type: 'text', text, font, size, x: 1160 - measure(text, font, size) / 2, y: 2156, color: '#034E70', opacity: d.name ? 1 : 0.35, rot: -2.5, cx: 1160, cy: 2156 });
  return out;
}
