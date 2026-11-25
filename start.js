// Opens a public HTTPS link and runs the site behind it. Close the window to take the site offline.
// The site is a separate process, so it can be restarted or updated without changing the link.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(ROOT, 'data');
fs.mkdirSync(DATA, { recursive: true });
const isFree = (p) => new Promise((ok) => { const s = net.createServer().once('error', () => ok(false)).listen(p, '127.0.0.1', () => s.close(() => ok(true))); });
let port = Number(process.env.PORT) || 3000;
// Another program may already use the port, so try the next ones.
for (const first = port; !(await isFree(port)); port++) if (port > first + 20) throw new Error('No free port found.');

let tunnel, site, url = '', stopping = false;
function startSite() {
  site = spawn(process.execPath, ['server.js'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, PORT: String(port), PUBLIC_URL: url } });
  fs.writeFileSync(path.join(DATA, 'site.pid'), String(site.pid));
  site.on('exit', () => { if (!stopping) { console.log('Site restarting.'); setTimeout(startSite, 1000); } });
}
function startTunnel() {
  tunnel = spawn(path.join(ROOT, 'bin', 'cloudflared.exe'), ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { windowsHide: true });
  let found = false, tail = '';
  const read = (b) => {
    tail = (tail + b).slice(-4000);
    const m = !found && /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/.exec(tail);
    if (!m) return;
    found = true;
    url = m[0];
    fs.writeFileSync(path.join(DATA, 'public-link.txt'), url + '\n');
    console.log(`\n  PARTICIPANT LINK : ${url}\n  PHOTO STATION    : ${url}/staff\n  ADMIN PAGE       : ${url}/admin\n\n  Keep this window open. Closing it takes the site offline.\n`);
    if (site) site.kill(); else startSite();
  };
  tunnel.stdout.on('data', read);
  tunnel.stderr.on('data', read);
  tunnel.on('error', (e) => console.error('Public link failed:', e.message));
  tunnel.on('exit', () => {
    if (stopping) return;
    console.log('Public link dropped. Reconnecting; the link will change.');
    if (!found) console.log(tail);
    setTimeout(startTunnel, 5000);
  });
}
startTunnel();
const stop = () => { stopping = true; tunnel?.kill(); site?.kill(); };
for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, () => { stop(); process.exit(0); });
process.on('exit', stop);
