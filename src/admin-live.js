// Sign-in check, the signed-in user in the header, and the Admin panel (users, clients, modules per client).
// Every API call is also checked on the server (api/src/lib/access.js); this file only shapes the screen.

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function post(path, body) {
  try {
    const res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body || {}) });
    const data = (res.headers.get('content-type') || '').includes('application/json') ? await res.json().catch(() => null) : null;
    return { ok: res.ok, status: res.status, body: data };
  } catch { return { ok: false, status: 0, body: null }; }
}
async function getJson(path) {
  try {
    const res = await fetch(path, { credentials: 'same-origin', headers: { accept: 'application/json' } });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
  } catch { return { ok: false, status: 0, body: null }; }
}
const toast = m => (window.tcmplWAUtil && window.tcmplWAUtil.toast ? window.tcmplWAUtil.toast(m) : console.log(m));
const ERR = { valid_email_required: 'Please enter a valid email address.', cannot_remove_yourself: 'You cannot remove yourself.', cannot_remove_own_admin: 'You cannot take away your own admin access.', admin_only: 'Only admins can do this.' };
const explain = r => ERR[r.body && r.body.error] || (r.body && (r.body.detail || r.body.error)) || 'Something went wrong (' + r.status + ').';

let me = null, users = [], modsAll = {}, tab = 'users';
const clients = () => (window.tcmplClients ? window.tcmplClients() : []).filter(c => c.id !== 'default');
const roleLabel = r => (r === 'admin' ? 'Admin' : 'HR');

function style() {
  if ($('#adStyle')) return;
  const st = document.createElement('style');
  st.id = 'adStyle';
  st.textContent = `#adGate{position:fixed;inset:0;z-index:9999;background:#f4f7f9;display:flex;align-items:center;justify-content:center;padding:20px}
#adGate .card{max-width:520px}
.ad-me{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted,#567);margin-left:6px}
.ad-me b{color:var(--ink,#123)}
#adBanner{background:#fff4e5;border:1px solid #f0c27b;color:#7a4a00;padding:8px 14px;font-size:13px;border-radius:8px;margin:10px auto;max-width:1200px}
#adPanel{position:fixed;inset:0;z-index:9000;background:rgba(10,30,40,.35);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:40px 16px}
#adPanel .ad-box{background:#fff;border-radius:12px;max-width:1100px;width:100%;padding:18px 20px;box-shadow:0 10px 40px rgba(0,0,0,.2)}
#adPanel table{width:100%;border-collapse:collapse;font-size:13px}
#adPanel th,#adPanel td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line,#e3e8ec);vertical-align:top}
#adPanel th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted,#567)}
.ad-tabs{display:flex;gap:6px;margin:8px 0 14px}
.ad-clients{display:flex;flex-wrap:wrap;gap:4px 12px;max-height:150px;overflow:auto;padding:6px;border:1px solid var(--line,#e3e8ec);border-radius:8px}
.ad-clients label{display:inline-flex;gap:4px;align-items:center;font-size:12px}
.ad-form{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px 12px;margin:10px 0}
.ad-form label{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--muted,#567)}
.ad-tag{display:inline-block;font-size:11px;padding:1px 7px;border-radius:999px;background:#eef3f6;margin:1px 3px 1px 0}
.ad-off{opacity:.55}`;
  document.head.append(st);
}

/* ---------- gate: who is signed in ---------- */
function gate(r) {
  style();
  const who = esc(r.email || 'this account');
  const g = document.createElement('div');
  g.id = 'adGate';
  g.innerHTML = `<div class="card"><h2 style="margin:0 0 8px">No access yet</h2>
    <p>You are signed in as <b>${who}</b>, but this account is not on the user list of the TCMPL AI Onboarding Agent.</p>
    <p class="note">Ask your admin to add <b>${who}</b> in Admin → Users. If you used the wrong Microsoft account, sign out and sign in with your work account.</p>
    <div class="row" style="margin-top:12px"><a class="btn primary small" href="/.auth/logout?post_logout_redirect_uri=/">Sign out</a><button class="btn small" type="button" id="adRetry">Try again</button></div></div>`;
  document.body.append(g);
  $('#adRetry').onclick = () => location.reload();
}

