'use strict';
/*
 * Admin login. Credentials come from environment variables, never from the code:
 *   ADMIN_USER      (default "admin")
 *   ADMIN_PASSWORD  (required on Vercel; if unset on the local server, scoring is open to the local network)
 * Sessions are signed cookies (HMAC). Changing the password signs everyone out.
 */
const crypto = require('node:crypto');

const user = () => process.env.ADMIN_USER || 'admin';
const pass = () => process.env.ADMIN_PASSWORD || '';
const authRequired = () => !!pass() || !!process.env.VERCEL;
const configured = () => !!pass();
const SESSION_HOURS = 12;

const key = () => crypto.createHash('sha256').update(`sb-session\0${user()}\0${pass()}`).digest();
const mac = body => crypto.createHmac('sha256', key()).update(body).digest('base64url');
const digest = v => crypto.createHash('sha256').update(String(v)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));

function checkLogin(u, p) {
  if (!configured()) return false;
  const okUser = safeEqual(u || '', user());
  const okPass = safeEqual(p || '', pass());
  return okUser && okPass;
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${mac(body)}`;
}

function verify(token) {
  if (!token || !configured()) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(mac(body));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p.exp > Date.now() ? p : null;
  } catch {
    return null;
  }
}

function cookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

const isHttps = req => req.headers['x-forwarded-proto'] === 'https' || !!process.env.VERCEL;

/** Returns { u } for a signed-in admin (or open local mode), otherwise null. */
function session(req) {
  if (!authRequired()) return { u: 'local', open: true };
  return verify(cookies(req).sb_session);
}

function startSession(req, res, name) {
  const token = sign({ u: name, exp: Date.now() + SESSION_HOURS * 3600e3 });
  res.setHeader('Set-Cookie', `sb_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}${isHttps(req) ? '; Secure' : ''}`);
}

function endSession(req, res) {
  res.setHeader('Set-Cookie', `sb_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isHttps(req) ? '; Secure' : ''}`);
}

module.exports = { authRequired, configured, checkLogin, session, startSession, endSession, user };
