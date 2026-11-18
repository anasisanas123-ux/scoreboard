'use strict';
/*
 * LED matrix output: an on-screen preview of the MAX7219 display, plus the link to the
 * ESP32/ESP8266 over Wi-Fi (WebSocket, port 81) or a USB cable (Web Serial, 115200 baud).
 *
 * Line protocol (one message per line), understood by firmware/scoreboard_esp:
 *   T|text   static, centred          S|text   scrolling, repeats
 *   FT|text  flash static ~2.5 s      FS|text  flash scroll once, then back to the score
 *   B|0-15   brightness               V|ms     scroll speed, ms per column
 */
const Display = (() => {
  // 5x7 column font (bit 0 = top row), close to the MD_Parola default font.
  const FONT = {
    ' ': [0, 0], '!': [0x5F], "'": [0x03], '(': [0x1C, 0x22, 0x41], ')': [0x41, 0x22, 0x1C],
    '*': [0x14, 0x08, 0x3E, 0x08, 0x14], '+': [0x08, 0x08, 0x3E, 0x08, 0x08], ',': [0x50, 0x30],
    '-': [0x08, 0x08, 0x08], '.': [0x40], '/': [0x20, 0x10, 0x08, 0x04, 0x02], ':': [0x14],
    '=': [0x14, 0x14, 0x14, 0x14], '?': [0x02, 0x01, 0x51, 0x09, 0x06], '%': [0x23, 0x13, 0x08, 0x64, 0x62], '|': [0x7F],
    0: [0x3E, 0x51, 0x49, 0x45, 0x3E], 1: [0x42, 0x7F, 0x40], 2: [0x42, 0x61, 0x51, 0x49, 0x46],
    3: [0x21, 0x41, 0x45, 0x4B, 0x31], 4: [0x18, 0x14, 0x12, 0x7F, 0x10], 5: [0x27, 0x45, 0x45, 0x45, 0x39],
    6: [0x3C, 0x4A, 0x49, 0x49, 0x30], 7: [0x01, 0x71, 0x09, 0x05, 0x03], 8: [0x36, 0x49, 0x49, 0x49, 0x36],
    9: [0x06, 0x49, 0x49, 0x29, 0x1E],
    A: [0x7E, 0x11, 0x11, 0x11, 0x7E], B: [0x7F, 0x49, 0x49, 0x49, 0x36], C: [0x3E, 0x41, 0x41, 0x41, 0x22],
    D: [0x7F, 0x41, 0x41, 0x22, 0x1C], E: [0x7F, 0x49, 0x49, 0x49, 0x41], F: [0x7F, 0x09, 0x09, 0x09, 0x01],
    G: [0x3E, 0x41, 0x49, 0x49, 0x7A], H: [0x7F, 0x08, 0x08, 0x08, 0x7F], I: [0x41, 0x7F, 0x41],
    J: [0x20, 0x40, 0x41, 0x3F, 0x01], K: [0x7F, 0x08, 0x14, 0x22, 0x41], L: [0x7F, 0x40, 0x40, 0x40, 0x40],
    M: [0x7F, 0x02, 0x0C, 0x02, 0x7F], N: [0x7F, 0x04, 0x08, 0x10, 0x7F], O: [0x3E, 0x41, 0x41, 0x41, 0x3E],
    P: [0x7F, 0x09, 0x09, 0x09, 0x06], Q: [0x3E, 0x41, 0x51, 0x21, 0x5E], R: [0x7F, 0x09, 0x19, 0x29, 0x46],
    S: [0x46, 0x49, 0x49, 0x49, 0x31], T: [0x01, 0x01, 0x7F, 0x01, 0x01], U: [0x3F, 0x40, 0x40, 0x40, 0x3F],
    V: [0x1F, 0x20, 0x40, 0x20, 0x1F], W: [0x3F, 0x40, 0x38, 0x40, 0x3F], X: [0x63, 0x14, 0x08, 0x14, 0x63],
    Y: [0x07, 0x08, 0x70, 0x08, 0x07], Z: [0x61, 0x51, 0x49, 0x45, 0x43],
  };
  const ALLOWED = /[^A-Z0-9 !'()*+,\-./:=?%|]/g;
  const KEY = 'sb.display.v1';

  const cfg = Object.assign({ modules: 8, brightness: 6, speed: 35, host: '', mode: 'auto', flash: true }, store.get(KEY, {}));
  const saveCfg = () => store.set(KEY, cfg);
  const width = () => cfg.modules * 8;

  const clean = t => String(t || '').toUpperCase().replace(/[’‘]/g, "'").replace(/[–—]/g, '-').replace(ALLOWED, '').replace(/\s+/g, ' ').trim().slice(0, 150);

  function columns(text) {
    const out = [];
    [...text].forEach((ch, i) => {
      if (i) out.push(0);
      out.push(...(FONT[ch] || FONT['?']));
    });
    return out;
  }
  const view = text => {
    const t = clean(text);
    const cols = columns(t);
    return { text: t, cols, scroll: cols.length > width(), start: performance.now() };
  };

  // ---------- what is shown ----------
  let live = { candidates: ['READY'], ticker: 'READY' };
  let override = null;
  let mainView = view('READY');
  let flashView = null;
  let lastLine = '';

  function pickLive() {
    if (cfg.mode === 'ticker') return view(live.ticker);
    const list = live.candidates.map(clean).filter(Boolean);
    for (const t of list) if (columns(t).length <= width()) return view(t);
    return view(list[list.length - 1] || '');
  }

  function refresh(force) {
    const v = override != null ? view(override) : pickLive();
    if (v.text !== mainView.text || v.scroll !== mainView.scroll) mainView = v;
    const line = (v.scroll ? 'S|' : 'T|') + v.text;
    if (force || line !== lastLine) { lastLine = line; write(line); }
  }

  function setLive(candidates, ticker) { live = { candidates, ticker }; refresh(); }
  function setOverride(text) { override = text ? text : null; refresh(); }
  let lastFlash = null;
  function flash(text) {
    if (!cfg.flash || !text) return;
    flashView = view(text);
    lastFlash = { line: (flashView.scroll ? 'FS|' : 'FT|') + flashView.text, t: Date.now() };
    write(lastFlash.line);
  }

  // ---------- preview canvas ----------
  let canvas, ctx, lastKey = '';

  function mount(el) {
    canvas = el;
    ctx = canvas.getContext('2d');
    new ResizeObserver(resize).observe(canvas.parentElement);
    resize();
    requestAnimationFrame(frame);
  }

  function resize() {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.parentElement.clientWidth - 20;
    canvas.width = Math.max(64, Math.round(cssW * dpr));
    canvas.height = Math.round(canvas.width / width() * 8);
    lastKey = '';
  }

  function frame(now) {
    let v = mainView;
    if (flashView) {
      const t = now - flashView.start;
      const done = flashView.scroll ? t / cfg.speed >= width() + flashView.cols.length : t > 2500;
      if (done) { flashView = null; mainView.start = now; } else v = flashView;
    }
    const W = width();
    let x0;
    if (v.scroll) {
      const total = W + v.cols.length;
      x0 = W - (Math.floor((now - v.start) / cfg.speed) % total);
    } else {
      x0 = Math.floor((W - v.cols.length) / 2);
    }
    const key = `${v.text}|${x0}|${W}|${canvas.width}`;
    if (key !== lastKey) { lastKey = key; draw(v.cols, x0, W); }
    requestAnimationFrame(frame);
  }

  function draw(cols, x0, W) {
    const p = canvas.width / W;
    const r = p * 0.36;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // module separators
    ctx.fillStyle = '#140808';
    for (let m = 0; m < cfg.modules; m++) ctx.fillRect(m * 8 * p + 1, 0, 8 * p - 2, canvas.height);
    const off = new Path2D(), on = new Path2D();
    for (let x = 0; x < W; x++) {
      const c = cols[x - x0] || 0;
      for (let y = 0; y < 8; y++) {
        const path = (c >> y) & 1 ? on : off;
        const cx = x * p + p / 2, cy = y * p + p / 2;
        path.moveTo(cx + r, cy);
        path.arc(cx, cy, r, 0, Math.PI * 2);
      }
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#3a110d';
    ctx.fill(off);
    ctx.shadowColor = '#ff3b30';
    ctx.shadowBlur = p * 0.7;
    ctx.fillStyle = '#ff4a36';
    ctx.fill(on);
    ctx.shadowBlur = 0;
  }

  // ---------- transports ----------
  let ws = null, wsState = 'off', wsWanted = false, wsTimer = 0;
  let port = null, writer = null;
  const listeners = [];
  const enc = new TextEncoder();
  const status = () => ({ wifi: wsState, usb: !!writer, host: cfg.host });
  const emit = () => listeners.forEach(cb => cb(status()));

  function write(line) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(line);
    if (writer) writer.write(enc.encode(line + '\n')).catch(() => dropSerial());
  }

  function resendAll() {
    write('B|' + cfg.brightness);
    write('V|' + cfg.speed);
    refresh(true);
  }

  function connectWifi(host) {
    cfg.host = host.trim();
    saveCfg();
    wsWanted = true;
    openWs();
  }

  function openWs() {
    clearTimeout(wsTimer);
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
    if (!cfg.host) return;
    const url = /^wss?:\/\//.test(cfg.host) ? cfg.host : `ws://${cfg.host}:81/`;
    try { ws = new WebSocket(url); } catch { wsState = 'off'; emit(); return; }
    wsState = 'connecting';
    emit();
    ws.onopen = () => { wsState = 'on'; emit(); resendAll(); };
    ws.onclose = () => {
      ws = null;
      wsState = wsWanted ? 'connecting' : 'off';
      emit();
      if (wsWanted) wsTimer = setTimeout(openWs, 3000);
    };
  }

  function disconnectWifi() {
    wsWanted = false;
    clearTimeout(wsTimer);
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
    wsState = 'off';
    emit();
  }

  async function connectSerial() {
    if (!('serial' in navigator)) throw new Error('USB needs Chrome or Edge on a desktop computer.');
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    writer = port.writable.getWriter();
    emit();
    // Opening the port usually resets the ESP, so send everything again once it has booted.
    setTimeout(resendAll, 2500);
  }

  async function dropSerial() {
    const w = writer, p = port;
    writer = null; port = null;
    emit();
    try { if (w) { await w.close().catch(() => {}); w.releaseLock(); } } catch { /* already gone */ }
    try { if (p) await p.close(); } catch { /* already closed */ }
  }

  if ('serial' in navigator) navigator.serial.addEventListener('disconnect', e => { if (e.target === port) dropSerial(); });

  function setConfig(patch) {
    Object.assign(cfg, patch);
    saveCfg();
    if ('brightness' in patch) write('B|' + cfg.brightness);
    if ('speed' in patch) write('V|' + cfg.speed);
    if ('modules' in patch) { resize(); mainView = view(''); }
    if ('modules' in patch || 'mode' in patch) refresh();
  }

  // Auto-reconnect to the last board on page load.
  if (cfg.host) { wsWanted = true; setTimeout(openWs, 300); }

  return {
    mount, setLive, setOverride, flash, setConfig,
    config: () => ({ ...cfg }),
    // What the matrix should show right now, for an ESP32 that polls the server (/api/led).
    snapshot: () => ({ line: lastLine || 'T|READY', flash: lastFlash, brightness: cfg.brightness, speed: cfg.speed }),
    connectWifi, disconnectWifi, connectSerial, disconnectSerial: dropSerial,
    onStatus: cb => { listeners.push(cb); cb(status()); },
  };
})();
