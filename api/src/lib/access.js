'use strict';
// Who may use the app, and for which clients.
//
// Sign-in is done by Azure Static Web Apps (Microsoft account). That alone lets ANY Microsoft account in, so every
// API call is also checked here against the app's own user list:
//   users/<email id> = { email, name, role: 'admin' | 'hr', clients: ['*'] | [clientIds], active, addedBy, addedAt, lastLoginAt }
//   ADMIN_EMAILS (Azure setting, comma list) are always admins for all clients, even before any user is added.
// Admins manage users, clients and the modules (Onboarding / Exit) per client. HR users work only on their clients.
// Until ADMIN_EMAILS is set and no user exists, the app stays open to signed-in users (setup mode, shown as a banner).

const { getUser } = require('./auth');
const { getStore } = require('./store');

const ROLES = ['admin', 'hr'];
const SYSTEM = { name: 'access' };
const CACHE_MS = 30000;
let cache = { at: 0, users: null };

const norm = e => String(e || '').trim().toLowerCase();
const isEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const idFor = email => norm(email).replace('@', ':').replace(/[^a-z0-9_.:-]/g, '_').slice(0, 200);
const cleanClient = v => String(v || '').replace(/[^\w-]/g, '').slice(0, 60);
const admins = () => String(process.env.ADMIN_EMAILS || '').split(/[,;\s]+/).map(norm).filter(isEmail);

function emailOf(p) {
  if (!p) return '';
  const d = norm(p.name);
  return isEmail(d) ? d : '';
}

async function allUsers(store, fresh) {
  if (!store) return [];
  if (!fresh && cache.users && Date.now() - cache.at < CACHE_MS) return cache.users;
  const list = (await store.list('users')).map(r => r.data).filter(u => u && u.email);
  cache = { at: Date.now(), users: list };
  return list;
}
function forget() { cache = { at: 0, users: null }; }

// The signed-in person with their role and clients, or why they may not come in.
async function resolve(principal) {
  if (!principal) return { status: 401, error: 'sign_in_required' };
  const email = emailOf(principal);
  const store = getStore();
  const adminList = admins();
  if (email && adminList.includes(email)) return { user: Object.assign({}, principal, { email, role: 'admin', clients: ['*'], fromSettings: true }) };
  const users = await allUsers(store).catch(() => []);
  if (!adminList.length && !users.length) return { user: Object.assign({}, principal, { email, role: 'admin', clients: ['*'], setupMode: true }) };
  const u = email && users.find(x => norm(x.email) === email);
  if (!u || u.active === false) return { status: 403, error: 'no_access', email: email || principal.name || '' };
  if (store && (!u.lastLoginAt || Date.now() - Date.parse(u.lastLoginAt) > 3600000)) {
    store.put('users', idFor(email), Object.assign({}, u, { lastLoginAt: new Date().toISOString() }), SYSTEM).then(forget).catch(() => {});
  }
  return { user: Object.assign({}, principal, { email, name: principal.name, displayName: u.name || '', role: ROLES.includes(u.role) ? u.role : 'hr', clients: Array.isArray(u.clients) && u.clients.length ? u.clients : [] }) };
}

const allClients = u => Boolean(u && (u.role === 'admin' || (u.clients || []).includes('*')));
// The TCMPL default template ("default") is readable by everyone; real clients only when assigned.
function canClient(u, clientId) {
  if (!u) return false;
  const id = cleanClient(clientId);
  if (!id || id === 'default' || allClients(u)) return true;
  return (u.clients || []).includes(id);
}

// Used by every API function: { user } when allowed, otherwise { response } to return as is.
// body.client / body.candidateId are checked against the user's clients.
async function guard(request, body) {
  const r = await resolve(getUser(request.headers));
  if (!r.user) return { response: { status: r.status, jsonBody: { error: r.error, email: r.email || '' } } };
  const u = r.user;
  if (body && typeof body === 'object' && !allClients(u)) {
    if (body.client && !canClient(u, body.client)) return { response: { status: 403, jsonBody: { error: 'client_not_allowed' } } };
    const cid = typeof body.candidateId === 'string' ? body.candidateId : '';
    if (cid) {
      const store = getStore();
      const rec = store && /^wa-\d{8,15}$/.test(cid) ? await store.get('candidates', cid).catch(() => null) : null;
      if (rec && !canClient(u, rec.data && rec.data.profile && rec.data.profile.client)) return { response: { status: 403, jsonBody: { error: 'client_not_allowed' } } };
    }
  }
  return { user: u };
}