function header() {
  const right = $('header .topright');
  if (!right || $('#adMe')) return;
  const box = document.createElement('span');
  box.id = 'adMe'; box.className = 'ad-me';
  box.innerHTML = `<b>${esc(me.name || me.email)}</b> · ${roleLabel(me.role)}${me.role === 'admin' ? ' <button class="btn small primary" id="adOpen" type="button">Admin</button>' : ''} <a class="btn small" href="/.auth/logout?post_logout_redirect_uri=/" title="Sign out">Sign out</a>`;
  right.append(box);
  if ($('#adOpen')) $('#adOpen').onclick = () => open('users');
  const add = $('#hdrAddClient');
  if (add && me.role !== 'admin') add.hidden = true;
  if (me.setupMode) {
    const b = document.createElement('div');
    b.id = 'adBanner';
    b.innerHTML = '<b>Security setup needed:</b> right now anyone who signs in with a Microsoft account can use this app. Add your email as <code>ADMIN_EMAILS</code> in Azure (Static Web App → Environment variables), then add your team in Admin → Users.';
    const main = $('main.wrap'); if (main) main.before(b);
  }
}

// HR users limited to some clients: only their clients stay in the client dropdown.
function limitClients() {
  if (!me || me.role === 'admin' || (me.clients || []).includes('*')) return;
  const sel = $('#clientSel'); if (!sel) return;
  const allowed = new Set(['default'].concat(me.clients || []));
  const prune = () => {
    let moved = false;
    [...sel.options].forEach(o => { if (!allowed.has(o.value)) { if (sel.value === o.value) moved = true; o.remove(); } });
    if (moved || !allowed.has(sel.value)) {
      const first = [...sel.options].find(o => o.value !== 'default') || sel.options[0];
      if (first) { sel.value = first.value; sel.dispatchEvent(new Event('change')); }
    }
  };
  prune();
  new MutationObserver(prune).observe(sel, { childList: true });
}

/* ---------- Admin panel ---------- */
async function open(t) {
  tab = t || tab;
  let p = $('#adPanel');
  if (!p) {
    p = document.createElement('div');
    p.id = 'adPanel';
    p.innerHTML = `<div class="ad-box"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">Admin</h2><button class="btn small" id="adClose" type="button">Close</button></div>
      <div class="ad-tabs"><button class="btn small" data-t="users" type="button">Users</button><button class="btn small" data-t="clients" type="button">Clients and modules</button></div>
      <div id="adBody"><p class="note">Loading…</p></div></div>`;
    document.body.append(p);
    $('#adClose').onclick = close;
    p.addEventListener('click', e => { if (e.target === p) close(); });
    p.querySelectorAll('[data-t]').forEach(b => { b.onclick = () => open(b.dataset.t); });
  }
  p.hidden = false;
  p.querySelectorAll('[data-t]').forEach(b => b.classList.toggle('primary', b.dataset.t === tab));
  if (tab === 'users') await renderUsers(); else await renderClients();
}
function close() { const p = $('#adPanel'); if (p) p.hidden = true; }

function clientNames(list) {
  if (!list || list.includes('*')) return '<span class="ad-tag">All clients</span>';
  if (!list.length) return '<span class="note">No clients yet</span>';
  const names = Object.fromEntries(clients().map(c => [c.id, c.label]));
  return list.map(id => `<span class="ad-tag">${esc(names[id] || id)}</span>`).join('');
}

