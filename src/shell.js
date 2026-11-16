// Client Hub look: TalentCarriage logo and the sections in a left sidebar, the client and tools in a top bar, and the
// signed-in person on the right with a menu (Admin panel, Sign out). Only moves and restyles what is already on the
// page; every button keeps its own handlers. If this file fails to load, the app keeps its old layout.

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const label = t => String(t || '').replace(/^\s*\d+\s*·\s*/, '').trim();

const P = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
const svg = d => `<svg class="tc-ico" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" ${P}>${d}</svg>`;
const ICONS = {
  offer: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>'),
  journey: svg('<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/>'),
  forms: svg('<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/>'),
  ready: svg('<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>'),
  induct: svg('<path d="m3 9 9-4 9 4-9 4z"/><path d="M7 11v4c0 1.7 2.2 3 5 3s5-1.3 5-3v-4"/>'),
  config: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  hr: svg('<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-5 6-5s6 1.7 6 5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 15c2.8 0 5 1.4 5 4"/>'),
  wa: svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-5A8 8 0 1 1 21 12z"/><path d="M9 10h6M9 14h4"/>'),
  ctc: svg('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h2M12 11h2M16 11h0M8 15h2M12 15h2M8 18h2M12 18h4"/>'),
  letters: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
  exit: svg('<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="m15 8 4 4-4 4M19 12H9"/>')
};
const iconFor = key => ICONS[key] || ICONS.exit;

function decorate(btn, key) {
  if (btn.dataset.tcDone === '1') return;
  const text = label(btn.textContent);
  btn.dataset.tcDone = '1';
  btn.innerHTML = `${iconFor(key)}<span>${esc(text)}</span>`;
}

