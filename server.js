'use strict';
/*
 * Local scoreboard server (no dependencies, Node 18+). Uses the same API code as the Vercel deployment.
 *   node server.js        -> scoreboard at http://localhost:8765/, scoring at http://localhost:8765/admin
 *
 * Admin login: put ADMIN_PASSWORD (and optionally ADMIN_USER) in a file called .env.local next to this file.
 * Without a password, anyone on your Wi-Fi can score (handy for quick local testing).
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const dgram = require('node:dgram');

const ROOT = __dirname;
loadEnvFile(path.join(ROOT, '.env.local'));
const PORT = Number(process.env.PORT) || 8765;
const api = require('./api/_lib/handlers');
const auth = require('./api/_lib/auth');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const ROUTES = { '/api/state': api.state, '/api/time': api.time, '/api/me': api.me, '/api/login': api.login, '/api/logout': api.logout, '/api/led': api.led };
const PAGES = { '/': '/index.html', '/admin': '/admin.html', '/display.html': '/index.html' };
const PRIVATE = new Set(['server.js', 'package.json', 'start-server.bat', 'vercel.json']);

function loadEnvFile(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

// The address of the adapter that carries normal traffic (your Wi-Fi). "Connecting" UDP sends no packet.
function primaryAddress() {
  return new Promise(resolve => {
    const s = dgram.createSocket('udp4');
    const done = v => { try { s.close(); } catch { /* closed */ } resolve(v); };
    s.on('error', () => done(null));
    s.connect(53, '8.8.8.8', () => { try { done(s.address().address); } catch { done(null); } });
  });
}
async function lanAddresses() {
  const primary = await primaryAddress();
  if (primary && primary !== '0.0.0.0') return [primary];
  return Object.values(os.networkInterfaces()).flat()
    .filter(a => a && (a.family === 'IPv4' || a.family === 4) && !a.internal)
    .map(a => a.address);
}

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400); res.end('Bad request'); return; }
  rel = PAGES[rel] || rel;
  const file = path.resolve(ROOT, '.' + rel);
  const relParts = path.relative(ROOT, file).split(path.sep);
  const blocked = !file.startsWith(ROOT + path.sep)
    || relParts.some(p => p.startsWith('.'))       // .env.local, .scoreboard-state.json, .git
    || relParts[0] === 'api' || relParts[0] === 'node_modules'
    || PRIVATE.has(relParts.join('/'));
  if (blocked) { res.writeHead(404); res.end('Not found'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://local');
  if (ROUTES[pathname]) return ROUTES[pathname](req, res);
  if (pathname === '/api/info') return api.send(res, 200, { port: PORT, addresses: await lanAddresses() });
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  serveStatic(req, res, pathname);
});

server.listen(PORT, '0.0.0.0', async () => {
  const ips = await lanAddresses();
  console.log('\n  Scoreboard server running\n');
  console.log(`  Scoring (admin, this computer):  http://localhost:${PORT}/admin`);
  ips.forEach(ip => console.log(`  Scoreboard for phones / TVs:     http://${ip}:${PORT}/`));
  if (!ips.length) console.log('  (No Wi-Fi/LAN address found: connect this computer to a network.)');
  console.log(auth.configured()
    ? `\n  Admin login is ON (user "${auth.user()}").`
    : '\n  Admin login is OFF: anyone on this Wi-Fi can score. Add ADMIN_PASSWORD=... to .env.local to turn it on.');
  console.log('  Phones must be on the same Wi-Fi. Press Ctrl+C to stop.\n');
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${PORT} is busy. Close the other server or run: set PORT=8766 && node server.js`);
  else console.error(err);
  process.exit(1);
});
