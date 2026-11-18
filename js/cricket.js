'use strict';
/* Cricket: ball-by-ball scoring, two innings, batters, bowlers, extras, undo. */
const Cricket = (() => {
  const KEY = 'sb.cricket.v1';
  const HOW = ['Bowled', 'Caught', 'LBW', 'Run out', 'Stumped', 'Hit wicket'];
  const BOWLER_CREDIT = new Set(['Bowled', 'Caught', 'LBW', 'Stumped', 'Hit wicket']);
  const EXTRA_NAME = { wd: 'Wide', nb: 'No ball', b: 'Bye', lb: 'Leg bye' };

  let s = store.get(KEY, null) || fresh();
  let history = [];
  let armed = null;
  let listener = () => {};

  function fresh() {
    return { teams: [{ name: 'Team A', code: 'TMA' }, { name: 'Team B', code: 'TMB' }], overs: 20, players: 11, innings: [], cur: -1, result: '' };
  }
  const newBatter = name => ({ name, runs: 0, balls: 0, fours: 0, sixes: 0, out: '' });
  const newBowler = name => ({ name, balls: 0, maidens: 0, runs: 0, wkts: 0 });
  function newInnings(batting, o) {
    return {
      batting, runs: 0, wkts: 0, balls: 0, extras: { wd: 0, nb: 0, b: 0, lb: 0 },
      batters: [newBatter(o.striker), newBatter(o.nonStriker)], striker: 0, nonStriker: 1,
      bowlers: [newBowler(o.bowler)], bowler: 0, overBowlers: [], lastOut: null,
      thisOver: [], overDone: false, overRuns: 0, done: false,
    };
  }

  const inn = () => s.innings[s.cur] || null;
  const maxBalls = () => s.overs * 6;
  const maxWkts = () => Math.max(1, s.players - 1);
  const target = () => (s.cur === 1 && s.innings[0] ? s.innings[0].runs + 1 : null);
  const ov = b => `${Math.floor(b / 6)}.${b % 6}`;
  const rate = (r, b) => (b ? (r * 6 / b).toFixed(2) : '0.00');
  const extrasTotal = i => i.extras.wd + i.extras.nb + i.extras.b + i.extras.lb;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const swap = i => { [i.striker, i.nonStriker] = [i.nonStriker, i.striker]; };

  function save() { store.set(KEY, s); }
  function snap() { history.push(JSON.stringify(s)); if (history.length > 300) history.shift(); }
  function commit(ev) { save(); render(); listener(ev || null); }

  /* ---------------- scoring engine ---------------- */
  function recordBall({ runs = 0, extra = null, wicket = null }) {
    const i = inn();
    if (!i || i.done) return null;
    snap();
    if (i.overDone) { i.thisOver = []; i.overDone = false; }

    const wideOrNb = extra === 'wd' || extra === 'nb';
    const legal = !wideOrNb;
    const total = runs + (wideOrNb ? 1 : 0);
    const bat = i.batters[i.striker];
    const bowl = i.bowlers[i.bowler];

    i.runs += total;
    if (extra === 'wd') i.extras.wd += total;
    else if (extra === 'nb') i.extras.nb += 1;
    else if (extra) i.extras[extra] += runs;

    if (extra !== 'wd') bat.balls++;
    if (!extra || extra === 'nb') {
      bat.runs += runs;
      if (runs === 4) bat.fours++;
      if (runs === 6) bat.sixes++;
    }
    if (extra !== 'b' && extra !== 'lb') { bowl.runs += total; i.overRuns += total; }
    if (legal) { bowl.balls++; i.balls++; }

    let label;
    if (extra === 'wd') label = total > 1 ? `${total}wd` : 'wd';
    else if (extra === 'nb') label = total > 1 ? `${total}nb` : 'nb';
    else if (extra) label = `${runs}${extra}`;
    else label = runs === 0 ? '•' : String(runs);

    if (runs % 2 === 1) swap(i);

    let kind;
    if (wicket) {
      const out = i.batters[wicket.batter];
      const b = bowl.name;
      out.out = { Bowled: `b ${b}`, Caught: `caught b ${b}`, LBW: `lbw b ${b}`, Stumped: `stumped b ${b}`, 'Hit wicket': `hit wkt b ${b}`, 'Run out': 'run out' }[wicket.how] || wicket.how;
      i.wkts++;
      i.lastOut = wicket.batter;
      if (BOWLER_CREDIT.has(wicket.how)) bowl.wkts++;
      if (i.wkts < maxWkts()) {
        i.batters.push(newBatter(wicket.next || `Batter ${i.batters.length + 1}`));
        const ni = i.batters.length - 1;
        if (i.striker === wicket.batter) i.striker = ni; else i.nonStriker = ni;
      }
      label = total ? `W+${total}` : 'W';
      kind = 'wicket';
    } else {
      kind = extra === 'wd' ? 'wide' : extra === 'nb' ? 'noball' : extra ? 'bye' : runs === 0 ? 'dot' : runs === 4 ? 'four' : runs === 6 ? 'six' : 'runs';
    }
    i.thisOver.push(label);

    let overEnd = false;
    if (legal && i.balls % 6 === 0) {
      overEnd = true;
      if (i.overRuns === 0) bowl.maidens++;
      i.overRuns = 0;
      i.overDone = true;
      i.overBowlers.push(i.bowler);
      swap(i);
    }

    const inningsEnd = checkEnd(i);
    const flash = { four: 'FOUR!', six: 'SIX!', wicket: 'WICKET!', wide: 'WIDE', noball: 'NO BALL' }[kind] || null;
    const ev = { kind, runs, extra, overEnd: overEnd && !inningsEnd, inningsEnd, matchEnd: inningsEnd && s.cur === 1, flash };
    if (ev.matchEnd) ev.flash = s.result;
    commit(ev);
    Scenes.cricket.play(ev);
    return ev;
  }

  function checkEnd(i) {
    const chased = s.cur === 1 && i.runs >= target();
    if (i.balls >= maxBalls() || i.wkts >= maxWkts() || chased) {
      i.done = true;
      if (s.cur === 1) s.result = resultText();
      return true;
    }
    return false;
  }

  function resultText() {
    const a = s.innings[0], b = s.innings[1];
    if (b.runs > a.runs) return `${s.teams[b.batting].name} won by ${plural(maxWkts() - b.wkts, 'wicket')}`;
    if (b.runs === a.runs) return 'Match tied';
    return `${s.teams[a.batting].name} won by ${plural(a.runs - b.runs, 'run')}`;
  }

  function setBowler(name) {
    const i = inn();
    const nm = (name || '').trim() || `Bowler ${i.bowlers.length + 1}`;
    let idx = i.bowlers.findIndex(b => b.name.toLowerCase() === nm.toLowerCase());
    if (idx < 0) { i.bowlers.push(newBowler(nm)); idx = i.bowlers.length - 1; }
    i.bowler = idx;
  }

  /* ---------------- user actions ---------------- */
  function ready() {
    const i = inn();
    if (!i) { setupMatch(); return false; }
    if (i.done) {
      if (s.cur === 0) startSecond();
      else toast(s.result || 'Match over');
      return false;
    }
    return true;
  }

  function scoreRuns(n) {
    if (!ready()) return;
    const extra = armed;
    armed = null;
    const ev = recordBall({ runs: n, extra });
    if (ev) afterBall(ev);
  }

  function arm(extra) {
    if (!ready()) return;
    armed = armed === extra ? null : extra;
    renderArmed();
  }

  async function afterBall(ev) {
    if (ev.inningsEnd && s.cur === 0) await startSecond();
    else if (ev.matchEnd) toast(s.result, 6000);
    else if (ev.overEnd) await pickBowler(true);
  }

  async function wicket() {
    if (!ready()) return;
    const i = inn();
    const last = i.wkts + 1 >= maxWkts();
    const fields = [
      { name: 'how', label: 'How out', type: 'select', options: HOW, half: true },
      {
        name: 'who', label: 'Who is out', type: 'select', half: true,
        options: [
          { value: i.striker, label: `${i.batters[i.striker].name} (striker)` },
          { value: i.nonStriker, label: `${i.batters[i.nonStriker].name} (non-striker)` },
        ],
      },
      {
        name: 'del', label: 'Delivery', type: 'select', half: true, value: armed === 'wd' || armed === 'nb' ? armed : '',
        options: [{ value: '', label: 'Legal ball' }, { value: 'wd', label: 'Wide' }, { value: 'nb', label: 'No ball' }],
      },
      { name: 'runs', label: 'Runs completed', type: 'number', value: 0, min: 0, max: 6, half: true, hint: 'Usually 0 (runs before a run out)' },
    ];
    if (!last) fields.push({ name: 'next', label: 'New batter', value: `Batter ${i.batters.length + 1}`, required: true });
    const r = await ask('Wicket!', fields, { ok: 'Confirm wicket', note: last ? 'This is the last wicket, so the innings will end.' : '' });
    if (!r) return;
    armed = null;
    const ev = recordBall({ runs: clamp(Math.round(r.runs), 0, 6), extra: r.del || null, wicket: { how: r.how, batter: Number(r.who), next: r.next } });
    if (ev) afterBall(ev);
  }

  async function pickBowler(fromOverEnd) {
    const i = inn();
    if (!i || i.done) return;
    const current = i.bowlers[i.bowler].name;
    // Default to whoever bowled the over before this one (bowlers alternate ends).
    const prevIdx = i.overBowlers[i.overBowlers.length - 2];
    const suggestion = fromOverEnd
      ? (prevIdx != null && prevIdx !== i.bowler ? i.bowlers[prevIdx].name : `Bowler ${i.bowlers.length + 1}`)
      : current;
    const r = await ask(fromOverEnd ? `End of over ${i.balls / 6}` : 'Change bowler', [
      { name: 'bowler', label: 'Bowler', value: suggestion, suggestions: i.bowlers.map(b => b.name), required: true, hint: 'Pick a name from the list or type a new bowler.' },
    ], { ok: 'Set bowler', cancel: !fromOverEnd, note: fromOverEnd ? `${current} has just bowled. The same bowler can't bowl two overs in a row.` : '' });
    if (!r && !fromOverEnd) return;
    const name = r ? r.bowler : suggestion;
    if (fromOverEnd && name.toLowerCase() === current.toLowerCase()) toast(`Warning: ${current} is bowling two overs in a row`);
    if (!fromOverEnd) snap();
    setBowler(name);
    commit({ kind: 'bowler' });
  }

  async function openers(battingTeam, bowlingTeam, note) {
    const r = await ask(`${battingTeam} to bat`, [
      { name: 'st', label: 'Striker', value: 'Batter 1', half: true, required: true },
      { name: 'ns', label: 'Non-striker', value: 'Batter 2', half: true, required: true },
      { name: 'bw', label: `Opening bowler (${bowlingTeam})`, value: 'Bowler 1', required: true },
    ], { ok: 'Start innings', note });
    return r && { striker: r.st, nonStriker: r.ns, bowler: r.bw };
  }

  async function setupMatch() {
    const r = await ask('New cricket match', [
      { name: 't1', label: 'Team 1 name', value: s.teams[0].name, required: true, half: true },
      { name: 'c1', label: 'Short code (for LED)', value: s.teams[0].code, maxLength: 4, half: true },
      { name: 't2', label: 'Team 2 name', value: s.teams[1].name, required: true, half: true },
      { name: 'c2', label: 'Short code (for LED)', value: s.teams[1].code, maxLength: 4, half: true },
      { name: 'overs', label: 'Overs per innings', type: 'number', value: s.overs, min: 1, max: 100, half: true },
      { name: 'players', label: 'Players per side', type: 'number', value: s.players, min: 2, max: 15, half: true },
      { name: 'first', label: 'Who bats first?', type: 'select', options: [{ value: 0, label: 'Team 1' }, { value: 1, label: 'Team 2' }] },
    ], { ok: 'Next', note: 'Leave the short code blank to make one from the team name.' });
    if (!r) return;
    const teams = [
      { name: r.t1, code: (r.c1 || teamCode(r.t1)).toUpperCase() },
      { name: r.t2, code: (r.c2 || teamCode(r.t2)).toUpperCase() },
    ];
    const batting = Number(r.first);
    const o = await openers(teams[batting].name, teams[1 - batting].name);
    if (!o) return;
    history = [];
    armed = null;
    s = fresh();
    s.teams = teams;
    s.overs = clamp(Math.round(r.overs), 1, 100);
    s.players = clamp(Math.round(r.players), 2, 15);
    s.innings = [newInnings(batting, o)];
    s.cur = 0;
    Scenes.cricket.reset();
    commit({ kind: 'start' });
  }

  async function startSecond() {
    if (s.cur !== 0 || !s.innings[0] || !s.innings[0].done) return;
    const a = s.innings[0];
    const batting = 1 - a.batting;
    const o = await openers(s.teams[batting].name, s.teams[a.batting].name,
      `${s.teams[a.batting].name} made ${a.runs}/${a.wkts}. Target: ${a.runs + 1} from ${s.overs} overs.`);
    if (!o) return;
    snap();
    s.innings.push(newInnings(batting, o));
    s.cur = 1;
    Scenes.cricket.reset();
    commit({ kind: 'start', flash: `TARGET ${a.runs + 1}` });
  }

  async function endInnings() {
    const i = inn();
    if (!i || i.done) return;
    if (!await confirmBox('End this innings now?', 'Use this for a declaration or if play is stopped.', 'End innings')) return;
    snap();
    i.done = true;
    if (s.cur === 1) s.result = resultText();
    commit({ kind: 'end', flash: s.cur === 1 ? s.result : 'INNINGS BREAK' });
    if (s.cur === 0) startSecond();
  }

  async function editTeams() {
    const r = await ask('Edit teams', [
      { name: 't1', label: 'Team 1 name', value: s.teams[0].name, required: true, half: true },
      { name: 'c1', label: 'Short code', value: s.teams[0].code, maxLength: 4, half: true },
      { name: 't2', label: 'Team 2 name', value: s.teams[1].name, required: true, half: true },
      { name: 'c2', label: 'Short code', value: s.teams[1].code, maxLength: 4, half: true },
      { name: 'overs', label: 'Overs per innings', type: 'number', value: s.overs, min: 1, max: 100, half: true },
      { name: 'players', label: 'Players per side', type: 'number', value: s.players, min: 2, max: 15, half: true },
    ], { ok: 'Save' });
    if (!r) return;
    snap();
    s.teams = [
      { name: r.t1, code: (r.c1 || teamCode(r.t1)).toUpperCase() },
      { name: r.t2, code: (r.c2 || teamCode(r.t2)).toUpperCase() },
    ];
    s.overs = clamp(Math.round(r.overs), 1, 100);
    s.players = clamp(Math.round(r.players), 2, 15);
    commit({ kind: 'edit' });
  }

  async function renameBatter(idx) {
    const i = inn();
    if (!i || !i.batters[idx]) return;
    const r = await ask('Rename batter', [{ name: 'nm', label: 'Name', value: i.batters[idx].name, required: true }], { ok: 'Save' });
    if (!r) return;
    snap();
    i.batters[idx].name = r.nm;
    commit({ kind: 'edit' });
  }

  async function newMatch() {
    if (s.cur >= 0 && !s.result && !await confirmBox('Start a new match?', 'The current match will be cleared.', 'New match')) return;
    setupMatch();
  }

  function undo() {
    if (!history.length) { toast('Nothing to undo'); return; }
    s = JSON.parse(history.pop());
    armed = null;
    Scenes.cricket.reset();
    commit({ kind: 'undo' });
  }

  /* ---------------- LED text ---------------- */
  function ledTexts() {
    const i = inn();
    const [A, B] = s.teams;
    if (!i) return { candidates: [`${A.code} V ${B.code}`, 'CRICKET'], ticker: `${A.name} VS ${B.name}` };
    const T = s.teams[i.batting];
    const sc = `${i.runs}/${i.wkts}`;
    const o = ov(i.balls);
    if (s.result) {
      const a = s.innings[0];
      return { candidates: [`${T.code} ${sc}`, sc], ticker: `${s.result} | ${s.teams[a.batting].code} ${a.runs}/${a.wkts} - ${T.code} ${sc}` };
    }
    let t = `${T.name} ${sc} (${o} OV)`;
    const tg = target();
    t += tg ? ` NEED ${Math.max(0, tg - i.runs)} OFF ${Math.max(0, maxBalls() - i.balls)}` : ` CRR ${rate(i.runs, i.balls)}`;
    if (!i.done) {
      const st = i.batters[i.striker], ns = i.batters[i.nonStriker], bw = i.bowlers[i.bowler];
      t += ` | ${st.name} ${st.runs}(${st.balls})* ${ns.name} ${ns.runs}(${ns.balls}) | ${bw.name} ${bw.wkts}-${bw.runs}`;
    }
    return { candidates: [`${T.code} ${sc} ${o}`, `${T.code} ${sc}`, sc], ticker: t };
  }

  /* ---------------- rendering ---------------- */
  function renderArmed() {
    $$('#ckControls [data-extra]').forEach(b => b.classList.toggle('on', b.dataset.extra === armed));
    $('#ckArmHint').textContent = armed
      ? (armed === 'wd' || armed === 'nb' ? `${EXTRA_NAME[armed]}: tap the runs scored off it (0 = none)` : `${EXTRA_NAME[armed]}: tap how many runs`)
      : '';
  }

  const chipClass = l => (l === '•' ? 'dot' : l === '4' ? 'b4' : l === '6' ? 'b6' : l[0] === 'W' ? 'wk' : /[a-z]/.test(l) ? 'ex' : '');

  function render() {
    const i = inn();
    $('#ckEmpty').hidden = !!i;
    $('#ckLive').hidden = !i;
    const playable = !!i && !i.done;
    $$('#ckControls .btn').forEach(b => { b.disabled = !playable; });
    $('#ckUndo').disabled = !history.length;
    $('#ckEndInn').disabled = !playable;
    $('#ckEdit').disabled = !i;
    renderArmed();
    if (!i) {
      $('#ckBatters tbody').innerHTML = '';
      $('#ckBowlers tbody').innerHTML = '';
      $('#ckLastOut').textContent = '';
      $('#ckCard').innerHTML = '';
      return;
    }

    const T = s.teams[i.batting], O = s.teams[1 - i.batting];
    $('#ckInnings').textContent = s.cur === 0 ? '1st innings' : '2nd innings';
    const a = s.innings[0];
    $('#ckFirst').textContent = s.cur === 1 ? `${s.teams[a.batting].code} ${a.runs}/${a.wkts} (${ov(a.balls)})` : `${s.overs} overs · ${s.players} a side`;
    $('#ckTeam').textContent = T.name;
    $('#ckVs').textContent = `vs ${O.name}`;
    $('#ckScore').textContent = `${i.runs}/${i.wkts}`;
    $('#ckOvers').textContent = ov(i.balls);
    $('#ckOversMax').textContent = s.overs;
    $('#ckCrr').textContent = rate(i.runs, i.balls);
    const ex = i.extras;
    $('#ckExtras').textContent = extrasTotal(i);
    $('#ckExtras').title = `wd ${ex.wd}, nb ${ex.nb}, b ${ex.b}, lb ${ex.lb}`;

    const tg = target();
    const left = maxBalls() - i.balls;
    if (tg) {
      const need = Math.max(0, tg - i.runs);
      $('#ckSlotLabel').textContent = 'Target';
      $('#ckSlot').textContent = tg;
      $('#ckRrr').textContent = left > 0 ? rate(need, left) : '-';
      $('#ckChase').hidden = i.done;
      $('#ckChase').textContent = `${T.name} need ${plural(need, 'run')} from ${plural(left, 'ball')}`;
    } else {
      $('#ckSlotLabel').textContent = 'Projected';
      $('#ckSlot').textContent = i.balls ? Math.round(i.runs + (i.runs / i.balls) * left) : '-';
      $('#ckRrr').textContent = '-';
      $('#ckChase').hidden = true;
    }

    $('#ckThisOver').innerHTML = i.thisOver.map(l => `<span class="chip ${chipClass(l)}">${esc(l)}</span>`).join('') || '<span class="muted small">New over</span>';

    const banner = s.result || (i.done && s.cur === 0 ? `Innings over: ${T.name} ${i.runs}/${i.wkts}. Target ${i.runs + 1}` : '');
    $('#ckBanner').hidden = !banner;
    $('#ckBannerText').textContent = banner;
    $('#ckSecondBtn').hidden = !(i.done && s.cur === 0);

    const batRow = idx => {
      const b = i.batters[idx];
      const sr = b.balls ? (b.runs * 100 / b.balls).toFixed(1) : '0.0';
      const strike = idx === i.striker && !i.done && !b.out;
      return `<tr data-bat="${idx}"><td class="${strike ? 'strike' : ''}">${esc(b.name)}${b.out ? `<span class="how">${esc(b.out)}</span>` : ''}</td><td>${b.runs}</td><td>${b.balls}</td><td>${b.fours}</td><td>${b.sixes}</td><td>${sr}</td></tr>`;
    };
    $('#ckBatters tbody').innerHTML = batRow(i.striker) + batRow(i.nonStriker);
    const bw = i.bowlers[i.bowler];
    $('#ckBowlers tbody').innerHTML = `<tr><td>${esc(bw.name)}</td><td>${ov(bw.balls)}</td><td>${bw.maidens}</td><td>${bw.runs}</td><td>${bw.wkts}</td><td>${rate(bw.runs, bw.balls)}</td></tr>`;
    const lo = i.lastOut != null ? i.batters[i.lastOut] : null;
    $('#ckLastOut').textContent = lo ? `Last wicket: ${lo.name} ${lo.runs} (${lo.balls}), ${lo.out}` : '';

    $('#ckCard').innerHTML = s.innings.map(x => {
      const tm = s.teams[x.batting];
      const bats = x.batters.map(b => `<tr><td>${esc(b.name)}<span class="how">${esc(b.out || 'not out')}</span></td><td>${b.runs}</td><td>${b.balls}</td><td>${b.fours}</td><td>${b.sixes}</td></tr>`).join('');
      const bowls = x.bowlers.map(b => `<tr><td>${esc(b.name)}</td><td>${ov(b.balls)}</td><td>${b.maidens}</td><td>${b.runs}</td><td>${b.wkts}</td></tr>`).join('');
      return `<h4>${esc(tm.name)}: ${x.runs}/${x.wkts} (${ov(x.balls)} ov)</h4>
        <table class="tbl"><thead><tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th></tr></thead><tbody>${bats}</tbody></table>
        <p class="muted small">Extras ${extrasTotal(x)} (wd ${x.extras.wd}, nb ${x.extras.nb}, b ${x.extras.b}, lb ${x.extras.lb})</p>
        <table class="tbl"><thead><tr><th>Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th></tr></thead><tbody>${bowls}</tbody></table>`;
    }).join('');
  }

  /* ---------------- wiring ---------------- */
  function init() {
    Scenes.cricket.mount($('#cricketScene'));
    $$('#ckControls [data-runs]').forEach(b => b.addEventListener('click', () => scoreRuns(Number(b.dataset.runs))));
    $$('#ckControls [data-extra]').forEach(b => b.addEventListener('click', () => arm(b.dataset.extra)));
    $('#ckWicket').addEventListener('click', wicket);
    $('#ckSwap').addEventListener('click', () => { if (!ready()) return; snap(); swap(inn()); commit({ kind: 'swap' }); });
    $('#ckBowlerBtn').addEventListener('click', () => { if (ready()) pickBowler(false); });
    $('#ckUndo').addEventListener('click', undo);
    $('#ckStartBtn').addEventListener('click', setupMatch);
    $('#ckSecondBtn').addEventListener('click', startSecond);
    $('#ckNew').addEventListener('click', newMatch);
    $('#ckEdit').addEventListener('click', editTeams);
    $('#ckEndInn').addEventListener('click', endInnings);
    $('#ckBatters').addEventListener('click', e => { const tr = e.target.closest('[data-bat]'); if (tr) renameBatter(Number(tr.dataset.bat)); });
    render();
  }

  function key(k) {
    if (/^[0-6]$/.test(k)) { scoreRuns(Number(k)); return true; }
    const map = { d: () => arm('wd'), n: () => arm('nb'), b: () => arm('b'), l: () => arm('lb'), w: wicket, u: undo, s: () => $('#ckSwap').click() };
    const fn = map[k.toLowerCase()];
    if (fn) { fn(); return true; }
    return false;
  }

  // Re-read the match from storage (after loading it from the server).
  function reload() {
    s = store.get(KEY, null) || fresh();
    history = [];
    armed = null;
    Scenes.cricket.reset();
    render();
  }

  return { init, reload, ledTexts, undo, key, onChange: cb => { listener = cb; } };
})();
