import express from 'express';
import QRCode from 'qrcode';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { renderCertificate, assertImage } from './lib/certificate.js';
import { niceName } from './public/cert-layout.js';
import * as mail from './lib/mail.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const PHOTOS = path.join(DATA, 'photos'), CERTS = path.join(DATA, 'certificates'), BRAND = path.join(DATA, 'brand');
for (const d of [PHOTOS, CERTS, BRAND]) fs.mkdirSync(d, { recursive: true });
// First run with this design: start with the bundled logos. The admin can replace or remove them.
const LOGOS = ['logo1', 'logo2', 'logo3'];
const IMAGES = [...LOGOS, 'signature']; // the signature is never served publicly, only printed
if (!fs.existsSync(path.join(BRAND, 'seeded'))) {
  for (const k of LOGOS) {
    const src = path.join(ROOT, 'assets', `${k}.png`);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(BRAND, `${k}.png`));
  }
  fs.writeFileSync(path.join(BRAND, 'seeded'), '');
}

// ---------- storage ----------
const db = new DatabaseSync(path.join(DATA, 'registration.db'));
db.exec(`
PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS trainings (
  id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, date TEXT NOT NULL,
  venue TEXT NOT NULL DEFAULT '', open INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS participants (
  id INTEGER PRIMARY KEY, training_id INTEGER NOT NULL REFERENCES trainings(id), token TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, has_photo INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL, completed INTEGER, cert_no TEXT UNIQUE,
  delivery TEXT NOT NULL DEFAULT 'none', delivery_error TEXT NOT NULL DEFAULT '', delivery_at INTEGER,
  UNIQUE (training_id, phone));
CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL, role TEXT NOT NULL DEFAULT 'admin');
UPDATE participants SET delivery='failed', delivery_error='The server stopped while sending. Check with the participant, then resend.' WHERE delivery='sending';
`);
if (!db.prepare('PRAGMA table_info(sessions)').all().some((c) => c.name === 'role')) db.exec("ALTER TABLE sessions ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'");
const q = (sql) => db.prepare(sql);
const DEFAULTS = {
  orgName: 'Think Health Care and Safety', pledge: 'I pledge to', pledgeBig: 'save a life.', watermark: 'white',
  mailUser: '', mailPass: '', mailHost: '', mailSubject: 'Congratulations, {name}! Your {training} certificate is here',
  mailBody: `Congratulations on learning {training} at {event} on {date}. You are now one of the people who can step forward when a heart stops.

Your certificate and photo are attached. Save them, and share them with pride to inspire your family, friends and colleagues to learn CPR too.

Remember, if someone collapses and is not breathing normally:
1. Check that the scene is safe.
2. Call 112 and ask for an AED.
3. Push hard and fast in the centre of the chest, 100 to 120 times a minute, until help arrives.

Thank you for your pledge to save a life.`,
};
const REQUIRED = ['orgName', 'pledge', 'pledgeBig', 'mailSubject', 'mailBody'];
function getSettings() {
  const s = { ...DEFAULTS };
  for (const r of q('SELECT key, value FROM settings').all()) if (r.key in DEFAULTS) s[r.key] = JSON.parse(r.value);
  return s;
}
const putSetting = (k, v) => q('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, JSON.stringify(v));
const scrypt = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
function setPassword(pw, key = '_password') {
  const salt = crypto.randomBytes(16).toString('hex');
  putSetting(key, `${salt}:${scrypt(pw, salt)}`);
}
const storedPassword = (key = '_password') => { const r = q('SELECT value FROM settings WHERE key=?').get(key); return r && JSON.parse(r.value); };
q("DELETE FROM sessions WHERE role<>'admin'").run();
q("DELETE FROM settings WHERE key='_staff'").run();
let firstPassword = null;
if (!storedPassword()) {
  firstPassword = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  // Saved before anything else can fail, so the password is never lost.
  fs.writeFileSync(path.join(DATA, 'admin-password.txt'), firstPassword + '\n');
  setPassword(firstPassword);
}
if (!q('SELECT 1 FROM trainings').get()) {
  q('INSERT INTO trainings (slug,title,date,created) VALUES (?,?,?,?)').run(crypto.randomBytes(4).toString('hex'), 'Training Programme', today(), Date.now());
}

// ---------- helpers ----------
function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()); }
const longDate = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const fromProxy = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const proto = (req) => (req.get('x-forwarded-proto') || 'http').split(',')[0];
const baseUrl = (req) => publicUrl || `${proto(req)}://${req.get('host')}`;
const clientIp = (req) => (fromProxy(req) && req.get('cf-connecting-ip')) || req.socket.remoteAddress;
const readIf = (f) => (fs.existsSync(f) ? fs.readFileSync(f) : null);
const brandFile = (k) => ['png', 'jpg'].map((e) => path.join(BRAND, `${k}.${e}`)).find((f) => fs.existsSync(f));
const photoFile = (p) => path.join(PHOTOS, `${p.id}.jpg`);
const certFile = (p) => path.join(CERTS, `${p.id}.pdf`);
class Bad extends Error { constructor(msg, field, status = 400) { super(msg); this.field = field; this.status = status; } }

