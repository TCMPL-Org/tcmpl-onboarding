'use strict';
// Modules share one app (Onboarding, Exit). This file is the only place where they meet.
//   register(name, { claims, handle, tick, confirm })  -> called once by a module when it loads
//   route(m, store)          -> WhatsApp: the first module that claims a message handles it; '' = onboarding handles it
//   runTicks(store, now)     -> scheduler: each module's tick; one module's error never stops another
//   confirm(name, payload)   -> one-click email links whose signed payload has m: <name>
//   settings / enabled / save -> per-client switches, stored in modules/<client> = { modules: { onboarding, exit } }

const MODULES = new Map();
const DEFAULTS = Object.freeze({ onboarding: true, exit: false });
const SYSTEM = { name: 'modules' };

const cleanClient = v => String(v || '').replace(/[^\w-]/g, '').slice(0, 60);

function register(name, mod) { MODULES.set(String(name), mod || {}); }
function loaded(name) { return MODULES.has(String(name)); }
function names() { return [...MODULES.keys()]; }

async function settings(store, clientId) {
  const id = cleanClient(clientId) || 'default';
  const rec = store ? await store.get('modules', id).catch(() => null) : null;
  const saved = (rec && rec.data && rec.data.modules) || {};
  const out = Object.assign({}, DEFAULTS);
  for (const k of Object.keys(DEFAULTS)) if (typeof saved[k] === 'boolean') out[k] = saved[k];
  return out;
}

async function enabled(store, clientId, name) { return Boolean((await settings(store, clientId))[name]); }

// Only the Exit switch can be changed for now; Onboarding stays on for every client.
async function save(store, clientId, patch, user) {
  const id = cleanClient(clientId);
  if (!id) return { status: 400, body: { error: 'client_required' } };
  const cur = await settings(store, id);
  if (patch && typeof patch.exit === 'boolean') cur.exit = patch.exit;
  await store.put('modules', id, { client: id, modules: cur, updated: new Date().toISOString() }, user || SYSTEM);
  return { status: 200, body: { client: id, modules: cur } };
}

async function route(m, store) {
  for (const [name, mod] of MODULES) {
    if (typeof mod.claims !== 'function' || typeof mod.handle !== 'function') continue;
    let claimed = false;
    try { claimed = await mod.claims(m, store); } catch (e) { console.error(`${name}: claims failed`, e && e.message); }
    if (!claimed) continue;
    try { await mod.handle(m, store); } catch (e) { console.error(`${name}: inbound failed`, e && e.message); }
    return name;
  }
  return '';
}

async function runTicks(store, now = Date.now()) {
  const out = {};
  for (const [name, mod] of MODULES) {
    if (typeof mod.tick !== 'function') continue;
    try { out[name] = await mod.tick(store, now); } catch (e) { out[name] = { ok: false, error: String(e && e.message || e).slice(0, 200) }; }
  }
  return out;
}

async function confirm(name, payload) {
  const mod = MODULES.get(String(name || ''));
  if (!mod || typeof mod.confirm !== 'function') return null;
  return mod.confirm(payload);
}

// HTTP: POST /api/modules/get|save (signed-in HR). Kept here, free of Azure Functions types, so it can be tested.
async function httpAction({ action, body, user }) {
  if (!user) return { status: 401, jsonBody: { error: 'sign_in_required' } };
  const store = require('./store').getStore();
  if (!store) return { status: 503, jsonBody: { error: 'database_not_configured' } };
  const client = body && body.client;
  if (action === 'get') return { status: 200, jsonBody: { client: cleanClient(client) || 'default', modules: await settings(store, client), loaded: names() } };
  if (action === 'save') {
    const exit = body && typeof body.exit === 'boolean' ? body.exit : undefined;
    const r = await save(store, client, { exit }, user);
    return { status: r.status, jsonBody: r.body };
  }
  return { status: 404, jsonBody: { error: 'unknown_action' } };
}

module.exports = { httpAction, register, loaded, names, settings, enabled, save, route, runTicks, confirm, cleanClient, DEFAULTS };