async function renderUsers(edit) {
  const r = await post('/api/access/users');
  if (!r.ok) { $('#adBody').innerHTML = `<p class="note">${esc(explain(r))}</p>`; return; }
  users = r.body.users || [];
  const u = edit || { email: '', name: '', role: 'hr', clients: [], active: true };
  const all = (u.clients || []).includes('*') || u.role === 'admin';
  $('#adBody').innerHTML = `
    <p class="note" style="margin:0 0 8px">Only people on this list can open the app. They sign in with their Microsoft work account using this email. <b>Admin</b>: everything, including users, clients and modules. <b>HR</b>: works only on the clients ticked for them.</p>
    <table><thead><tr><th>User</th><th>Role</th><th>Clients</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead><tbody>
    ${users.map((x, i) => `<tr class="${x.active === false ? 'ad-off' : ''}"><td><b>${esc(x.email)}</b>${x.name ? '<br><span class="note">' + esc(x.name) + '</span>' : ''}</td><td>${roleLabel(x.role)}</td><td>${clientNames(x.role === 'admin' ? ['*'] : x.clients)}</td>
      <td>${x.fromSettings ? 'Admin from Azure setting' : x.active === false ? 'Switched off' : 'Active'}</td><td>${x.lastLoginAt ? esc(new Date(x.lastLoginAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })) : '—'}</td>
      <td>${x.fromSettings ? '' : `<button class="btn small" data-edit="${i}" type="button">Edit</button> <button class="btn small" data-del="${i}" type="button">Remove</button>`}</td></tr>`).join('') || '<tr><td colspan="6" class="note">No users yet.</td></tr>'}
    </tbody></table>
    <h3 style="margin:16px 0 0">${edit ? 'Edit user' : 'Add a user'}</h3>
    <div class="ad-form">
      <label>Email (their Microsoft sign-in)<input id="adEmail" type="email" value="${esc(u.email)}" ${edit ? 'readonly' : ''} placeholder="name@company.com"></label>
      <label>Name<input id="adName" value="${esc(u.name || '')}" placeholder="Priya Malhotra"></label>
      <label>Role<select id="adRole"><option value="hr" ${u.role !== 'admin' ? 'selected' : ''}>HR (only their clients)</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin (everything)</option></select></label>
      <label style="flex-direction:row;align-items:center;gap:6px;margin-top:18px"><input id="adActive" type="checkbox" ${u.active !== false ? 'checked' : ''}> Can sign in</label>
    </div>
    <div id="adClientsBox"><label style="display:inline-flex;gap:6px;align-items:center;font-size:13px;margin-bottom:4px"><input id="adAll" type="checkbox" ${all ? 'checked' : ''}> All clients (also new ones)</label>
      <div class="ad-clients" id="adClients">${clients().map(c => `<label><input type="checkbox" value="${esc(c.id)}" ${(u.clients || []).includes(c.id) ? 'checked' : ''}> ${esc(c.label)}${c.inactive ? ' (off)' : ''}</label>`).join('') || '<span class="note">No clients yet: add one in Clients and modules.</span>'}</div></div>
    <div class="row" style="margin-top:10px"><button class="btn primary small" id="adSave" type="button">${edit ? 'Save changes' : 'Add user'}</button>${edit ? '<button class="btn small" id="adCancel" type="button">Cancel</button>' : ''}<span class="note" id="adState"></span></div>`;
  const sync = () => {
    const admin = $('#adRole').value === 'admin';
    if (admin) $('#adAll').checked = true;
    $('#adAll').disabled = admin;
    $('#adClients').classList.toggle('ad-off', $('#adAll').checked);
    $('#adClients').querySelectorAll('input').forEach(i => { i.disabled = $('#adAll').checked; });
  };
  $('#adRole').onchange = sync; $('#adAll').onchange = sync; sync();
  $('#adBody').querySelectorAll('[data-edit]').forEach(b => { b.onclick = () => renderUsers(users[+b.dataset.edit]); });
  $('#adBody').querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async () => {
      const x = users[+b.dataset.del];
      if (!window.confirm(`Remove ${x.email}? They will not be able to open the app any more.`)) return;
      const d = await post('/api/access/user-remove', { email: x.email });
      toast(d.ok ? `${x.email} removed.` : explain(d));
      renderUsers();
    };
  });
  if ($('#adCancel')) $('#adCancel').onclick = () => renderUsers();
  $('#adSave').onclick = async () => {
    const role = $('#adRole').value;
    const picked = $('#adAll').checked ? ['*'] : [...$('#adClients').querySelectorAll('input:checked')].map(i => i.value);
    if (role === 'hr' && !picked.length) { $('#adState').textContent = 'Tick at least one client, or All clients.'; return; }
    const s = await post('/api/access/user-save', { email: $('#adEmail').value, name: $('#adName').value, role, clients: picked, active: $('#adActive').checked });
    if (!s.ok) { $('#adState').textContent = explain(s); return; }
    toast(`${s.body.user.email} saved. They can sign in at ${location.origin}`);
    renderUsers();
  };
}