const hits = new Map();
setInterval(() => { const n = Date.now(); for (const [k, v] of hits) if (v.until < n) hits.delete(k); }, 60000).unref();
const limit = (name, max, ms) => (req, res, next) => {
  const k = name + clientIp(req), n = Date.now();
  let h = hits.get(k);
  if (!h || h.until < n) hits.set(k, (h = { c: 0, until: n + ms }));
  if (++h.c > max) return res.status(429).json({ error: 'Too many attempts. Wait a few minutes and try again.' });
  next();
};

const text = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
function cleanPerson(b) {
  const name = text(b.name, 70).normalize('NFC');
  if (name.length < 2 || !/^[\p{Script=Latin}\p{Script=Devanagari}\p{M}‌‍ .,'’()-]+$/u.test(name) || !/\p{L}/u.test(name))
    throw new Bad('Enter your full name in English or Hindi letters.', 'name');
  const email = text(b.email, 120).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Bad('Enter a valid email address, like name@example.com.', 'email');
  const cc = String(b.cc ?? '').replace(/\D/g, '');
  let num = String(b.phone ?? '').replace(/\D/g, '');
  if (!cc || cc.length > 3) throw new Bad('Enter a country code, like 91.', 'phone');
  if (cc === '91') {
    if (num.length === 12 && num.startsWith('91')) num = num.slice(2);
    num = num.replace(/^0+/, '');
    if (!/^[6-9]\d{9}$/.test(num)) throw new Bad('Enter a 10-digit mobile number.', 'phone');
  } else if (!/^\d{6,12}$/.test(num)) throw new Bad('Enter a valid phone number.', 'phone');
  return { name, email, phone: cc + num };
}
function decodeJpeg(dataUrl) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  const buf = m && Buffer.from(m[1], 'base64');
  if (!buf || buf[0] !== 0xff || buf[1] !== 0xd8) throw new Bad('The photo could not be read. Take it again.', 'photo');
  try { assertImage(buf); } catch { throw new Bad('The photo could not be read. Take it again.', 'photo'); }
  return buf;
}
const trainingOf = (p) => q('SELECT * FROM trainings WHERE id=?').get(p.training_id);
const brandBuf = (k) => { const f = brandFile(k); return f ? fs.readFileSync(f) : null; };
const images = (photo) => ({ photo, ...Object.fromEntries(IMAGES.map((k) => [k, brandBuf(k)])) });
const certTraining = (t) => ({ title: t.title, date: longDate(t.date), venue: t.venue });
async function buildCert(p) {
  const t = trainingOf(p);
  const pdf = await renderCertificate(getSettings(), certTraining(t), { name: p.name, certNo: p.cert_no },
    images(p.has_photo ? readIf(photoFile(p)) : null));
  fs.writeFileSync(certFile(p), pdf);
  return pdf;
}
const pdfName = (p) => `Certificate-${p.cert_no}.pdf`;

// ---------- delivery: one email at a time, in order ----------
let queue = Promise.resolve();
function enqueue(id) {
  q("UPDATE participants SET delivery='queued', delivery_error='' WHERE id=?").run(id);
  queue = queue.then(async () => {
    // Claiming the row here means a deleted or already sent participant is skipped.
    if (!q("UPDATE participants SET delivery='sending' WHERE id=? AND delivery='queued' AND completed IS NOT NULL").run(id).changes) return;
    const p = q('SELECT * FROM participants WHERE id=?').get(id);
    try {
      const pdf = readIf(certFile(p)) || (await buildCert(p));
      await mail.sendCertificate(getSettings(), { ...certTraining(trainingOf(p)), training: trainingOf(p).title, to: p.email, name: niceName(p.name), pdf, pdfName: pdfName(p), photo: p.has_photo ? readIf(photoFile(p)) : null });
      q("UPDATE participants SET delivery='sent', delivery_at=? WHERE id=?").run(Date.now(), id);
    } catch (e) {
      q("UPDATE participants SET delivery='failed', delivery_error=? WHERE id=?").run(text(mail.explain(e), 300), id);
    }
  }).catch((e) => console.error('delivery', e));
}
// Issues the certificate once and queues the email. A photo is required, and the WHERE clause makes double clicks harmless.
async function issue(id) {
  const no = `TC-${today().slice(0, 4)}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  if (!q("UPDATE participants SET completed=?, cert_no=?, delivery='ready' WHERE id=? AND completed IS NULL AND has_photo=1").run(Date.now(), no, id).changes) return false;
  try { await buildCert(getP(id)); } catch (e) { console.error('certificate', id, e); }
  if (mail.configured(getSettings())) enqueue(id);
  return true;
}

// ---------- app ----------
export const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'",
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
    'X-Robots-Tag': 'noindex',
  });
  if (req.path.startsWith('/api') || req.path.startsWith('/file')) res.set('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '9mb' }));
const page = (f) => (req, res) => res.sendFile(f, { root: path.join(ROOT, 'public') });
const asset = (pkg) => express.static(path.join(ROOT, 'node_modules', '@fontsource', pkg, 'files'), { maxAge: '30d' });
for (const f of ['mukta', 'figtree', 'great-vibes', 'kalam']) app.use(`/fonts/${f}`, asset(f));
app.use('/static', express.static(path.join(ROOT, 'public'), { index: false }));
app.get('/', (req, res) => {
  const t = q('SELECT slug FROM trainings WHERE open=1 ORDER BY created DESC, id DESC').get();
  if (t) res.redirect(`/r/${t.slug}`); else page('register.html')(req, res);
});
app.get('/r/:slug', page('register.html'));
app.get('/p/:token', page('status.html'));
app.get('/admin', page('admin.html'));
app.get('/staff', (req, res) => res.redirect('/admin'));
app.get('/healthz', (req, res) => res.json({ ok: true }));

// participant API
const PUBLIC = ['orgName', 'pledge', 'pledgeBig', 'watermark'];
const brandInfo = () => {
  const s = getSettings();
  return { ...Object.fromEntries(PUBLIC.map((k) => [k, s[k]])), logos: LOGOS.filter((k) => brandFile(k)) };
};
const trainingInfo = (t) => ({ title: t.title, date: longDate(t.date), venue: t.venue, open: Boolean(t.open) });
const sendFile = (res, dir, file, name, inline) => {
  if (!fs.existsSync(path.join(dir, file))) return res.sendStatus(404);
  if (name) res.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${name}"`);
  res.sendFile(file, { root: dir, cacheControl: false });
};
app.get('/api/brand/:kind', (req, res) => {
  const f = LOGOS.includes(req.params.kind) && brandFile(req.params.kind);
  if (!f) return res.sendStatus(404);
  sendFile(res, BRAND, path.basename(f));
});
app.get('/api/training/:slug', (req, res) => {
  const t = q('SELECT * FROM trainings WHERE slug=?').get(req.params.slug);
  if (!t) throw new Bad('This registration link is not valid. Ask the trainer for the current link.', null, 404);
  res.json({ training: trainingInfo(t), brand: brandInfo() });
});
// Generous limit: a whole class often shares one venue Wi-Fi address.
app.post('/api/register/:slug', limit('reg', 300, 600000), (req, res) => {
  const t = q('SELECT * FROM trainings WHERE slug=?').get(req.params.slug);
  if (!t) throw new Bad('This registration link is not valid.', null, 404);
  if (!t.open) throw new Bad('Registration for this training is closed.', null, 403);
  const b = req.body || {};
  const person = cleanPerson(b);
  if (b.consent !== true) throw new Bad('Tick the box to agree before registering.', 'consent');
  if (q('SELECT 1 FROM participants WHERE training_id=? AND phone=?').get(t.id, person.phone))
    throw new Bad('This number is already registered for this training. Ask the trainer for your link.', 'phone', 409);
  const token = crypto.randomBytes(16).toString('base64url');
  q('INSERT INTO participants (training_id,token,name,email,phone,created) VALUES (?,?,?,?,?,?)')
    .run(t.id, token, person.name, person.email, person.phone, Date.now());
  res.status(201).json({ token });
});
const byToken = (req) => {
  const p = q('SELECT * FROM participants WHERE token=?').get(req.params.token);
  if (!p) throw new Bad('This link is not valid.', null, 404);
  return p;
};
app.get('/api/p/:token', (req, res) => {
  const p = byToken(req);
  res.json({ name: p.name, email: p.email, hasPhoto: Boolean(p.has_photo), completed: Boolean(p.completed), certNo: p.cert_no,
    sent: p.delivery === 'sent', sending: ['queued', 'sending'].includes(p.delivery), training: trainingInfo(trainingOf(p)), brand: brandInfo() });
});
app.get('/file/:token/photo.jpg', (req, res) => {
  const p = byToken(req);
  sendFile(res, PHOTOS, `${p.id}.jpg`, 'Training-photo.jpg', 'view' in req.query);
});
app.get('/file/:token/certificate.pdf', async (req, res) => {
  const p = byToken(req);
  if (!p.completed) throw new Bad('The certificate is not issued yet.', null, 404);
  if (!fs.existsSync(certFile(p))) await buildCert(p);
  sendFile(res, CERTS, `${p.id}.pdf`, pdfName(p), 'view' in req.query);
});