// Data API read filter for HR users limited to some clients.
async function filterItems(u, col, items) {
  if (allClients(u)) return items;
  const store = getStore();
  const clientOf = d => (d && (d.client || (d.profile && d.profile.client))) || '';
  if (['clients', 'journeys', 'modules', 'facts', 'plans'].includes(col)) return items.filter(r => canClient(u, (r.data && r.data.client) || r.id));
  if (col === 'candidates' || col.startsWith('exit_')) return items.filter(r => canClient(u, clientOf(r.data)));
  if (col === 'messages' || col === 'documents') {
    const ok = new Set((await store.list('candidates')).filter(r => canClient(u, clientOf(r.data))).map(r => r.id));
    return items.filter(r => ok.has((r.data && r.data.candidateId) || String(r.id).split('.')[0]));
  }
  return items;
}

/* ---------- admin API: /api/access/{action} ---------- */
function cleanUser(p, by) {
  const email = norm(p && p.email);
  if (!isEmail(email)) return { error: 'valid_email_required' };
  const role = ROLES.includes(p.role) ? p.role : 'hr';
  let clients = Array.isArray(p.clients) ? p.clients.map(c => (c === '*' ? '*' : cleanClient(c))).filter(Boolean).slice(0, 200) : [];
  if (role === 'admin' || clients.includes('*')) clients = ['*'];
  return { user: { email, name: String(p.name || '').slice(0, 120), role, clients, active: p.active !== false, updatedBy: by } };
}

async function httpAction({ action, body, request }) {
  const principal = getUser(request.headers);
  const r = await resolve(principal);
  if (action === 'me') {
    if (!r.user) return { status: 200, jsonBody: { allowed: false, reason: r.error, email: r.email || emailOf(principal) || (principal && principal.name) || '' } };
    const u = r.user;
    return { status: 200, jsonBody: { allowed: true, email: u.email || u.name, name: u.displayName || '', role: u.role, clients: u.clients, setupMode: Boolean(u.setupMode), adminsSet: admins().length > 0 } };
  }
  if (!r.user) return { status: r.status, jsonBody: { error: r.error } };
  if (r.user.role !== 'admin') return { status: 403, jsonBody: { error: 'admin_only' } };
  const store = getStore();
  if (!store) return { status: 503, jsonBody: { error: 'database_not_configured' } };
  const by = r.user.email || r.user.name;
  const p = body || {};

  if (action === 'users') {
    const list = (await allUsers(store, true)).map(u => Object.assign({}, u));
    for (const e of admins()) if (!list.some(u => norm(u.email) === e)) list.unshift({ email: e, name: '', role: 'admin', clients: ['*'], active: true, fromSettings: true });
    list.forEach(u => { if (admins().includes(norm(u.email))) u.fromSettings = true; });
    return { status: 200, jsonBody: { users: list } };
  }
  if (action === 'user-save') {
    const c = cleanUser(p, by);
    if (c.error) return { status: 400, jsonBody: { error: c.error } };
    if (c.user.email === norm(by) && (c.user.role !== 'admin' || !c.user.active) && !admins().includes(c.user.email)) return { status: 400, jsonBody: { error: 'cannot_remove_own_admin' } };
    const prev = await store.get('users', idFor(c.user.email));
    const data = Object.assign({ addedBy: by, addedAt: new Date().toISOString() }, prev && prev.data, c.user);
    await store.put('users', idFor(c.user.email), data, { name: by });
    forget();
    return { status: 200, jsonBody: { user: data } };
  }
  if (action === 'user-remove') {
    const email = norm(p.email);
    if (!isEmail(email)) return { status: 400, jsonBody: { error: 'valid_email_required' } };
    if (email === norm(by)) return { status: 400, jsonBody: { error: 'cannot_remove_yourself' } };
    await store.remove('users', idFor(email), { name: by });
    forget();
    return { status: 200, jsonBody: { removed: email } };
  }
  return { status: 404, jsonBody: { error: 'unknown_action' } };
}

module.exports = { resolve, guard, canClient, allClients, filterItems, httpAction, idFor, forget, ROLES };
