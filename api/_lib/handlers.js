'use strict';
/* API handlers shared by the Vercel functions (api/*.js) and the local server (server.js). */
const store = require('./store');
const auth = require('./auth');

const MAX_BODY = 1024 * 1024;
const MAX_FAILS = 10;          // wrong passwords allowed per IP...
const FAIL_WINDOW = 15 * 60;   // ...per 15 minutes

function send(res, code, obj, cache = 'no-store') {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.end(obj === undefined ? '' : JSON.stringify(obj));
}

function readJson(req) {
  // Vercel may have parsed the body already.
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
  if (typeof req.body === 'string') return Promise.resolve(JSON.parse(req.body));
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const isJson = req => String(req.headers['content-type'] || '').includes('application/json');
const clientIp = req => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';

// Wraps a handler so storage/parse errors become clean JSON responses.
const wrap = fn => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof store.StorageMissing) return send(res, 503, { error: err.message });
    console.error(err);
    send(res, 500, { error: 'Server error' });
  }
};

/* GET: anyone can read the match. POST: admins only. */
const state = wrap(async (req, res) => {
  if (req.method === 'GET') {
    // Cached for 1 s at Vercel's edge, so 1,000 viewers still cost about one database read per second.
    return send(res, 200, (await store.getState()) || {}, 'public, max-age=0, s-maxage=1, stale-while-revalidate=1');
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  if (!auth.session(req)) return send(res, 401, { error: 'Sign in as admin to score' });
  if (!isJson(req)) return send(res, 415, { error: 'Expected JSON' });
  const b = await readJson(req);
  const now = Date.now();
  await store.setState({
    sport: b.sport === 'football' ? 'football' : 'cricket',
    cricket: b.cricket ?? null,
    football: b.football ?? null,
    event: b.event ?? null,
    led: b.led ?? null,
    savedAt: Number(b.savedAt) || now,
    // ctlOffset lets viewers correct for the scoring device's clock when running the football timer.
    ctlOffset: Number.isFinite(b.sentAt) ? now - b.sentAt : 0,
    version: now,
  });
  send(res, 200, { ok: true, version: now });
});

const time = (req, res) => send(res, 200, { now: Date.now() });

const me = wrap(async (req, res) => {
  const s = auth.session(req);
  send(res, 200, {
    admin: !!s, user: s ? s.u : null,
    authRequired: auth.authRequired(), configured: auth.configured() || !auth.authRequired(),
    storage: store.storageReady(),
  });
});

const login = wrap(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  if (!isJson(req)) return send(res, 415, { error: 'Expected JSON' });
  if (!auth.configured()) return send(res, 503, { error: 'No admin password is set on the server. Set ADMIN_PASSWORD and redeploy.' });
  const key = `fail:${clientIp(req)}`;
  if (await store.getCount(key) >= MAX_FAILS) return send(res, 429, { error: 'Too many wrong attempts. Try again in 15 minutes.' });
  const b = await readJson(req);
  if (!auth.checkLogin(b.username, b.password)) {
    await store.bump(key, FAIL_WINDOW);
    return send(res, 401, { error: 'Wrong username or password' });
  }
  await store.clearCount(key);
  auth.startSession(req, res, auth.user());
  send(res, 200, { ok: true, user: auth.user() });
});

const logout = (req, res) => {
  auth.endSession(req, res);
  send(res, 200, { ok: true });
};

/* Plain-text feed for an internet-connected ESP32 to poll (see README, "LED display"). */
const led = wrap(async (req, res) => {
  const st = (await store.getState()) || {};
  const l = st.led || {};
  const lines = [l.line || 'T|READY', `B|${l.brightness ?? 6}`, `V|${l.speed ?? 35}`];
  if (l.flash && l.flash.line) lines.push(`F|${l.flash.t}|${l.flash.line}`);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=1, stale-while-revalidate=1');
  res.end(lines.join('\n') + '\n');
});

module.exports = { state, time, me, login, logout, led, send };