// ---------- admin ----------
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const cookie = (req) => /(?:^|;\s*)sid=([^;]+)/.exec(req.get('cookie') || '')?.[1];
const roleOf = (req) => { const sid = cookie(req); return sid ? q('SELECT role FROM sessions WHERE hash=? AND expires>?').get(sha(sid), Date.now())?.role : undefined; };
const login = (req, res) => {
  const [salt, hash] = storedPassword().split(':');
  if (!crypto.timingSafeEqual(Buffer.from(scrypt(String(req.body?.password ?? ''), salt)), Buffer.from(hash))) throw new Bad('That password is not correct.', 'password', 401);
  const sid = crypto.randomBytes(24).toString('base64url');
  q('DELETE FROM sessions WHERE expires<?').run(Date.now());
  q("INSERT INTO sessions (hash, expires, role) VALUES (?,?,'admin')").run(sha(sid), Date.now() + 7 * 864e5);
  res.cookie('sid', sid, { httpOnly: true, sameSite: 'strict', secure: proto(req) === 'https', maxAge: 7 * 864e5, path: '/' });
  res.json({ ok: true });
};
const logout = (req, res) => { q('DELETE FROM sessions WHERE hash=?').run(sha(cookie(req))); res.clearCookie('sid', { path: '/' }); res.json({ ok: true }); };
const allow = (...roles) => (req, res, next) => (roles.includes(roleOf(req)) ? next() : res.status(401).json({ error: 'Sign in to continue.' }));
app.post('/api/admin/login', limit('login', 10, 900000), login);

