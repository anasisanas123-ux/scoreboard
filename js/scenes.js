'use strict';
/* Pixel-art scenes: a side-on cricket pitch (bowler, batter, keeper) and a top-down football pitch. */
const Scenes = (() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lerp = (a, b, p) => a + (b - a) * p;
  const ease = p => 1 - (1 - p) * (1 - p);

  // Turn rows of characters into SVG rects (runs of the same colour are merged).
  function rects(rows, pal) {
    let out = '';
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length;) {
        const c = row[x];
        if (!pal[c]) { x++; continue; }
        let w = 1;
        while (row[x + w] === c) w++;
        out += `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${pal[c]}"/>`;
        x += w;
      }
    });
    return out;
  }
  const frames = (map, pal) => Object.keys(map)
    .map((k, n) => `<g data-f="${k}"${n ? ' display="none"' : ''}>${rects(map[k], pal)}</g>`).join('');
  const setFrame = (g, name) => g.querySelectorAll('[data-f]').forEach(f => f.setAttribute('display', f.dataset.f === name ? 'inline' : 'none'));

  // Promise-based tween; resolves false if a newer animation started.
  function tween(ctx, ms, fn) {
    const token = ctx.token;
    return new Promise(res => {
      const t0 = performance.now();
      const step = now => {
        if (ctx.token !== token) return res(false);
        const p = Math.min(1, (now - t0) / ms);
        fn(p);
        if (p < 1) requestAnimationFrame(step); else res(true);
      };
      requestAnimationFrame(step);
    });
  }
  const wait = (ctx, ms) => tween(ctx, ms, () => {});

  function pop(el, text, color) {
    el.textContent = text;
    el.setAttribute('fill', color || '#fff');
    el.classList.remove('show');
    void el.getBoundingClientRect();
    el.classList.add('show');
  }

  function seeded(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }

  /* ===================================================================== */
  const cricket = (() => {
    const ctx = { token: 0 };
    const PAL = { h: '#1d3b8a', s: '#d9a066', w: '#f6f3ea', p: '#ddd8c8', q: '#ffffff', b: '#c98f55', k: '#262626', g: '#7d838f', r: '#d4231b' };
    const BOWLER = {
      run2: [
        '....hhhh....', '..hhhhhh....', '....sss.....', '...ssss.....', '....ss......', '...wwwww....',
        '..wwwwwww...', '..swwwwws...', '..swwwwws...', '...wwwww....', '...wwwww....', '....www.....',
        '....www.....', '....w.w.....', '....w.w.....', '....w.w.....', '...kk.kk....',
      ],
      run1: [
        '....hhhh....', '..hhhhhh....', '....sss.....', '...ssss.....', '....ss......', '...wwwww....',
        '..wwwwwww...', '.s.wwwww.s..', 's..wwwww..s.', '...wwwww....', '...wwwww....', '...ww.ww....',
        '..ww...ww...', '..w.....w...', '.ww.....ww..', '.w.......w..', 'kk.......kk.',
      ],
      deliver: [
        '.........r..', '....hhhh.s..', '..hhhhhh.s..', '....sss..s..', '...ssss..s..', '....ss...s..',
        '...wwwwwws..', '..wwwwwww...', 's.wwwwwww...', '.s.wwwww....', '...wwwww....', '...ww.ww....',
        '..ww...ww...', '.ww.....w...', 'ww......ww..', 'w.........w.', 'k.........kk',
      ],
    };
    const BATTER = {
      stance: [
        '...hhhh.....', '..hhhhhhh...', '..hhsssg....', '...ssssg....', '....ss......', '...wwwww....',
        '..wwwwwww...', '..wwwwwwqq..', '..wwwwwwqq..', '...wwwww.b..', '...wwwww.b..', '...pp.pp.b..',
        '...pp.pp.b..', '...pp.pp.bb.', '...pp.pp.bb.', '...pp.pp....', '..kkk.kkk...',
      ],
      swing: [
        '...hhhh.....', '..hhhhhhh...', '..hhsssg..bb', '...ssssg.bb.', '....ss..bb..', '...wwwwqq...',
        '..wwwwwqq...', '..wwwwwww...', '..wwwwww....', '...wwwww....', '...wwwww....', '...pp.pp....',
        '..pp...pp...', '..pp...pp...', '.pp.....pp..', '.pp.....pp..', 'kkk.....kkk.',
      ],
    };
    const KEEPER = {
      crouch: [
        '............', '............', '............', '............', '...hhhh.....', '..hhhhhh....',
        '...sssss....', '...wwwww....', '..wwwwwwqq..', '..wwwwwwqq..', '..wwwwww....', '..ppppp.....',
        '.pp...pp....', '.pp...pp....', '.pp...pp....', '.pp...pp....', 'kkk..kkk....',
      ],
    };

    let svg, bowler, batter, ball, shadow, popEl, bails, stumps;
    const BOWL_IDLE = 216, BOWL_AT = 190, TOP = 66;

    function stumpSet(x, id) {
      return `<g id="${id}"><rect x="${x}" y="86" width="1" height="14" fill="#f2dca2"/><rect x="${x + 2}" y="86" width="1" height="14" fill="#f2dca2"/><rect x="${x + 4}" y="86" width="1" height="14" fill="#f2dca2"/>` +
        `<g class="bails"><rect x="${x}" y="85" width="2" height="1" fill="#fff4cc"/><rect x="${x + 3}" y="85" width="2" height="1" fill="#fff4cc"/></g></g>`;
    }

    function mount(el) {
      svg = el;
      svg.setAttribute('viewBox', '0 0 240 120');
      const rnd = seeded(11);
      const crowdCols = ['#e63946', '#f1faee', '#a8dadc', '#457b9d', '#ffb703', '#fb8500', '#8ecae6', '#2a9d8f', '#e76f51', '#b5179e', '#30354f', '#30354f', '#30354f'];
      let crowd = '';
      for (let y = 19; y < 40; y += 3) for (let x = 0; x < 240; x += 3) crowd += `<rect x="${x}" y="${y}" width="3" height="3" fill="${crowdCols[Math.floor(rnd() * crowdCols.length)]}"/>`;
      const boardCols = ['#e94f37', '#1c77c3', '#f6c026', '#39a96b'];
      let boards = '';
      for (let x = 0, n = 0; x < 240; x += 30, n++) boards += `<rect x="${x}" y="40" width="30" height="6" fill="${boardCols[n % 4]}"/><rect x="${x + 4}" y="42" width="${10 + (n % 3) * 4}" height="2" fill="rgba(255,255,255,.75)"/>`;
      let grass = '';
      for (let y = 46, n = 0; y < 120; y += 8, n++) grass += `<rect x="0" y="${y}" width="240" height="8" fill="${n % 2 ? '#47a84e' : '#3f9b46'}"/>`;

      svg.innerHTML = `
        <rect width="240" height="19" fill="#7cc8f2"/>
        <rect x="30" y="5" width="22" height="3" fill="#fff"/><rect x="34" y="2" width="12" height="3" fill="#fff"/>
        <rect x="160" y="8" width="26" height="3" fill="#fff"/><rect x="166" y="5" width="12" height="3" fill="#fff"/>
        <rect y="19" width="240" height="21" fill="#30354f"/>${crowd}${boards}${grass}
        <rect x="0" y="47" width="240" height="1" fill="#fff" opacity=".7"/>
        <polygon points="14,94 226,94 232,106 8,106" fill="#d9c38e"/>
        <polygon points="14,94 60,94 58,106 8,106" fill="#c9ad72"/>
        <polygon points="180,94 226,94 232,106 182,106" fill="#c9ad72"/>
        <rect x="40" y="94" width="1" height="12" fill="#fff"/><rect x="200" y="94" width="1" height="12" fill="#fff"/>
        ${stumpSet(28, 'ckStumpsBat')}${stumpSet(204, 'ckStumpsBowl')}
        <g id="ckKeeper" transform="translate(2 ${TOP}) scale(2)">${frames(KEEPER, PAL)}</g>
        <g id="ckBatter" transform="translate(36 ${TOP}) scale(2)">${frames(BATTER, PAL)}</g>
        <g id="ckBowler" transform="translate(${BOWL_IDLE} ${TOP}) scale(2)">${frames(BOWLER, PAL)}</g>
        <rect id="ckShadow" y="103" width="4" height="1" fill="rgba(0,0,0,.35)" visibility="hidden"/>
        <rect id="ckBall" width="3" height="3" fill="#d4231b" visibility="hidden"/>
        <text id="ckPop" class="pop" x="120" y="62" text-anchor="middle"></text>`;
      bowler = svg.querySelector('#ckBowler');
      batter = svg.querySelector('#ckBatter');
      ball = svg.querySelector('#ckBall');
      shadow = svg.querySelector('#ckShadow');
      popEl = svg.querySelector('#ckPop');
      stumps = svg.querySelector('#ckStumpsBat');
      bails = stumps.querySelector('.bails');
      reset();
    }

    const place = (g, x) => g.setAttribute('transform', `translate(${x.toFixed(1)} ${TOP}) scale(2)`);
    function setBall(x, y, show = true) {
      const v = show ? 'visible' : 'hidden';
      ball.setAttribute('x', (x - 1.5).toFixed(1));
      ball.setAttribute('y', (y - 1.5).toFixed(1));
      shadow.setAttribute('x', (x - 2).toFixed(1));
      ball.setAttribute('visibility', v);
      shadow.setAttribute('visibility', v);
    }

    function reset() {
      ctx.token++;
      if (!svg) return;
      place(bowler, BOWL_IDLE);
      setFrame(bowler, 'run2');
      setFrame(batter, 'stance');
      setBall(0, 0, false);
      bails.removeAttribute('transform');
      stumps.removeAttribute('transform');
    }

    function label(ev) {
      const r = ev.runs;
      switch (ev.kind) {
        case 'four': return ['FOUR!', '#ffd23f'];
        case 'six': return ['SIX!', '#ff7ae0'];
        case 'wicket': return ['OUT!', '#ff4d5e'];
        case 'wide': return [r ? `WIDE +${r}` : 'WIDE', '#ffffff'];
        case 'noball': return [r ? `NO BALL +${r}` : 'NO BALL', '#ffb020'];
        case 'bye': return [`${r} ${ev.extra === 'lb' ? 'LEG BYE' : 'BYE'}${r === 1 ? '' : 'S'}`, '#ffffff'];
        case 'runs': return [`${r} RUN${r === 1 ? '' : 'S'}`, '#ffffff'];
        default: return ['DOT BALL', '#cfd8dc'];
      }
    }

    async function play(ev) {
      if (!svg) return;
      reset();
      const BALLS = ['dot', 'runs', 'four', 'six', 'wicket', 'wide', 'noball', 'bye'];
      if (!ev || !BALLS.includes(ev.kind)) return;
      const [text, color] = label(ev);
      if (reduced) { pop(popEl, text, color); return; }

      // Run-up
      if (!await tween(ctx, 650, p => { place(bowler, lerp(252, BOWL_AT, p)); setFrame(bowler, Math.floor(p * 9) % 2 ? 'run1' : 'run2'); })) return;
      setFrame(bowler, 'deliver');
      if (!await wait(ctx, 110)) return;
      setFrame(bowler, 'run1');

      // Ball flight: release -> bounce -> batter
      const rx = BOWL_AT + 19, ry = TOP + 1, bx = 92, by = 101, hx = 60, hy = 92;
      if (!await tween(ctx, 420, p => {
        if (p < 0.72) { const q = p / 0.72; setBall(lerp(rx, bx, q), lerp(ry, by, q * q)); }
        else { const q = (p - 0.72) / 0.28; setBall(lerp(bx, hx, q), lerp(by, hy, q)); }
      })) return;

      const k = ev.kind, r = ev.runs;
      let ok = true;
      if (k === 'wicket') {
        ok = await tween(ctx, 140, p => setBall(lerp(hx, 33, p), lerp(hy, 93, p)));
        if (!ok) return;
        pop(popEl, text, color);
        ok = await tween(ctx, 750, p => {
          bails.setAttribute('transform', `translate(${(-14 * p).toFixed(1)} ${(-22 * p + 30 * p * p).toFixed(1)}) rotate(${(-360 * p).toFixed(0)} 30.5 85.5)`);
          stumps.setAttribute('transform', `rotate(${(-14 * ease(p)).toFixed(1)} 30 100)`);
          setBall(lerp(33, 22, p), lerp(93, 101, p));
        });
      } else if (k === 'wide' || k === 'bye') {
        pop(popEl, text, color);
        const endX = k === 'bye' ? -6 : 20;
        ok = await tween(ctx, 300, p => setBall(lerp(hx, endX, p), lerp(hy, 86, p)));
      } else if (k === 'dot' || (k === 'noball' && r === 0)) {
        pop(popEl, text, color);
        ok = await tween(ctx, 320, p => setBall(lerp(hx, 76, ease(p)), lerp(hy, 102, p)));
      } else {
        setFrame(batter, 'swing');
        pop(popEl, text, color);
        if (r >= 6) ok = await tween(ctx, 950, p => setBall(lerp(hx, 262, p), hy - 150 * p + 50 * p * p));
        else if (r >= 4) ok = await tween(ctx, 520, p => setBall(lerp(hx, 262, p), lerp(hy, 104, Math.min(1, p * 4))));
        else ok = await tween(ctx, 560, p => setBall(lerp(hx, 120 + 25 * r, ease(p)), lerp(hy, 126, ease(p))));
      }
      if (!ok) return;
      if (!await wait(ctx, 900)) return;
      setBall(0, 0, false);
      setFrame(batter, 'stance');
    }

    return { mount, play, reset };
  })();

  /* ===================================================================== */
  const football = (() => {
    const ctx = { token: 0 };
    const HOME = [[16, 75], [46, 42], [46, 108], [76, 60], [76, 90], [104, 75]];
    const AWAY = HOME.map(([x, y]) => [240 - x, y]);
    let svg, ballEl, popEl, players = [], goals = {}, running = false, busy = false, raf = 0;
    let ballPos = [120, 75];

    function mount(el) {
      svg = el;
      svg.setAttribute('viewBox', '0 0 240 150');
      let stripes = '';
      for (let x = 0, n = 0; x < 240; x += 20, n++) stripes += `<rect x="${x}" y="0" width="20" height="150" fill="${n % 2 ? '#3f9b46' : '#47a84e'}"/>`;
      const net = x => {
        let s = `<rect x="${x}" y="62" width="6" height="26" fill="rgba(255,255,255,.18)" stroke="#fff" stroke-width="1"/>`;
        for (let y = 66; y < 88; y += 4) s += `<rect x="${x}" y="${y}" width="6" height="1" fill="rgba(255,255,255,.4)"/>`;
        return s;
      };
      const pl = ([x, y], side) => `<g class="pl" data-x="${x}" data-y="${y}" transform="translate(${x} ${y})"><rect x="-3" y="-3" width="6" height="6" style="fill:var(--${side})" stroke="rgba(0,0,0,.45)" stroke-width=".8"/><rect x="-1" y="-1" width="2" height="2" fill="#3b2516"/></g>`;
      svg.innerHTML = `${stripes}
        <g fill="none" stroke="#fff" stroke-width="1" opacity=".85">
          <rect x="8.5" y="8.5" width="223" height="133"/>
          <line x1="120" y1="8" x2="120" y2="142"/>
          <circle cx="120" cy="75" r="18"/>
          <rect x="8.5" y="40.5" width="30" height="69"/><rect x="8.5" y="60.5" width="10" height="29"/>
          <rect x="201.5" y="40.5" width="30" height="69"/><rect x="221.5" y="60.5" width="10" height="29"/>
          <path d="M38.5 62 A14 14 0 0 1 38.5 88"/><path d="M201.5 62 A14 14 0 0 0 201.5 88"/>
        </g>
        <rect x="119" y="74" width="2" height="2" fill="#fff"/>
        <g id="fbGoalL">${net(2)}</g><g id="fbGoalR">${net(232)}</g>
        ${HOME.map(p => pl(p, 'home')).join('')}${AWAY.map(p => pl(p, 'away')).join('')}
        <rect id="fbBall" width="3" height="3" fill="#fff" stroke="#111" stroke-width=".5"/>
        <text id="fbPop" class="pop" x="120" y="40" text-anchor="middle"></text>`;
      ballEl = svg.querySelector('#fbBall');
      popEl = svg.querySelector('#fbPop');
      players = [...svg.querySelectorAll('.pl')];
      goals = { home: svg.querySelector('#fbGoalR'), away: svg.querySelector('#fbGoalL') };
      setBall(120, 75);
    }

    function setBall(x, y) { ballPos = [x, y]; ballEl.setAttribute('x', (x - 1.5).toFixed(1)); ballEl.setAttribute('y', (y - 1.5).toFixed(1)); }

    function loop(now) {
      const t = now / 1000;
      players.forEach((g, i) => {
        const x = +g.dataset.x + Math.sin(t * 0.9 + i * 1.3) * 5;
        const y = +g.dataset.y + Math.cos(t * 0.7 + i * 1.7) * 6;
        g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
      });
      if (!busy) setBall(120 + Math.sin(t * 0.6) * 45, 75 + Math.sin(t * 1.1) * 18);
      raf = running && !reduced ? requestAnimationFrame(loop) : 0;
    }

    function setRunning(on) {
      running = on;
      if (svg && on && !raf && !reduced) raf = requestAnimationFrame(loop);
    }

    function setColors(home, away) {
      if (!svg) return;
      svg.style.setProperty('--home', home);
      svg.style.setProperty('--away', away);
    }

    async function goal(side, color) {
      if (!svg) return;
      ctx.token++;
      busy = true;
      Object.values(goals).forEach(g => g.removeAttribute('transform'));
      pop(popEl, 'GOAL!', color);
      if (!reduced) {
        const [sx, sy] = ballPos;
        const tx = side === 'home' ? 236 : 4, ty = 68 + Math.random() * 14;
        if (!await tween(ctx, 550, p => setBall(lerp(sx, tx, ease(p)), lerp(sy, ty, ease(p))))) return;
        const g = goals[side];
        if (!await tween(ctx, 420, p => g.setAttribute('transform', `translate(${(Math.sin(p * 40) * (1 - p) * 1.5).toFixed(2)} 0)`))) return;
        g.removeAttribute('transform');
        if (!await wait(ctx, 1000)) return;
      }
      setBall(120, 75);
      busy = false;
    }

    function card(type, team) {
      if (!svg) return;
      pop(popEl, `${type === 'red' ? 'RED' : 'YELLOW'} CARD ${team}`, type === 'red' ? '#ff4d5e' : '#ffd31a');
    }

    return { mount, setRunning, setColors, goal, card };
  })();

  return { cricket, football };
})();
