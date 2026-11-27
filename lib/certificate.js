import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { layout, SHEET } from '../public/cert-layout.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const face = (...p) => path.join(root, 'node_modules', '@expo-google-fonts', ...p);
const FONTS = {
  script: face('great-vibes', '400Regular', 'GreatVibes_400Regular.ttf'),
  hand: face('kalam', '700Bold', 'Kalam_700Bold.ttf'),
};
// File paths, not buffers: PDFKit then embeds each of these images only once per document.
const ART = path.join(root, 'public', 'art', 'cert-print.jpg');
const MARKS = Object.fromEntries(['white', 'red'].map((c) => ['watermark-' + c, path.join(root, 'public', 'art', `watermark-${c}.png`)]));
const K = 600 / SHEET.w; // sheet units to points: 600 x 750 pt

/** Throws when the buffer is not an image the PDF engine can embed. */
export function assertImage(buf) {
  new PDFDocument({ autoFirstPage: false }).openImage(buf);
}

/** s: settings, t: {title, date, venue}, p: {name, certNo}, img: {photo, logo1, logo2, logo3} buffers or null */
export function renderCertificate(s, t, p, img) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [SHEET.w * K, SHEET.h * K], margin: 0, info: { Title: `Certificate - ${p.name}`, Author: s.orgName, Subject: t.title } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      for (const [k, v] of Object.entries(FONTS)) doc.registerFont(k, v);
      paintCertificate(doc, s, p.name, img.photo);
      doc.end();
    } catch (e) { reject(e); }
  });
}

function paintCertificate(doc, s, name, photo) {
  doc.save();
  doc.scale(K);
  doc.image(ART, 0, 0, { width: SHEET.w, height: SHEET.h });
  const measure = (text, font, size) => doc.font(font).fontSize(size).widthOfString(text);
  for (const i of layout({ name, photo: Boolean(photo), watermark: s.watermark }, measure)) draw(doc, i, { photo, ...MARKS });
  doc.restore();
}

/** Writes every certificate into one PDF, a page each. people: [{name, photo: file path or null}] */
export function streamCertificates(out, s, title, people) {
  const doc = new PDFDocument({ size: [SHEET.w * K, SHEET.h * K], margin: 0, autoFirstPage: false, info: { Title: `${title} - all certificates`, Author: s.orgName } });
  doc.pipe(out);
  for (const [k, v] of Object.entries(FONTS)) doc.registerFont(k, v);
  for (const p of people) { doc.addPage(); paintCertificate(doc, s, p.name, p.photo); }
  doc.end();
}

/** Writes every participant's plain photo into one PDF, a page each, with the name underneath. */
export function streamPhotos(out, s, title, people) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, info: { Title: `${title} - all photos`, Author: s.orgName } });
  doc.pipe(out);
  for (const [k, v] of Object.entries(FONTS)) doc.registerFont(k, v);
  for (const p of people) {
    doc.addPage();
    doc.image(p.photo, 40, 40, { fit: [515, 680], align: 'center', valign: 'center' });
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#12324A');
    const font = /\p{Script=Devanagari}/u.test(p.name) ? 'hand' : 'Helvetica-Bold';
    doc.font(font).text(p.name, 40, 742, { width: 515, align: 'center', lineBreak: false });
    doc.font('Helvetica').fontSize(11).fillColor('#48647A').text(p.email, 40, 770, { width: 515, align: 'center', lineBreak: false });
  }
  doc.end();
}

function draw(doc, i, img) {
  doc.save();
  if (i.rot) doc.rotate(i.rot, { origin: [i.cx, i.cy] });
  if (i.type === 'rect') doc.rect(i.x, i.y, i.w, i.h).fill(i.color);
  else if (i.type === 'image') {
    if (i.cover) doc.rect(i.x, i.y, i.w, i.h).clip();
    doc.image(img[i.key], i.x, i.y, { [i.cover ? 'cover' : 'fit']: [i.w, i.h], align: 'center', valign: i.cover ? 'top' : 'center' });
  } else doc.font(i.font).fontSize(i.size).fillColor(i.color, i.opacity).text(i.text, i.x, i.y, { lineBreak: false, baseline: 'alphabetic' });
  doc.restore();
}