let me = null;
const initials = s => (String(s || '?').replace(/@.*/, '').split(/[.\s_-]+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('') || '?').toUpperCase();

function profile(bar) {
  if ($('#tcProf')) return;
  me = window.tcmplAccess || me;
  if (!me) return;
  const role = me.role === 'admin' ? 'Admin' : 'HR';
  const box = document.createElement('div');
  box.className = 'tc-prof-wrap';
  box.innerHTML = `<button type="button" class="tc-prof" id="tcProf" aria-haspopup="menu" aria-expanded="false">
      <span class="tc-av">${esc(initials(me.name || me.email))}</span>
      <span class="tc-who"><b>${esc(me.email || '')}</b><small>${esc(me.name ? me.name + ' · ' : '')}${role}</small></span>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" ${P}><path d="m6 9 6 6 6-6"/></svg></button>
    <div class="tc-menu" id="tcMenu" role="menu" hidden>
      <div class="tc-menu-h"><span class="tc-av big">${esc(initials(me.name || me.email))}</span><div><b>${esc(me.name || me.email)}</b><small>${esc(me.email || '')}</small><small>${role}${me.provider === 'password' ? ' · email sign-in' : me.provider ? ' · Microsoft sign-in' : ''}</small></div></div>
      ${me.role === 'admin' ? `<button type="button" role="menuitem" data-act="admin">${svg('<path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/>')}Admin · users and clients</button>` : ''}
      <button type="button" role="menuitem" data-act="out">${svg('<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="m15 8 4 4-4 4M19 12H9"/>')}Sign out</button>
    </div>`;
  bar.append(box);
  const btn = $('#tcProf'), menu = $('#tcMenu');
  const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  btn.onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute('aria-expanded', String(!menu.hidden)); };
  document.addEventListener('click', e => { if (!box.contains(e.target)) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  menu.querySelectorAll('[data-act]').forEach(b => {
    b.onclick = () => {
      close();
      if (b.dataset.act === 'admin') { const a = $('#adOpen'); if (a) a.click(); }
      if (b.dataset.act === 'out') { if (window.tcmplSignOut) window.tcmplSignOut(); else location.assign('/.auth/logout?post_logout_redirect_uri=/'); }
    };
  });
}

// The page title in the top bar: "AI Onboarding Agent › Offer desk".
function crumb() {
  const c = $('#tcCrumb');
  if (!c) return;
  const exit = document.body.classList.contains('md-exit');
  const app = (($('header .brandtxt h1') || {}).textContent || 'AI Onboarding Agent').trim();
  const sel = exit ? $('#exitApp .ex-tabs button[aria-selected="true"]') : $('.tc-side nav.tabs button[aria-selected="true"]');
  c.innerHTML = `<span role="link" tabindex="0" title="Go to the first section">${esc(app)}</span>${sel ? `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" ${P}><path d="m9 6 6 6-6 6"/></svg><b>${esc(label(sel.textContent))}</b>` : ''}`;
}

// Exit has its own section tabs inside its screen; the sidebar shows a copy that clicks the real ones.
function exitNav() {
  const mirror = $('#tcExitNav');
  if (!mirror) return;
  const real = [...document.querySelectorAll('#exitApp .ex-tabs button')];
  const sig = real.map(b => b.dataset.x + ':' + b.getAttribute('aria-selected')).join('|');
  if (mirror.dataset.sig === sig) return;
  mirror.dataset.sig = sig;
  mirror.innerHTML = real.map((b, i) => `<button type="button" role="tab" data-i="${i}" aria-selected="${b.getAttribute('aria-selected')}">${iconFor('exit')}<span>${esc(label(b.textContent))}</span></button>`).join('');
  mirror.querySelectorAll('button').forEach(m => { m.onclick = () => { const r = real[+m.dataset.i]; if (r) r.click(); closeSide(); }; });
}

const closeSide = () => document.body.classList.remove('tc-side-open');

function build() {
  const header = $('header.top'), nav = $('header nav.tabs'), logo = $('header .logo');
  if (!header || !nav || !logo || !$('header .topright')) return false;
  if ($('.tc-side')) return true;
  document.body.classList.add('tc-shell');

  const side = document.createElement('aside');
  side.className = 'tc-side';
  side.setAttribute('aria-label', 'Sections');
  side.innerHTML = `<div class="tc-side-logo"></div><div class="tc-side-mod"></div>
    <div class="tc-side-h" id="tcSideH">Onboarding</div><div class="tc-side-nav"></div>
    <nav class="tc-exit-nav" id="tcExitNav" role="tablist" aria-label="Exit sections"></nav>
    <div class="tc-side-foot">Delivered by TCMPL HR Shared Services</div>`;
  document.body.prepend(side);
  side.querySelector('.tc-side-logo').append(logo);
  side.querySelector('.tc-side-nav').append(nav);
  const sw = $('#mdSwitch');
  if (sw) side.querySelector('.tc-side-mod').append(sw);

  const top = header.querySelector('.topbar');
  const ham = document.createElement('button');
  ham.type = 'button'; ham.className = 'tc-ham'; ham.setAttribute('aria-label', 'Menu');
  ham.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" ${P}><path d="M4 7h16M4 12h16M4 17h16"/></svg>`;
  ham.onclick = () => document.body.classList.toggle('tc-side-open');
  top.prepend(ham);
  const cr = document.createElement('div');
  cr.id = 'tcCrumb'; cr.className = 'tc-crumb';
  const brand = header.querySelector('.brandtxt');
  if (brand) brand.after(cr); else top.prepend(cr);

  nav.querySelectorAll('button').forEach(b => decorate(b, b.dataset.tab));
  new MutationObserver(() => { nav.querySelectorAll('button').forEach(b => decorate(b, b.dataset.tab)); crumb(); })
    .observe(nav, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-selected'] });
  nav.addEventListener('click', () => { closeSide(); setTimeout(crumb, 0); });
  new MutationObserver(() => {
    const exit = document.body.classList.contains('md-exit');
    $('#tcSideH').textContent = exit ? 'Exit' : 'Onboarding';
    exitNav(); crumb();
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  const main = $('main.wrap');
  if (main) new MutationObserver(() => { exitNav(); crumb(); }).observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-selected', 'hidden'] });
  cr.addEventListener('click', e => {
    if (e.target.closest('span')) { const first = document.body.classList.contains('md-exit') ? $('#tcExitNav button') : nav.querySelector('button'); if (first) first.click(); }
  });
  crumb();
  return true;
}

(function start(n) {
  if (!build()) { if (n < 150) setTimeout(() => start(n + 1), 100); return; }
  (function prof(k) {
    const right = $('header .topright');
    if (window.tcmplAccess && right) { profile(right); return; }
    if (k < 150) setTimeout(() => prof(k + 1), 100);
  })(0);
  // The Exit switch is added a little after the header; move it into the sidebar when it appears.
  (function sw(k) {
    const s = $('#mdSwitch'), slot = $('.tc-side-mod');
    if (s && slot && !slot.contains(s)) slot.append(s);
    if (k < 100 && !(s && slot && slot.contains(s))) setTimeout(() => sw(k + 1), 100);
  })(0);
})(0);
