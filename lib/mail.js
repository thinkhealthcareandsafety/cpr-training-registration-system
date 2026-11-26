import nodemailer from 'nodemailer';
import dns from 'node:dns/promises';

export const configured = (s) => Boolean(s.mailUser && s.mailPass && s.mailHost);

/** Finds the outgoing server from the address, so the admin only needs an email and an app password. */
export async function detectHost(user) {
  const domain = user.split('@')[1] || '';
  if (domain === 'gmail.com') return 'smtp.gmail.com';
  if (/^zoho(mail)?\.(in|com)$/.test(domain)) return `smtp.zoho.${domain.endsWith('.in') ? 'in' : 'com'}`;
  const mx = (await dns.resolveMx(domain).catch(() => [])).map((m) => m.exchange.toLowerCase()).join(' ');
  if (/google(mail)?\.com/.test(mx)) return 'smtp.gmail.com';
  if (/zoho\.in/.test(mx)) return 'smtppro.zoho.in';
  if (/zoho/.test(mx)) return 'smtppro.zoho.com';
  if (/outlook\.com/.test(mx)) return 'smtp.office365.com';
  return '';
}

function transport(s) {
  const port = Number(process.env.SMTP_PORT) || (s.mailHost === 'smtp.office365.com' ? 587 : 465);
  const test = process.env.SMTP_INSECURE_TEST === '1';
  return nodemailer.createTransport({
    host: s.mailHost, port, secure: port === 465, requireTLS: !test && port !== 465, ignoreTLS: test,
    auth: { user: s.mailUser, pass: s.mailPass },
    connectionTimeout: 20000, greetingTimeout: 20000, socketTimeout: 60000,
  });
}

export function explain(e) {
  if (e.code === 'EAUTH') return 'The email account refused the sign-in. Use an app password, not your normal password, and check the address.';
  if (['ECONNECTION', 'ETIMEDOUT', 'EDNS', 'ESOCKET'].includes(e.code)) return 'The mail server could not be reached. Check the internet connection and the mail server name.';
  if (/quota|limit exceeded|5\.4\.5/i.test(e.message)) return 'The email account reached its daily sending limit. Send again tomorrow.';
  return String(e.response || e.message).slice(0, 250);
}

export const verify = (s) => transport(s).verify();

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fill = (t, d) => t.replace(/\{(name|training|date|event)\}/g, (m, k) => d[k] ?? '');

export async function sendCertificate(s, { to, name, training, date, venue, pdf, pdfName, photo }) {
  const d = { name, training, date, event: venue };
  const body = fill(s.mailBody, d);
  const org = esc(s.orgName);
  const html = `<!doctype html><html><body style="margin:0;background:#EDF4F9;font-family:Segoe UI,Arial,sans-serif;color:#12324A">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF">
<tr><td style="background:#00507A;border-bottom:5px solid #FFC72C;padding:22px 28px;color:#FFFFFF;font-size:20px;font-weight:bold">${org}</td></tr>
<tr><td style="padding:28px;font-size:16px;line-height:1.6"><p style="margin:0 0 16px">Dear ${esc(name)},</p><p style="margin:0 0 16px">${esc(body).replace(/\n/g, '<br>')}</p>
<p style="margin:0;color:#00507A;font-weight:bold">${esc(`${s.pledge} ${s.pledgeBig}`)}</p><p style="margin:20px 0 0">Warm regards,<br>${org}</p></td></tr>
<tr><td style="padding:16px 28px;background:#F3F8FB;font-size:13px;color:#48647A">${org}</td></tr></table></td></tr></table></body></html>`;
  const attachments = [{ filename: pdfName, content: pdf, contentType: 'application/pdf' }];
  if (photo) attachments.push({ filename: 'Your-photo.jpg', content: photo, contentType: 'image/jpeg' });
  const mail = {
    from: { name: s.orgName, address: s.mailUser }, to: { name, address: to }, subject: fill(s.mailSubject, d),
    text: `Dear ${name},\n\n${body}\n\n${s.pledge} ${s.pledgeBig}\n\nWarm regards,\nTeam ${s.orgName}`,
    html, attachments,
  };
  const t = transport(s);
  // Only a failure to connect is retried. Anything later might already have been delivered.
  for (let n = 0; ; n++) {
    try { return await t.sendMail(mail); } catch (e) {
      if (n >= 2 || e.command !== 'CONN' || e.code === 'EAUTH') throw e;
      await new Promise((r) => setTimeout(r, n ? 20000 : 4000));
    }
  }
}
