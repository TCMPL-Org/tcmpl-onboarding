// Modules: the Onboarding | Exit switch in the header, the "Modules" card in Client setup and the #exitRoot area.
// Onboarding screens are only hidden while Exit is shown (CSS on body.md-exit); nothing in them changes.
// The Exit screens (src/exit/exit-app.js) are loaded only when Exit is chosen and the client has Exit switched on.

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const KEY = 'tcmpl.module';
const clientId = () => (window.tcmplClientId ? window.tcmplClientId() : 'default');
const clientLabel = () => (window.tcmplClientLabel ? window.tcmplClientLabel() : clientId());
let mode = 'onboarding', mods = { onboarding: true, exit: false }, exitApp = null, brand = null;

async function post(path, body) {
  try {
    const res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body || {}) });
    const data = (res.headers.get('content-type') || '').includes('application/json') ? await res.json().catch(() => null) : null;
    return { ok: res.ok, status: res.status, body: data };
  } catch { return { ok: false, status: 0, body: null }; }
}

function style() {
  if ($('#mdStyle')) return;
  const st = document.createElement('style');
  st.id = 'mdStyle';
  st.textContent = `.md-switch{display:inline-flex;border:1px solid var(--line);border-radius:999px;overflow:hidden;margin-right:6px}
.md-switch button{border:0;background:none;padding:5px 12px;font-weight:600;color:var(--muted);cursor:pointer}
.md-switch button[aria-pressed=true]{background:var(--teal);color:#fff}
body.md-exit header nav.tabs,body.md-exit main.wrap>section.tab{display:none!important}
body:not(.md-exit) #exitRoot{display:none}
body.md-onb-off:not(.md-exit) header nav.tabs,body.md-onb-off:not(.md-exit) main.wrap>section.tab:not(#tab-config){display:none!important}
body:not(.md-onb-off) #onbOff,body.md-exit #onbOff{display:none}
#exitRoot{padding-top:12px}`;
  document.head.append(st);
}

async function loadMods() {
  const r = await post('/api/modules/get', { client: clientId() });
  mods = r.ok && r.body && r.body.modules ? r.body.modules : { onboarding: true, exit: false };
  renderCard();
  // Onboarding switched off for this client: its screens are hidden (Client setup stays reachable for admins).
  document.body.classList.toggle('md-onb-off', mods.onboarding === false);
  const o = $('#onbOff');
  if (o) o.innerHTML = mods.onboarding === false ? `<div class="card" style="max-width:640px"><h3 style="margin:0 0 6px">Onboarding is off for ${esc(clientLabel())}</h3>
    <p class="note" style="margin:0">Nothing is shown or sent for onboarding until an admin switches it on (Admin → Clients and modules).${mods.exit ? ' Exit is on: use the Exit switch at the top.' : ''}</p></div>` : '';
  return mods;
}

function renderCard() {
  const c = $('#mdCard'); if (!c) return;
  $('#mdClient').textContent = clientLabel();
  $('#mdExit').checked = Boolean(mods.exit);
  const on = $('#mdOnb'); if (on) on.checked = mods.onboarding !== false;
  const admin = isAdmin();
  ['#mdExit', '#mdOnb'].forEach(q => { const el = $(q); if (el) el.disabled = !admin; });
  const n = $('#mdAdminNote'); if (n) n.hidden = admin;
}
const isAdmin = () => !window.tcmplAccess || window.tcmplAccess.role === 'admin';

async function saveMods(patch) {
  const r = await post('/api/modules/save', Object.assign({ client: clientId() }, patch));
  if (r.ok && r.body && r.body.modules) mods = r.body.modules;
  await loadMods();
  const s = $('#mdState'); if (s) s.textContent = r.ok ? `Saved · Onboarding ${mods.onboarding !== false ? 'on' : 'off'}, Exit ${mods.exit ? 'on' : 'off'} for ${clientLabel()}` : (r.status === 403 ? 'Only admins can change modules.' : 'Not saved.');
  return r.ok;
}
const saveExit = on => saveMods({ exit: on });
window.tcmplModules = { reload: () => loadMods(), save: saveMods };

function setBrand(exit) {
  const h = $('header .brandtxt h1'), sp = $('header .brandtxt span');
  if (!h || !sp) return;
  if (!brand) brand = { h: h.textContent, s: sp.textContent };
  h.textContent = exit ? 'AI Exit Agent' : brand.h;
  sp.textContent = exit ? 'Resignation to alumni, on WhatsApp and email · delivered by TCMPL HR Shared Services' : brand.s;
  document.title = exit ? 'TCMPL AI Exit Agent' : document.title.replace('TCMPL AI Exit Agent', 'TCMPL AI Onboarding Agent');
}

