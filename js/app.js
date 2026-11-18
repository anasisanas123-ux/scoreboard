'use strict';
/* Wires the sports, the LED panel, the display connection dialog and keyboard shortcuts together. */
(() => {
  let sport = store.get('sb.sport', 'cricket');
  const active = () => (sport === 'cricket' ? Cricket : Football);

  function pushDisplay() {
    const t = active().ledTexts();
    Display.setLive(t.candidates, t.ticker);
  }

  const touched = () => store.set('sb.savedAt', Date.now());

  function setSport(sp, fromServer) {
    sport = sp === 'football' ? 'football' : 'cricket';
    store.set('sb.sport', sport);  // the big screen follows the selected sport
    if (!fromServer) touched();
    $$('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.sport === sport)));
    $('#view-cricket').hidden = sport !== 'cricket';
    $('#view-football').hidden = sport !== 'football';
    pushDisplay();
    Sync.push();
  }

  /* ---------- sharing the scoreboard ---------- */
  const phoneBtn = $('#phoneBtn');
  Sync.onStatus((ok, why) => {
    phoneBtn.classList.toggle('on', ok);
    phoneBtn.classList.toggle('busy', !ok);
    $('#phoneText').textContent = ok ? 'Share · live' : 'Share · not saving';
    if (!ok && why) toast(why, 6000);
  });
  phoneBtn.addEventListener('click', async () => {
    if (!Sync.enabled) {
      await ask('Share the scoreboard', [], {
        ok: 'Got it', cancel: false,
        note: 'You opened this page as a file, so other devices can\'t see it.\n\n1. Double-click start-server.bat in the project folder.\n2. Score from http://localhost:8765/admin\n3. The server window shows the address for phones.',
      });
      return;
    }
    const inf = await Sync.info();  // only the local server answers this
    const lines = inf
      ? (inf.addresses.length
        ? inf.addresses.map(ip => `http://${ip}:${inf.port}/`).join('\n') + '\n\nPhones must be on the same Wi-Fi as this computer.'
        : 'This computer has no Wi-Fi/LAN address. Connect it to the same network as your phone.')
      : `${location.origin}/\n\nAnyone with this link can watch. Only admins can score.`;
    await ask('Share the scoreboard', [], { ok: 'Close', cancel: false, note: `Open this address on a phone, tablet or TV:\n\n${lines}` });
  });

  const onSportChange = name => ev => {
    if (ev) {
      // Tell the big screens (same browser via storage, other devices via the server) what just happened.
      store.set('sb.event', { sport: name, kind: ev.kind, runs: ev.runs, extra: ev.extra, side: ev.side, type: ev.type, flash: ev.flash, t: Date.now() });
      touched();
    }
    if (sport === name) {
      pushDisplay();
      if (ev && ev.flash) Display.flash(ev.flash);
    }
    Sync.push();
  };
  Cricket.onChange(onSportChange('cricket'));
  Football.onChange(onSportChange('football'));

  $$('.tab').forEach(t => t.addEventListener('click', () => setSport(t.dataset.sport)));

  /* ---------- LED panel ---------- */
  Display.mount($('#ledCanvas'));
  const cfg = Display.config();
  const showInfo = () => { const c = Display.config(); $('#ledInfo').textContent = `${c.modules} × MAX7219 (${c.modules * 8}×8)`; };
  showInfo();
  $('#ledMode').value = cfg.mode;
  $('#ledFlash').checked = cfg.flash;
  $('#ledMode').addEventListener('change', e => { Display.setConfig({ mode: e.target.value }); Sync.push(); });
  $('#ledFlash').addEventListener('change', e => Display.setConfig({ flash: e.target.checked }));
  $('#ledMsgForm').addEventListener('submit', e => {
    e.preventDefault();
    const v = $('#ledMsg').value.trim();
    if (!v) return;
    Display.setOverride(v);
    $('#ledLive').hidden = false;
    Sync.push();
  });
  $('#ledLive').addEventListener('click', () => {
    Display.setOverride(null);
    $('#ledLive').hidden = true;
    $('#ledMsg').value = '';
    Sync.push();
  });

  /* ---------- connection dialog ---------- */
  const dlg = $('#displayDialog');
  function openDisplayDialog() {
    const c = Display.config();
    $('#dHost').value = c.host;
    $('#dModules').value = c.modules;
    $('#dBright').value = c.brightness;
    $('#dBrightOut').textContent = c.brightness;
    $('#dSpeed').value = c.speed;
    $('#dSpeedOut').textContent = c.speed;
    dlg.showModal();
  }
  $('#connPill').addEventListener('click', openDisplayDialog);
  $('#ledSetup').addEventListener('click', openDisplayDialog);

  let wifiState = 'off', usbOn = false;
  $('#dWifi').addEventListener('click', () => {
    if (wifiState !== 'off') { Display.disconnectWifi(); return; }
    const host = $('#dHost').value.trim();
    if (!host) { $('#dHost').focus(); return; }
    Display.connectWifi(host);
  });
  $('#dHost').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#dWifi').click(); } });
  $('#dUsb').addEventListener('click', async () => {
    if (usbOn) { Display.disconnectSerial(); return; }
    try { await Display.connectSerial(); } catch (err) {
      if (err && err.name !== 'NotFoundError') toast(err.message || 'Could not open the USB port');
    }
  });
  $('#dModules').addEventListener('change', e => { Display.setConfig({ modules: clamp(Math.round(Number(e.target.value)), 1, 32) }); showInfo(); });
  $('#dBright').addEventListener('input', e => { $('#dBrightOut').textContent = e.target.value; Display.setConfig({ brightness: Number(e.target.value) }); Sync.push(); });
  $('#dSpeed').addEventListener('input', e => { $('#dSpeedOut').textContent = e.target.value; Display.setConfig({ speed: Number(e.target.value) }); Sync.push(); });

  Display.onStatus(st => {
    wifiState = st.wifi;
    usbOn = st.usb;
    const pill = $('#connPill');
    const on = st.wifi === 'on' || st.usb;
    pill.classList.toggle('on', on);
    pill.classList.toggle('busy', !on && st.wifi === 'connecting');
    $('#connText').textContent = on
      ? `LED · ${[st.wifi === 'on' && 'Wi-Fi', st.usb && 'USB'].filter(Boolean).join(' + ')}`
      : st.wifi === 'connecting' ? 'LED · connecting…' : 'LED offline';
    $('#dWifi').textContent = st.wifi === 'off' ? 'Connect' : 'Disconnect';
    $('#dWifi').classList.toggle('primary', st.wifi === 'off');
    $('#dWifiState').textContent = st.wifi === 'on' ? `Connected to ${st.host}`
      : st.wifi === 'connecting' ? `Trying ${st.host}… (retries every 3 s)`
      : location.protocol === 'https:'
        ? 'Direct Wi-Fi only works from the local server (start-server.bat), because browsers block it on https sites. Here, use USB, or let the ESP32 read the score from this site (see README).'
        : 'The board scrolls its IP address when it powers on.';
    $('#dUsb').textContent = st.usb ? 'Disconnect USB' : 'Connect USB';
    $('#dUsbState').textContent = st.usb ? 'Connected' : ('serial' in navigator ? '' : 'Not supported in this browser');
  });

  /* ---------- keyboard shortcuts ---------- */
  document.addEventListener('keydown', e => {
    if (document.querySelector('dialog[open]')) return;
    const target = e.target instanceof Element ? e.target : null;
    if (target && target.closest('input, select, textarea')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); active().undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if ((e.key === ' ' || e.key === 'Enter') && target && target.closest('button')) return;
    if (active().key(e.key)) e.preventDefault();
  });

  /* ---------- admin login ---------- */
  const loginDlg = $('#loginDialog');
  loginDlg.addEventListener('cancel', e => e.preventDefault());

  // Shows the sign-in box and resolves once the admin is signed in.
  function requireLogin(me) {
    const err = $('#loginError');
    const btn = $('#loginSubmit');
    const notSet = me && me.configured === false;
    err.hidden = !notSet;
    err.textContent = notSet ? 'No admin password is set on the server yet. In Vercel: Settings > Environment Variables > add ADMIN_PASSWORD, then redeploy.' : '';
    btn.disabled = notSet;
    if (!loginDlg.open) loginDlg.showModal();
    $('#loginUser').focus();
    return new Promise(resolve => {
      $('#loginForm').onsubmit = async e => {
        e.preventDefault();
        btn.disabled = true;
        err.hidden = true;
        let r;
        try { r = await Sync.login($('#loginUser').value.trim(), $('#loginPass').value); } catch { r = { ok: false, body: { error: 'Can\'t reach the server' } }; }
        btn.disabled = false;
        if (!r.ok) {
          err.textContent = r.body.error || 'Sign-in failed';
          err.hidden = false;
          $('#loginPass').select();
          return;
        }
        $('#loginPass').value = '';
        loginDlg.close();
        showAccount(r.body.user);
        resolve();
      };
    });
  }

  function showAccount(name) {
    const btn = $('#accountBtn');
    btn.hidden = !name;
    $('#accountText').textContent = name ? `${name} · Sign out` : '';
  }
  $('#accountBtn').addEventListener('click', async () => {
    if (!await confirmBox('Sign out?', 'Scoring will stop until someone signs in again.', 'Sign out')) return;
    await Sync.logout().catch(() => {});
    location.reload();
  });

  // Load the match the server already has (e.g. scored on another device), unless this device has newer changes.
  async function hydrate() {
    const remote = await Sync.state().catch(() => null);
    if (!remote || !remote.savedAt || remote.savedAt < store.get('sb.savedAt', 0)) return;
    if (remote.cricket) store.set('sb.cricket.v1', remote.cricket);
    if (remote.football) store.set('sb.football.v1', remote.football);
    store.set('sb.savedAt', remote.savedAt);
    Cricket.reload();
    Football.reload();
    setSport(remote.sport, true);
  }

  async function boot() {
    if (!Sync.enabled) return;  // opened as a file: everything stays in this browser
    let me;
    try { me = await Sync.me(); } catch { toast('Can\'t reach the server. Scores are kept on this device for now.', 6000); return; }
    if (me.storage === false) toast('The server has no storage connected yet, so scores can\'t be shared. See README.', 8000);
    if (me.authRequired && !me.admin) await requireLogin(me);
    else if (me.authRequired) showAccount(me.user);
    Sync.onAuth(() => requireLogin({ configured: true }));  // session expired mid-match
    await hydrate();
    Sync.start();
  }

  Cricket.init();
  Football.init();
  setSport(sport, true);
  boot();
})();