async function renderClients() {
  const r = await post('/api/modules/list');
  modsAll = (r.ok && r.body && r.body.clients) || {};
  const def = (r.ok && r.body && r.body.defaults) || { onboarding: true, exit: false };
  const list = clients();
  const m = id => Object.assign({}, def, modsAll[id]);
  $('#adBody').innerHTML = `
    <p class="note" style="margin:0 0 8px">Each client can use Onboarding, Exit or both. A module that is off is hidden for that client and sends nothing. Switching a client off hides it from everyone's client list; its data stays.</p>
    <table><thead><tr><th>Client</th><th>Onboarding</th><th>Exit</th><th>Client on</th><th></th></tr></thead><tbody>
    ${list.map(c => `<tr data-id="${esc(c.id)}" class="${c.inactive ? 'ad-off' : ''}"><td><input class="ad-label" value="${esc(c.label)}" style="width:100%"><br><span class="note">${esc(c.id)}</span></td>
      <td><input type="checkbox" class="ad-onb" ${m(c.id).onboarding !== false ? 'checked' : ''}></td><td><input type="checkbox" class="ad-exit" ${m(c.id).exit ? 'checked' : ''}></td>
      <td><input type="checkbox" class="ad-act" ${c.inactive ? '' : 'checked'}></td><td><button class="btn small primary ad-save" type="button">Save</button></td></tr>`).join('') || '<tr><td colspan="5" class="note">No clients yet.</td></tr>'}
    </tbody></table>
    <h3 style="margin:16px 0 0">Add a client</h3>
    <div class="ad-form"><label>Company name<input id="adNewClient" placeholder="Acme Industries Pvt. Ltd."></label>
      <label style="flex-direction:row;align-items:center;gap:6px;margin-top:18px"><input type="checkbox" id="adNewOnb" checked> Onboarding</label>
      <label style="flex-direction:row;align-items:center;gap:6px;margin-top:18px"><input type="checkbox" id="adNewExit"> Exit</label></div>
    <div class="row"><button class="btn primary small" id="adAddClient" type="button">Add client</button><span class="note" id="adCState"></span></div>
    <p class="note" style="margin-top:10px">A new client starts on the TCMPL default. Then set it up in Client setup (company details, People, Email settings, Journey setup), Joining forms, Day-1 readiness and Induction, and in Exit → Exit setup if Exit is on. Remember to give HR users access to it in Users.</p>`;
  $('#adBody').querySelectorAll('tr[data-id]').forEach(tr => {
    tr.querySelector('.ad-save').onclick = async () => {
      const id = tr.dataset.id;
      const label = tr.querySelector('.ad-label').value.trim();
      const active = tr.querySelector('.ad-act').checked;
      const mr = await post('/api/modules/save', { client: id, onboarding: tr.querySelector('.ad-onb').checked, exit: tr.querySelector('.ad-exit').checked });
      const cur = await getJson('/api/data/clients/' + encodeURIComponent(id));
      const data = Object.assign({}, cur.ok && cur.body ? cur.body.data : { client: id }, { client: id, label: label || id, active, updated: new Date().toISOString() });
      const cr = await fetch('/api/data/clients/' + encodeURIComponent(id), { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }).then(x => ({ ok: x.ok, status: x.status })).catch(() => ({ ok: false, status: 0 }));
      toast(mr.ok && cr.ok ? `${label} saved.` : 'Not saved: ' + (mr.ok ? 'client ' + cr.status : explain(mr)));
      if (window.tcmplModules) window.tcmplModules.reload();
      setTimeout(renderClients, 400);
    };
  });
  $('#adAddClient').onclick = async () => {
    const name = $('#adNewClient').value.trim();
    if (!name) { $('#adCState').textContent = 'Enter the company name.'; return; }
    if (!window.tcmplAddClient) { $('#adCState').textContent = 'The app is still loading, try again in a moment.'; return; }
    const id = await window.tcmplAddClient(name);
    if (!id) { $('#adCState').textContent = 'Not added.'; return; }
    await post('/api/modules/save', { client: id, onboarding: $('#adNewOnb').checked, exit: $('#adNewExit').checked });
    if (window.tcmplModules) window.tcmplModules.reload();
    renderClients();
  };
}

/* ---------- start ---------- */
(async function start(n) {
  if (!$('header .topright')) { if (n < 100) setTimeout(() => start(n + 1), 100); return; }
  const r = await post('/api/access/me');
  if (!r.ok || !r.body) return; // API not reachable: the app shows its own errors
  if (!r.body.allowed) { gate(r.body); return; }
  me = r.body;
  window.tcmplAccess = me;
  style();
  header();
  limitClients();
  if (window.tcmplModules) window.tcmplModules.reload();
})(0);