async function setMode(m) {
  mode = m === 'exit' ? 'exit' : 'onboarding';
  try { localStorage.setItem(KEY, mode); } catch { /* storage not available */ }
  document.body.classList.toggle('md-exit', mode === 'exit');
  document.querySelectorAll('#mdSwitch button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.m === mode)));
  setBrand(mode === 'exit');
  if (mode === 'exit') await showExit();
}

async function showExit() {
  await loadMods();
  const off = $('#exitOff'), area = $('#exitApp');
  if (!mods.exit) {
    area.hidden = true; off.hidden = false;
    off.innerHTML = `<div class="card" style="max-width:640px"><h3 style="margin:0 0 6px">Exit is off for ${esc(clientLabel())}</h3>
      <p class="note" style="margin:0 0 12px">Nothing is shown or sent for exits until Exit is switched on for this client. You can also do this in Onboarding → Client setup → Modules.</p>
      <button class="btn primary small" id="mdTurnOn" type="button">Switch Exit on for ${esc(clientLabel())}</button></div>`;
    if (!isAdmin()) $('#mdTurnOn').hidden = true;
    $('#mdTurnOn').onclick = async () => { if (await saveExit(true)) showExit(); };
    return;
  }
  off.hidden = true; area.hidden = false;
  try {
    if (!exitApp) { exitApp = await import('./exit/exit-app.js'); exitApp.mount(area, { clientId, clientLabel }); }
    else exitApp.refresh();
  } catch (e) {
    area.innerHTML = `<div class="card">The Exit screens could not be loaded (${esc(e && e.message)}). Press Ctrl + Shift + R to reload.</div>`;
  }
}

function mount() {
  const right = $('header .topright'), main = $('main.wrap'), cfg = $('#tab-config');
  if (!right || !main || !cfg) return false;
  if ($('#mdSwitch')) return true;
  style();
  const sw = document.createElement('div');
  sw.id = 'mdSwitch'; sw.className = 'md-switch'; sw.setAttribute('role', 'group'); sw.setAttribute('aria-label', 'Module');
  sw.innerHTML = '<button type="button" data-m="onboarding" aria-pressed="true">Onboarding</button><button type="button" data-m="exit" aria-pressed="false">Exit</button>';
  right.prepend(sw);
  sw.querySelectorAll('button').forEach(b => { b.onclick = () => setMode(b.dataset.m); });

  const root = document.createElement('section');
  root.id = 'exitRoot';
  root.innerHTML = '<div id="exitOff" hidden></div><div id="exitApp" hidden></div>';
  main.prepend(root);
  const off = document.createElement('section');
  off.id = 'onbOff';
  main.prepend(off);

  const card = document.createElement('div');
  card.id = 'mdCard'; card.className = 'card'; card.style.marginBottom = '16px';
  card.innerHTML = `<h3 style="margin:0 0 4px">Modules · <span id="mdClient"></span></h3>
    <p class="note" style="margin:0 0 10px">Which agents run for this client. A module that is off is hidden for the client and sends nothing.</p>
    <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="mdOnb"> Onboarding (offer to Day 90)</label>
    <label style="display:flex;gap:6px;align-items:center;margin-top:4px"><input type="checkbox" id="mdExit"> Exit (resignation to alumni)</label>
    <p class="note" id="mdAdminNote" hidden style="margin:6px 0 0">Only admins can change modules.</p>
    <p class="note" id="mdState" style="margin:6px 0 0"></p>`;
  const intro = cfg.querySelector('.intro');
  if (intro) intro.after(card); else cfg.prepend(card);
  $('#mdExit').onchange = e => saveExit(e.target.checked);
  $('#mdOnb').onchange = e => saveMods({ onboarding: e.target.checked });

  const sel = $('#clientSel');
  if (sel) sel.addEventListener('change', () => setTimeout(() => { loadMods(); if (mode === 'exit') showExit(); }, 80));
  document.querySelectorAll('header nav.tabs button').forEach(b => b.addEventListener('click', () => { if (b.dataset.tab === 'config') loadMods(); }));

  let saved = 'onboarding';
  try { saved = localStorage.getItem(KEY) || 'onboarding'; } catch { /* storage not available */ }
  loadMods();
  if (saved === 'exit') setMode('exit');
  return true;
}

(function waitForApp(n) {
  if (window.tcmplClientId && mount()) return;
  if (n > 100) return;
  setTimeout(() => waitForApp(n + 1), 100);
})(0);
