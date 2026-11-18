'use strict';
/*
 * Big-screen viewer. Reads the match the control panel (index.html) saves in this browser
 * and updates live: storage events when another tab changes it, plus a 1 s poll as a fallback.
 */
(() => {
  const KEYS = ['sb.sport', 'sb.cricket.v1', 'sb.football.v1'];
  const ov = b => `${Math.floor(b / 6)}.${b % 6}`;
  const rate = (r, b) => (b ? (r * 6 / b).toFixed(2) : '0.00');
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const chipClass = l => (l === '•' ? 'dot' : l === '4' ? 'b4' : l === '6' ? 'b6' : l[0] === 'W' ? 'wk' : /[a-z]/.test(l) ? 'ex' : '');
  const raw = k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };

  let sport = 'cricket';
  let fb = null;
  let lastRaw = '';
  let lastEventT = (store.get('sb.event', null) || {}).t || 0;

  Scenes.cricket.mount($('#dkScene'));
  Scenes.football.mount($('#dfScene'));

  /* ---------------- cricket ---------------- */
  function renderCricket(s) {
    const teams = s ? s.teams : [{ name: 'Team A' }, { name: 'Team B' }];
    $('#dkMatch').textContent = s ? `${teams[0].name} vs ${teams[1].name} · ${s.overs} overs` : '';
    const i = s && s.innings[s.cur];
    if (!i) {
      $('#dkInn').textContent = 'Coming up';
      $('#dkTeam').textContent = `${teams[0].name} vs ${teams[1].name}`;
      $('#dkVs').textContent = '';
      $('#dkScore').textContent = '0/0';
      $('#dkOvers').textContent = '';
      $('#dkInfo').textContent = 'Match starting soon';
      $('#dkOver').innerHTML = '';
      $('#dkBat').innerHTML = '';
      $('#dkBowl').innerHTML = '';
      $('#dkFoot').innerHTML = '';
      return;
    }
    const T = teams[i.batting], O = teams[1 - i.batting];
    const maxBalls = s.overs * 6, left = maxBalls - i.balls;
    const target = s.cur === 1 ? s.innings[0].runs + 1 : null;
    $('#dkInn').textContent = s.cur === 0 ? '1st innings' : '2nd innings';
    $('#dkTeam').textContent = T.name;
    $('#dkVs').textContent = `vs ${O.name}`;
    $('#dkScore').textContent = `${i.runs}/${i.wkts}`;
    $('#dkOvers').textContent = `${ov(i.balls)} / ${s.overs} OV`;

    let info;
    if (s.result) info = s.result;
    else if (i.done) info = `Innings break · Target ${i.runs + 1}`;
    else if (target) info = `Need ${plural(Math.max(0, target - i.runs), 'run')} from ${plural(left, 'ball')}`;
    else info = i.balls ? `Projected score ${Math.round(i.runs + (i.runs / i.balls) * left)}` : '';
    $('#dkInfo').textContent = info;
    $('#dkOver').innerHTML = i.thisOver.map(l => `<span class="chip ${chipClass(l)}">${esc(l)}</span>`).join('') || '<span>New over</span>';

    const row = idx => {
      const b = i.batters[idx];
      const strike = idx === i.striker && !i.done && !b.out;
      return `<tr><td class="${strike ? 'strike' : ''}">${esc(b.name)}</td><td>${b.runs} (${b.balls})</td></tr>`;
    };
    $('#dkBat').innerHTML = row(i.striker) + row(i.nonStriker);
    const bw = i.bowlers[i.bowler];
    $('#dkBowl').innerHTML = `<tr><td><span class="lbl">Bowling</span>${esc(bw.name)}</td><td>${bw.wkts}-${bw.runs} (${ov(bw.balls)})</td></tr>`;

    const ex = i.extras.wd + i.extras.nb + i.extras.b + i.extras.lb;
    const parts = [];
    if (s.result) parts.push(`<span class="result">${esc(s.result)}</span>`);
    if (s.cur === 1) { const a = s.innings[0]; parts.push(`<span>${esc(teams[a.batting].name)}<b>${a.runs}/${a.wkts} (${ov(a.balls)})</b></span>`); }
    parts.push(`<span>CRR<b>${rate(i.runs, i.balls)}</b></span>`);
    if (target && !i.done) parts.push(`<span>RRR<b>${left > 0 ? rate(Math.max(0, target - i.runs), left) : '-'}</b></span>`);
    parts.push(`<span>Extras<b>${ex}</b></span>`);
    $('#dkFoot').innerHTML = parts.join('');
  }

  /* ---------------- football ---------------- */
  const LABEL = { PRE: 'Pre-match', '1H': '1st half', HT: 'Half time', '2H': '2nd half', FT: 'Full time' };
  // clockShift converts this device's clock to the scoring device's clock (0 when both are the same browser).
  let clockShift = 0;
  const elapsed = () => fb.baseMs + (fb.startedAt ? Math.max(0, Date.now() + clockShift - fb.startedAt) : 0);
  const pad = n => String(n).padStart(2, '0');

  function minute() {
    if (fb.period === 'PRE') return '';
    if (fb.period === 'HT' || fb.period === 'FT') return LABEL[fb.period];
    const m = Math.floor(elapsed() / 60000);
    const end = (fb.period === '1H' ? 1 : 2) * fb.half;
    return m >= end ? `${end}+${m - end + 1}'` : `${m + 1}'`;
  }

  function renderClock() {
    if (!fb) return;
    const ms = elapsed();
    $('#dfClock').textContent = `${pad(Math.floor(ms / 60000))}:${pad(Math.floor(ms / 1000) % 60)}`;
    $('#dfMin').textContent = minute();
  }

  function renderFootball(s) {
    fb = s || { half: 45, home: { name: 'Home', color: '#e63946', score: 0 }, away: { name: 'Away', color: '#4da3ff', score: 0 }, period: 'PRE', baseMs: 0, startedAt: null, events: [] };
    const H = fb.home, A = fb.away;
    document.body.style.setProperty('--home', H.color);
    document.body.style.setProperty('--away', A.color);
    $('#dfPeriod').textContent = LABEL[fb.period];
    $('#dfMatch').textContent = `${H.name} vs ${A.name} · ${fb.half} min halves`;
    $('#dfHome').textContent = H.name;
    $('#dfAway').textContent = A.name;
    $('#dfHs').textContent = H.score;
    $('#dfAs').textContent = A.score;
    const evList = side => fb.events.filter(e => e.side === side).map(e => {
      const icon = e.type === 'goal' ? '' : `<span class="card-ic ${e.type}"></span>`;
      const who = e.who || (e.type === 'goal' ? 'Goal' : '');
      return `<li>${icon}${esc(who)}<span class="m">${esc(e.min)}</span></li>`;
    }).join('');
    $('#dfHomeEv').innerHTML = evList('home');
    $('#dfAwayEv').innerHTML = evList('away');
    Scenes.football.setColors(H.color, A.color);
    Scenes.football.setRunning(fb.startedAt != null);
    renderClock();
  }

  /* ---------------- sync ---------------- */
  function render(st) {
    sport = st.sport === 'football' ? 'football' : 'cricket';
    $('#dCricket').hidden = sport !== 'cricket';
    $('#dFootball').hidden = sport !== 'football';
    renderCricket(st.cricket || null);
    renderFootball(st.football || null);
  }

  function bigPop(text, color) {
    const el = $('#dPop');
    el.textContent = text;
    el.style.color = color || '#fff';
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(bigPop.t);
    bigPop.t = setTimeout(() => { el.classList.remove('show'); el.textContent = ''; }, 2500);
  }

  const POP_COLOR = { four: '#ffd23f', six: '#ff7ae0', wicket: '#ff4d5e', goal: '#3ddc84' };
  function handleEvent(ev) {
    if (!ev || ev.t <= lastEventT) return;
    lastEventT = ev.t;
    if (ev.sport !== sport) return;
    if (ev.sport === 'cricket') {
      if (ev.kind === 'undo' || ev.kind === 'start') Scenes.cricket.reset();
      else Scenes.cricket.play(ev);
      if (ev.flash && ['four', 'six', 'wicket'].includes(ev.kind)) setTimeout(() => bigPop(ev.flash, POP_COLOR[ev.kind]), 1150);
      else if (ev.flash && ev.kind !== 'wide' && ev.kind !== 'noball') bigPop(ev.flash, '#ffb020');
    } else {
      if (ev.kind === 'goal') { Scenes.football.goal(ev.side, fb && fb[ev.side] ? fb[ev.side].color : '#fff'); bigPop('GOAL!', fb && fb[ev.side] ? fb[ev.side].color : POP_COLOR.goal); }
      else if (ev.kind === 'card') Scenes.football.card(ev.type, fb && fb[ev.side] ? fb[ev.side].code : '');
      else if (ev.flash) bigPop(ev.flash, '#ffb020');
    }
  }

  const setLive = on => $$('.d-live').forEach(el => el.classList.toggle('off', !on));

  if (location.protocol.startsWith('http')) {
    // Served by server.js or Vercel: check for a new version every second.
    let primed = false, version = null, fails = 0, viewerOffset = 0, ctlOffset = 0;
    const syncTime = async () => {
      try {
        const t0 = Date.now();
        const j = await (await fetch('/api/time', { cache: 'no-store' })).json();
        viewerOffset = j.now - (t0 + Date.now()) / 2;  // server clock minus this device's clock
        clockShift = viewerOffset - ctlOffset;
      } catch { /* keep the last offset */ }
    };
    const poll = async () => {
      try {
        const r = await fetch('/api/state', { cache: 'no-store' });
        if (!r.ok) throw new Error(String(r.status));
        const st = await r.json();
        fails = 0;
        setLive(true);
        if (st.version !== version || version === null) {
          version = st.version ?? 0;
          ctlOffset = st.ctlOffset || 0;
          clockShift = viewerOffset - ctlOffset;
          render(st);
          if (!primed) { primed = true; lastEventT = st.event ? st.event.t : 0; }  // don't replay an old event on load
          else handleEvent(st.event);
        }
      } catch {
        if (++fails >= 3) setLive(false);
      }
      setTimeout(poll, document.hidden ? 5000 : 1000);
    };
    syncTime().then(poll);
    setInterval(syncTime, 60000);
  } else {
    // Opened as a file: follow the control panel open in this same browser.
    const readLocal = () => ({
      sport: store.get('sb.sport', 'cricket'),
      cricket: store.get('sb.cricket.v1', null),
      football: store.get('sb.football.v1', null),
    });
    const check = () => {
      const now = KEYS.map(raw).join('\u0001');
      if (now !== lastRaw) { lastRaw = now; render(readLocal()); }
      handleEvent(store.get('sb.event', null));
    };
    window.addEventListener('storage', check);
    setInterval(check, 1000);
    check();
  }
  setInterval(renderClock, 250);

  /* ---------------- full screen ---------------- */
  const toggleFs = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
  $('#fsBtn').addEventListener('click', toggleFs);
  document.addEventListener('keydown', e => { if (e.key.toLowerCase() === 'f') toggleFs(); });
})();
