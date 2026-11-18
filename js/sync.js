'use strict';
/*
 * Talks to the server (local server.js or Vercel): admin login, and saving the match so the
 * public scoreboard (index.html) on phones/TVs can show it.
 */
const Sync = (() => {
  const enabled = location.protocol === 'http:' || location.protocol === 'https:';
  let ready = false;       // don't save anything until we've loaded what the server already has
  let timer = 0, inflight = false, again = false, online = null;
  let onAuthNeeded = null;
  const listeners = [];

  const json = async (url, opts = {}) => {
    const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...opts });
    let body = null;
    try { body = await r.json(); } catch { /* empty */ }
    return { status: r.status, ok: r.ok, body: body || {} };
  };
  const post = (url, data) => json(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data || {}) });

  function setOnline(ok, why) {
    if (ok === online) return;
    online = ok;
    listeners.forEach(cb => cb(ok, why));
  }

  function push() {
    if (!enabled || !ready) return;
    clearTimeout(timer);
    timer = setTimeout(send, 60);
  }

  async function send() {
    if (inflight) { again = true; return; }
    inflight = true;
    const body = {
      sport: store.get('sb.sport', 'cricket'),
      cricket: store.get('sb.cricket.v1', null),
      football: store.get('sb.football.v1', null),
      event: store.get('sb.event', null),
      led: Display.snapshot(),
      savedAt: store.get('sb.savedAt', Date.now()),
      sentAt: Date.now(),
    };
    let res = { status: 0, ok: false, body: {} };
    try { res = await post('/api/state', body); } catch { /* offline */ }
    inflight = false;
    setOnline(res.ok, res.body.error);
    if (res.status === 401 && onAuthNeeded) { await onAuthNeeded(); push(); return; }
    if (!res.ok) { clearTimeout(timer); timer = setTimeout(send, 3000); return; }  // keep retrying
    if (again) { again = false; push(); }
  }

  return {
    enabled,
    push,
    start() { ready = true; push(); },
    onStatus: cb => listeners.push(cb),
    onAuth: fn => { onAuthNeeded = fn; },
    me: () => json('/api/me').then(r => r.body),
    login: (username, password) => post('/api/login', { username, password }),
    logout: () => post('/api/logout'),
    state: () => json('/api/state').then(r => (r.ok ? r.body : null)),
    info: () => json('/api/info').then(r => (r.ok ? r.body : null)).catch(() => null),
  };
})();
