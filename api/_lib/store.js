'use strict';
/*
 * Storage for the live match.
 *  - On Vercel: Upstash Redis over its REST API (add it from the Vercel Marketplace; it sets the env vars).
 *  - Locally (server.js): memory, saved to .scoreboard-state.json.
 */
const fs = require('node:fs');
const path = require('node:path');

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const useRedis = !!(REDIS_URL && REDIS_TOKEN);
const onVercel = !!process.env.VERCEL;
const FILE = path.join(__dirname, '..', '..', '.scoreboard-state.json');

class StorageMissing extends Error {}

async function redis(cmd) {
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(`Redis: ${j.error || r.status}`);
  return j.result;
}

function guard() {
  // Serverless instances don't share memory, so without Redis the data would vanish between requests.
  if (onVercel && !useRedis) throw new StorageMissing('Storage is not connected. Add Upstash Redis in Vercel > Storage.');
}

let mem = null, memLoaded = false, saveTimer = 0;
const counters = new Map();

async function getState() {
  guard();
  if (useRedis) {
    const v = await redis(['GET', 'sb:state']);
    return v ? JSON.parse(v) : null;
  }
  if (!memLoaded) {
    memLoaded = true;
    try { mem = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { mem = null; }
  }
  return mem;
}

async function setState(st) {
  guard();
  if (useRedis) { await redis(['SET', 'sb:state', JSON.stringify(st)]); return; }
  mem = st;
  memLoaded = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(FILE, JSON.stringify(st), () => {}), 500);
}

/* Counters with expiry, used to slow down password guessing. */
async function getCount(key) {
  if (useRedis) return Number(await redis(['GET', `sb:${key}`])) || 0;
  const c = counters.get(key);
  return c && c.exp > Date.now() ? c.n : 0;
}
async function bump(key, ttlSec) {
  if (useRedis) {
    const n = await redis(['INCR', `sb:${key}`]);
    if (n === 1) await redis(['EXPIRE', `sb:${key}`, ttlSec]);
    return n;
  }
  const c = counters.get(key);
  const next = c && c.exp > Date.now() ? { n: c.n + 1, exp: c.exp } : { n: 1, exp: Date.now() + ttlSec * 1000 };
  counters.set(key, next);
  return next.n;
}
async function clearCount(key) {
  if (useRedis) await redis(['DEL', `sb:${key}`]);
  else counters.delete(key);
}

const storageReady = () => !onVercel || useRedis;

module.exports = { getState, setState, getCount, bump, clearCount, storageReady, StorageMissing };