const admin = express.Router();
app.use('/api/admin', admin);
admin.use(allow('admin'));
admin.post('/logout', logout);
admin.get('/state', (req, res) => {
  const full = getSettings();
  const { mailPass, ...s } = full;
  res.json({
    trainings: q(`SELECT t.*, COUNT(p.id) AS registered, COUNT(p.completed) AS completed FROM trainings t
      LEFT JOIN participants p ON p.training_id=t.id GROUP BY t.id ORDER BY t.created DESC, t.id DESC`).all(),
    settings: { ...s, mailPassSet: Boolean(mailPass) }, mailReady: mail.configured(full),
    images: Object.fromEntries(IMAGES.map((k) => [k, Boolean(brandFile(k))])),
    base: baseUrl(req),
  });
});
function cleanTraining(b) {
  const title = text(b?.title, 140), date = String(b?.date || '');
  if (title.length < 3) throw new Bad('Enter the training name.', 'title');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new Bad('Choose the training date.', 'date');
  return { title, date, venue: text(b.venue, 140), open: b.open === false ? 0 : 1 };
}
const getT = (id) => { const t = q('SELECT * FROM trainings WHERE id=?').get(id); if (!t) throw new Bad('Training not found.', null, 404); return t; };
const getP = (id) => { const p = q('SELECT * FROM participants WHERE id=?').get(id); if (!p) throw new Bad('Participant not found.', null, 404); return p; };
admin.post('/trainings', (req, res) => {
  const t = cleanTraining(req.body);
  const r = q('INSERT INTO trainings (slug,title,date,venue,open,created) VALUES (?,?,?,?,?,?)').run(crypto.randomBytes(4).toString('hex'), t.title, t.date, t.venue, t.open, Date.now());
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});
admin.put('/trainings/:id', (req, res) => {
  const t = cleanTraining(req.body);
  q('UPDATE trainings SET title=?,date=?,venue=?,open=? WHERE id=?').run(t.title, t.date, t.venue, t.open, req.params.id);
  res.json({ ok: true });
});
admin.get('/trainings/:id/participants', (req, res) => {
  const base = baseUrl(req), t = getT(req.params.id);
  res.json(q('SELECT * FROM participants WHERE training_id=? ORDER BY created DESC, id DESC').all(t.id).map((p) => ({ ...p, link: `${base}/p/${p.token}` })));
});
admin.put('/participants/:id', async (req, res) => {
  const p = getP(req.params.id);
  const full = String(req.body?.phone ?? '').replace(/\D/g, '');
  // The admin edits the full number; 10 digits are taken as Indian.
  const num = full.length === 10 ? { cc: '91', phone: full } : { cc: full.slice(0, 2), phone: full.slice(2) };
  const n = cleanPerson({ ...req.body, ...num });
  if (q('SELECT 1 FROM participants WHERE training_id=? AND phone=? AND id<>?').get(p.training_id, n.phone, p.id)) throw new Bad('Another participant already uses this number.', 'phone', 409);
  q('UPDATE participants SET name=?,email=?,phone=? WHERE id=?').run(n.name, n.email, n.phone, p.id);
  if (p.completed) await buildCert(getP(p.id));
  res.json({ ok: true });
});
admin.delete('/participants/:id', (req, res) => {
  const p = getP(req.params.id);
  fs.rmSync(photoFile(p), { force: true });
  fs.rmSync(certFile(p), { force: true });
  q('DELETE FROM participants WHERE id=?').run(p.id);
  res.json({ ok: true });
});
const needMail = () => { if (!mail.configured(getSettings())) throw new Bad('Connect an email account in the Email tab first.'); };
// Adding the photo is what completes the participant: the certificate is issued and emailed here.
admin.post('/participants/:id/certificate', async (req, res) => {
  const p = getP(req.params.id), b = req.body || {};
  if (p.completed && !b.replace) throw new Bad('This certificate is already issued. Use Replace photo to change it.', null, 409);
  if (['queued', 'sending'].includes(p.delivery)) throw new Bad('This certificate is being emailed. Wait a moment, then try again.', null, 409);
  if (!(b.useSaved === true && p.has_photo && !p.completed)) {
    fs.writeFileSync(photoFile(p), decodeJpeg(b.photo));
    q('UPDATE participants SET has_photo=1 WHERE id=?').run(p.id);
  }
  const ready = mail.configured(getSettings());
  if (p.completed) { await buildCert(getP(p.id)); if (ready) enqueue(p.id); } else await issue(p.id);
  res.json({ ok: true, emailing: ready });
});
admin.post('/participants/:id/send', (req, res) => {
  const p = getP(req.params.id);
  if (!p.completed) throw new Bad('Add the photo first.');
  needMail();
  if (['queued', 'sending'].includes(p.delivery)) throw new Bad('This certificate is already being sent.');
  enqueue(p.id);
  res.json({ ok: true });
});
admin.post('/trainings/:id/send-waiting', (req, res) => {
  needMail();
  const list = q("SELECT id FROM participants WHERE training_id=? AND completed IS NOT NULL AND delivery IN ('ready','failed')").all(req.params.id);
  for (const p of list) enqueue(p.id);
  res.json({ queued: list.length });
});
admin.get('/trainings/:id/export.csv', (req, res) => {
  const cell = (v) => { let x = String(v ?? ''); if (/^[=+\-@\t\r]/.test(x)) x = "'" + x; return `"${x.replace(/"/g, '""')}"`; };
  const when = (n) => (n ? new Date(n).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '');
  const rows = q('SELECT * FROM participants WHERE training_id=? ORDER BY created').all(req.params.id)
    .map((p) => [p.name, p.email, p.phone, p.has_photo ? 'Yes' : 'No', when(p.created), when(p.completed), p.cert_no, p.delivery].map(cell).join(','));
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="participants.csv"' });
  res.send('﻿' + ['Name,Email,Phone,Photo,Registered,Completed,Certificate no.,Delivery', ...rows].join('\r\n'));
});
admin.get('/trainings/:id/qr.png', async (req, res) => {
  const t = getT(req.params.id);
  if ('download' in req.query) res.set('Content-Disposition', 'attachment; filename="registration-qr.png"');
  res.type('png').send(await QRCode.toBuffer(`${baseUrl(req)}/r/${t.slug}`, { width: 1000, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#003A5C', light: '#FFFFFF' } }));
});
admin.put('/settings', (req, res) => {
  const b = req.body || {}, next = [];
  for (const k of Object.keys(DEFAULTS)) {
    if (!(k in b) || k.startsWith('mail') && !['mailSubject', 'mailBody'].includes(k)) continue;
    let v = b[k];
    if (typeof DEFAULTS[k] === 'boolean') v = v === true;
    else if (k === 'mailBody') v = String(v ?? '').replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 2500);
    else if (k === 'watermark') { if (!['white', 'red', 'none'].includes(v)) continue; }
    else v = text(v, 160);
    if (REQUIRED.includes(k) && !v) throw new Bad('This field cannot be empty.', k);
    next.push([k, v]);
  }
  for (const [k, v] of next) putSetting(k, v);
  res.json({ ok: true });
});
// Saves the account only after a real sign-in and a test email both succeed.
admin.put('/mail', async (req, res) => {
  const s = getSettings();
  const user = text(req.body?.mailUser, 120).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(user)) throw new Bad('Enter the email address that sends the certificates.');
  let pass = String(req.body?.mailPass ?? '').trim() || (user === s.mailUser ? s.mailPass : '');
  if (!pass) throw new Bad('Enter the app password.');
  const host = text(req.body?.mailHost, 120) || (await mail.detectHost(user));
  if (!host) throw new Bad('The mail server was not recognised. Enter its name in Mail server.');
  if (host === 'smtp.gmail.com') pass = pass.replace(/\s/g, '');
  const trial = { ...s, mailUser: user, mailPass: pass, mailHost: host };
  try {
    await mail.verify(trial);
    const pdf = await renderCertificate(s, { title: 'Test', date: longDate(today()), venue: 'Test event' }, { name: 'Test Participant', certNo: 'TC-SAMPLE' }, images(null));
    await mail.sendCertificate(trial, { to: user, name: 'Test Participant', training: 'test', date: longDate(today()), venue: 'Test event', pdf, pdfName: 'Certificate-sample.pdf', photo: null });
  } catch (e) { throw new Bad(mail.explain(e)); }
  putSetting('mailUser', user); putSetting('mailPass', pass); putSetting('mailHost', host);
  res.json({ ok: true, host });
});
admin.post('/mail-disconnect', (req, res) => { putSetting('mailPass', ''); res.json({ ok: true }); });
const clearImage = (kind) => { for (const e of ['png', 'jpg']) fs.rmSync(path.join(BRAND, `${kind}.${e}`), { force: true }); };
const imageKind = (req) => { if (!IMAGES.includes(req.params.kind)) throw new Bad('Unknown image.'); return req.params.kind; };
admin.put('/image/:kind', (req, res) => {
  const kind = imageKind(req);
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(req.body?.image || '');
  if (!m) throw new Bad('Choose a PNG or JPG image.');
  const buf = Buffer.from(m[2], 'base64');
  try { assertImage(buf); } catch { throw new Bad('That image could not be read. Try another file.'); }
  clearImage(kind);
  fs.writeFileSync(path.join(BRAND, `${kind}.${m[1] === 'png' ? 'png' : 'jpg'}`), buf);
  res.json({ ok: true });
});
admin.delete('/image/:kind', (req, res) => { clearImage(imageKind(req)); res.json({ ok: true }); });
admin.get('/trainings/:id/preview.pdf', async (req, res) => {
  const t = getT(req.params.id);
  const pdf = await renderCertificate(getSettings(), certTraining(t), { name: 'Participant Name', certNo: 'TC-SAMPLE' }, images(null));
  res.type('pdf').send(pdf);
});
admin.put('/password', (req, res) => {
  const pw = String(req.body?.password ?? '');
  if (pw.length < 10) throw new Bad('Use at least 10 characters.', 'password');
  setPassword(pw);
  q('DELETE FROM sessions WHERE hash<>?').run(sha(cookie(req)));
  fs.rmSync(path.join(DATA, 'admin-password.txt'), { force: true });
  res.json({ ok: true });
});

app.use((req, res) => res.status(404).type('txt').send('Page not found'));
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err instanceof Bad ? err.message : status === 413 ? 'That image is too large.' : 'Something went wrong. Try again.', field: err.field });
});

// Emails that were waiting when the site stopped are sent now.
if (mail.configured(getSettings())) for (const p of q("SELECT id FROM participants WHERE delivery='queued'").all()) enqueue(p.id);

export function listen(port = Number(process.env.PORT) || 3000, host = process.env.HOST || '127.0.0.1') {
  return new Promise((ok, no) => {
    const s = app.listen(port, host, (e) => {
      if (e) return no(e);
      if (firstPassword) console.log('Admin password saved in', path.join(DATA, 'admin-password.txt'));
      console.log(`Running at http://localhost:${port}`);
      ok(s);
    });
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await listen();
