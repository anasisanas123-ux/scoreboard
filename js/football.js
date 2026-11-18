'use strict';
/* Football: score, match clock with halves and stoppage time, cards, goal scorers, undo. */
const Football = (() => {
  const KEY = 'sb.football.v1';
  const LABEL = { PRE: 'Pre-match', '1H': '1st half', HT: 'Half time', '2H': '2nd half', FT: 'Full time' };
  const NEXT = { PRE: 'Kick off', '1H': 'Half time', HT: 'Start 2nd half', '2H': 'Full time', FT: 'Match finished' };

  let s = store.get(KEY, null) || fresh();
  let history = [];
  let listener = () => {};
  let lastMinute = null;

  function fresh(keep) {
    const team = (t, name, code, color) => ({ name: t?.name || name, code: t?.code || code, color: t?.color || color, score: 0, yellow: 0, red: 0 });
    return {
      half: keep?.half || 45,
      home: team(keep?.home, 'Home FC', 'HOM', '#e63946'),
      away: team(keep?.away, 'Away United', 'AWY', '#4da3ff'),
      period: 'PRE', baseMs: 0, startedAt: null, events: [],
    };
  }

  const elapsed = () => s.baseMs + (s.startedAt ? Date.now() - s.startedAt : 0);
  const running = () => s.startedAt != null;
  const pad = n => String(n).padStart(2, '0');
  const clockText = () => { const ms = elapsed(); return `${pad(Math.floor(ms / 60000))}:${pad(Math.floor(ms / 1000) % 60)}`; };

  function minute() {
    if (s.period === 'PRE') return '';
    if (s.period === 'HT' || s.period === 'FT') return s.period;
    const m = Math.floor(elapsed() / 60000);
    const end = (s.period === '1H' ? 1 : 2) * s.half;
    return m >= end ? `${end}+${m - end + 1}'` : `${m + 1}'`;
  }

  function save() { store.set(KEY, s); }
  function snap() { history.push(JSON.stringify(s)); if (history.length > 200) history.shift(); }
  function commit(ev) { save(); render(); listener(ev || null); }

  /* ---------------- clock ---------------- */
  function pause() { if (running()) { s.baseMs = elapsed(); s.startedAt = null; } }
  function resume() { if (!running()) s.startedAt = Date.now(); }

  function nextPeriod() {
    switch (s.period) {
      case 'PRE': s.period = '1H'; s.baseMs = 0; resume(); break;
      case '1H': pause(); s.period = 'HT'; break;
      case 'HT': s.period = '2H'; s.baseMs = s.half * 60000; s.startedAt = null; resume(); break;
      case '2H': pause(); s.period = 'FT'; break;
      default: return;
    }
    const flash = { '1H': 'KICK OFF', HT: 'HALF TIME', '2H': 'SECOND HALF', FT: 'FULL TIME' }[s.period];
    commit({ flash });
  }

  function toggleClock() {
    if (s.period === 'PRE') return nextPeriod();
    if (s.period !== '1H' && s.period !== '2H') return;
    if (running()) pause(); else resume();
    commit();
  }

  function adjust(sec) {
    const ms = Math.max(0, elapsed() + sec * 1000);
    s.baseMs = ms;
    if (running()) s.startedAt = Date.now();
    commit();
  }

  /* ---------------- scoring ---------------- */
  function goal(side, delta) {
    const t = s[side];
    if (delta < 0 && t.score === 0) return;
    snap();
    t.score += delta;
    if (delta > 0) {
      s.events.push({ side, type: 'goal', min: minute() || "0'", who: '' });
    } else {
      for (let k = s.events.length - 1; k >= 0; k--) {
        if (s.events[k].side === side && s.events[k].type === 'goal') { s.events.splice(k, 1); break; }
      }
    }
    commit(delta > 0 ? { kind: 'goal', side, flash: `GOAL! ${t.code}` } : { kind: 'edit' });
    if (delta > 0) Scenes.football.goal(side, t.color);
  }

  function card(side, type) {
    const t = s[side];
    snap();
    t[type]++;
    s.events.push({ side, type, min: minute() || "0'", who: '' });
    commit({ kind: 'card', side, type, flash: `${type === 'red' ? 'RED' : 'YELLOW'} CARD ${t.code}` });
    Scenes.football.card(type, t.code);
  }

  function undo() {
    if (!history.length) { toast('Nothing to undo'); return; }
    const clock = { period: s.period, baseMs: s.baseMs, startedAt: s.startedAt, half: s.half };
    s = Object.assign(JSON.parse(history.pop()), clock);
    commit();
  }

  async function editEvent(idx) {
    const e = s.events[idx];
    if (!e) return;
    const r = await ask(e.type === 'goal' ? 'Goal scorer' : 'Player booked', [
      { name: 'who', label: `Player (${s[e.side].name})`, value: e.who },
      { name: 'min', label: 'Minute', value: e.min, half: true },
    ], { ok: 'Save' });
    if (!r) return;
    snap();
    e.who = r.who;
    e.min = r.min || e.min;
    commit();
  }

  async function setup(isNew) {
    const H = s.home, A = s.away;
    const r = await ask(isNew ? 'New football match' : 'Edit teams', [
      { name: 'hn', label: 'Home team', value: H.name, required: true, half: true },
      { name: 'hc', label: 'Short code (LED)', value: H.code, maxLength: 4, half: true },
      { name: 'an', label: 'Away team', value: A.name, required: true, half: true },
      { name: 'ac', label: 'Short code (LED)', value: A.code, maxLength: 4, half: true },
      { name: 'hcol', label: 'Home kit colour', type: 'color', value: H.color, half: true },
      { name: 'acol', label: 'Away kit colour', type: 'color', value: A.color, half: true },
      { name: 'half', label: 'Minutes per half', type: 'number', value: s.half, min: 1, max: 60 },
    ], { ok: isNew ? 'Start new match' : 'Save', note: isNew ? 'Scores, cards and the clock will be reset.' : '' });
    if (!r) return;
    const teams = {
      home: { name: r.hn, code: (r.hc || teamCode(r.hn)).toUpperCase(), color: r.hcol },
      away: { name: r.an, code: (r.ac || teamCode(r.an)).toUpperCase(), color: r.acol },
    };
    const half = clamp(Math.round(r.half), 1, 60);
    if (isNew) {
      history = [];
      s = fresh({ ...teams, half });
    } else {
      snap();
      Object.assign(s.home, teams.home);
      Object.assign(s.away, teams.away);
      s.half = half;
    }
    commit();
  }

  /* ---------------- LED text ---------------- */
  function ledTexts() {
    const H = s.home, A = s.away, m = minute();
    const sc = `${H.score}-${A.score}`;
    const candidates = [];
    if (m) candidates.push(`${H.code} ${sc} ${A.code} ${m}`);
    candidates.push(`${H.code} ${sc} ${A.code}`);
    if (m) candidates.push(`${sc} ${m}`);
    candidates.push(sc);
    let ticker = `${H.name} ${H.score} - ${A.score} ${A.name}`;
    if (m) ticker += ` ${m}`;
    const scorers = s.events.filter(e => e.type === 'goal' && e.who).slice(-4).map(e => `${e.who} ${e.min}`);
    if (scorers.length) ticker += ` | GOALS: ${scorers.join(', ')}`;
    return { candidates, ticker };
  }

  /* ---------------- rendering ---------------- */
  const cardsHtml = t => `${t.yellow ? `<span><span class="card-ic yellow"></span>${t.yellow}</span>` : ''}${t.red ? `<span><span class="card-ic red"></span>${t.red}</span>` : ''}`;

  function renderClock() {
    $('#fbClock').textContent = clockText();
    const m = minute();
    $('#fbMinute').textContent = s.period === '1H' || s.period === '2H' ? `Minute ${m}${running() ? '' : ' · paused'}` : '';
    $('#fbPeriod').textContent = LABEL[s.period];
    const next = $('#fbNext');
    next.textContent = NEXT[s.period];
    next.disabled = s.period === 'FT';
    const st = $('#fbStart');
    const inPlay = s.period === '1H' || s.period === '2H';
    st.hidden = !inPlay;
    st.textContent = running() ? 'Pause' : 'Resume';
  }

  function render() {
    const H = s.home, A = s.away;
    const view = $('#view-football');
    view.style.setProperty('--home', H.color);
    view.style.setProperty('--away', A.color);
    $('#fbHomeName').textContent = H.name;
    $('#fbAwayName').textContent = A.name;
    $('#fbHomeLabel').textContent = H.name;
    $('#fbAwayLabel').textContent = A.name;
    $('#fbHomeScore').textContent = H.score;
    $('#fbAwayScore').textContent = A.score;
    $('#fbHomeCards').innerHTML = cardsHtml(H);
    $('#fbAwayCards').innerHTML = cardsHtml(A);
    $('#fbHalfLen').textContent = `${s.half} min halves`;
    $('#fbUndo').disabled = !history.length;
    renderClock();
    const items = s.events.map((e, idx) => ({ e, idx })).reverse();
    $('#fbEvents').innerHTML = items.length
      ? items.map(({ e, idx }) => `<li data-i="${idx}"><span class="min">${esc(e.min)}</span><span class="ev-ic ${e.type}"></span><b>${esc(s[e.side].code)}</b><span class="who${e.who ? '' : ' empty'}">${esc(e.who || (e.type === 'goal' ? 'add scorer' : 'add player'))}</span></li>`).join('')
      : '<li class="none">No goals or cards yet</li>';
    Scenes.football.setColors(H.color, A.color);
    Scenes.football.setRunning(running());
  }

  /* ---------------- wiring ---------------- */
  function init() {
    Scenes.football.mount($('#footballScene'));
    $$('#fbControls .side').forEach(side => side.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const sd = side.dataset.side, act = b.dataset.act;
      if (act === 'goal') goal(sd, 1);
      else if (act === 'minus') goal(sd, -1);
      else card(sd, act);
    }));
    $('#fbNext').addEventListener('click', nextPeriod);
    $('#fbStart').addEventListener('click', toggleClock);
    $('#fbMinus').addEventListener('click', () => adjust(-60));
    $('#fbPlus').addEventListener('click', () => adjust(60));
    $('#fbUndo').addEventListener('click', undo);
    $('#fbNew').addEventListener('click', () => setup(true));
    $('#fbEdit').addEventListener('click', () => setup(false));
    $('#fbEvents').addEventListener('click', e => { const li = e.target.closest('[data-i]'); if (li) editEvent(Number(li.dataset.i)); });
    render();
    lastMinute = minute();
    setInterval(() => {
      renderClock();
      const m = minute();
      if (m !== lastMinute) { lastMinute = m; listener(null); }
    }, 250);
  }

  function key(k) {
    const map = { q: () => goal('home', 1), p: () => goal('away', 1), ' ': toggleClock, u: undo };
    const fn = map[k.toLowerCase()];
    if (fn) { fn(); return true; }
    return false;
  }

  // Re-read the match from storage (after loading it from the server).
  function reload() {
    s = store.get(KEY, null) || fresh();
    history = [];
    lastMinute = minute();
    render();
  }

  return { init, reload, ledTexts, undo, key, onChange: cb => { listener = cb; } };
})();
