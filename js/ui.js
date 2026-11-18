'use strict';
/* Small shared helpers: DOM lookup, storage, dialogs, toasts. */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked or full */ }
  },
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** "Royal Challengers Bangalore" -> "RCB", "India" -> "IND" */
function teamCode(name) {
  const words = String(name || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'TM';
  if (words.length >= 3) return words.slice(0, 3).map(w => w[0]).join('');
  return words[0].slice(0, 3);
}

function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), ms);
}

/**
 * Show a modal form. fields: [{ name, label, type, value, options, half, hint, suggestions, required, min, max, maxLength }]
 * Resolves to an object of values, or null if cancelled.
 */
function ask(title, fields, opts = {}) {
  const dlg = $('#formDialog');
  const form = $('#formDialogForm');
  const box = $('#formFields');
  const note = $('#formNote');
  const cancelBtn = $('#formCancel');

  $('#formTitle').textContent = title;
  note.textContent = opts.note || '';
  note.hidden = !opts.note;
  $('#formOk').textContent = opts.ok || 'OK';
  cancelBtn.hidden = opts.cancel === false;
  box.innerHTML = '';
  box.hidden = !fields.length;

  fields.forEach(f => {
    const wrap = document.createElement('label');
    wrap.className = 'field' + (f.half ? ' half' : '');
    const caption = document.createElement('span');
    caption.textContent = f.label;
    wrap.appendChild(caption);

    let control;
    if (f.type === 'select') {
      control = document.createElement('select');
      f.options.forEach(o => {
        const opt = document.createElement('option');
        const v = typeof o === 'object' ? o : { value: o, label: o };
        opt.value = v.value;
        opt.textContent = v.label;
        control.appendChild(opt);
      });
    } else {
      control = document.createElement('input');
      control.type = f.type || 'text';
      control.autocomplete = 'off';
      for (const k of ['min', 'max', 'step', 'maxLength', 'placeholder']) if (f[k] != null) control[k] = f[k];
      if (f.suggestions && f.suggestions.length) {
        const list = document.createElement('datalist');
        list.id = 'dl_' + f.name;
        f.suggestions.forEach(sv => { const o = document.createElement('option'); o.value = sv; list.appendChild(o); });
        wrap.appendChild(list);
        control.setAttribute('list', list.id);
      }
    }
    control.name = f.name;
    if (f.required) control.required = true;
    if (f.value != null) control.value = f.value;
    wrap.appendChild(control);
    if (f.hint) {
      const h = document.createElement('small');
      h.textContent = f.hint;
      wrap.appendChild(h);
    }
    box.appendChild(wrap);
  });

  return new Promise(resolve => {
    let settled = false;
    const settle = value => {
      if (settled) return;
      settled = true;
      form.removeEventListener('submit', onSubmit);
      dlg.removeEventListener('cancel', onCancel);
      dlg.removeEventListener('close', onClose);
      cancelBtn.removeEventListener('click', onCancelBtn);
      if (dlg.open) dlg.close();
      resolve(value);
    };
    const onSubmit = e => {
      e.preventDefault();
      const out = {};
      fields.forEach(f => {
        const el = form.querySelector(`[name="${f.name}"]`);
        out[f.name] = f.type === 'number' ? Number(el.value) : el.value.trim();
      });
      settle(out);
    };
    const onCancel = e => { if (opts.cancel === false) e.preventDefault(); };
    const onCancelBtn = () => settle(null);
    // 'close' fires asynchronously; if another ask() has already reopened the dialog, ignore it.
    const onClose = () => { if (!dlg.open) settle(null); };

    form.addEventListener('submit', onSubmit);
    dlg.addEventListener('cancel', onCancel);
    dlg.addEventListener('close', onClose);
    cancelBtn.addEventListener('click', onCancelBtn);

    dlg.showModal();
    const first = box.querySelector('input, select');
    if (first) { first.focus(); if (first.select) first.select(); }
    else $('#formOk').focus();
  });
}

const confirmBox = (title, note, ok = 'Yes') => ask(title, [], { note, ok }).then(r => r !== null);
