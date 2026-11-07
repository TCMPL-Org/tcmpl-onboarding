'use strict';
// Exit module: HTTP actions (/api/exit/<action>) and its hooks into the shared app
// (WhatsApp routing, scheduler tick, one-click links), registered in ../modules.js.

const crypto = require('node:crypto');
const { getStore } = require('../store');
const modules = require('../modules');
const wa = require('../whatsapp');
const email = require('../email');
const S = require('./setup');
const C = require('./cases');
const R = require('./rules');

const SYSTEM = { name: 'exit-agent' };
const nowIso = () => new Date().toISOString();
const json = (status, body) => ({ status, jsonBody: body });
const ID_RE = /^exit-[\w-]{1,60}-[A-Za-z0-9]{1,40}-\d{8}$/;
const REPLY_GAP_MS = 6 * 3600e3;

/* ---------------- HTTP actions (signed-in HR) ---------------- */
async function action({ action: name, body, user }) {
  if (!user) return json(401, { error: 'sign_in_required' });
  const store = getStore();
  if (!store) return json(503, { error: 'database_not_configured' });
  body = body && typeof body === 'object' ? body : {};
  const client = S.cleanClient(body.client) || 'default';
  try {
    switch (name) {
      case 'setup': { const r = await S.load(store, client); return json(200, Object.assign(r, { options: S.options(), enabled: await modules.enabled(store, client, 'exit') })); }
      case 'setup-save': { const r = await S.save(store, client, body.setup, user); return json(r.status, r.body); }
      case 'setup-reset': { const r = await S.reset(store, client, user); return json(r.status, r.body); }
      case 'preview': {
        const { setup } = await S.load(store, client);
        const r = C.build(setup, body.case, { client, clientLabel: body.clientLabel });
        return json(200, r.k ? { case: r.k } : { errors: r.errors });
      }
      case 'raise': {
        if (!await modules.enabled(store, client, 'exit')) return json(403, { error: 'exit_off_for_client' });
        const { setup } = await S.load(store, client);
        const r = await C.raise(store, setup, body.case, { client, clientLabel: body.clientLabel }, user);
        return json(r.status, r.body);
      }
      case 'import': {
        if (!await modules.enabled(store, client, 'exit')) return json(403, { error: 'exit_off_for_client' });
        const { setup } = await S.load(store, client);
        const r = await C.importRows(store, setup, body.rows, { client, clientLabel: body.clientLabel }, user);
        return json(r.status, r.body);
      }
      case 'cases': return json(200, { items: await C.list(store, client, body.all === true) });
      case 'case': {
        const id = String(body.id || '');
        if (!ID_RE.test(id)) return json(400, { error: 'bad_id' });
        const rec = await store.get('exit_cases', id);
        if (!rec) return json(404, { error: 'case_not_found' });
        const msgs = (await store.list('exit_messages')).map(m => m.data).filter(m => m && m.caseId === id).sort((a, b) => String(a.at).localeCompare(String(b.at)));
        return json(200, { case: rec.data, messages: msgs.slice(-200), today: R.todayIst() });
      }
      case 'cancel': {
        const id = String(body.id || '');
        if (!ID_RE.test(id)) return json(400, { error: 'bad_id' });
        const r = await C.cancel(store, id, body.reason, user);
        return json(r.status, r.body);
      }
      case 'alert-close': {
        const id = String(body.id || '');
        if (!ID_RE.test(id)) return json(400, { error: 'bad_id' });
        const rec = await store.get('exit_cases', id);
        if (!rec) return json(404, { error: 'case_not_found' });
        const k = Object.assign({}, rec.data);
        const i = Number(body.index);
        if (!k.alerts || !k.alerts[i]) return json(404, { error: 'alert_not_found' });
        k.alerts = k.alerts.map((a, j) => (j === i ? Object.assign({}, a, { open: false, closedAt: nowIso(), closedBy: user.name }) : a));
        await store.put('exit_cases', id, k, user);
        return json(200, { case: k });
      }
      default: return json(404, { error: 'unknown_action' });
    }
  } catch (e) {
    return json(500, { error: 'exit_error', detail: String(e && e.message || e).slice(0, 200) });
  }
}

/* ---------------- WhatsApp: messages from employees with an open exit case ---------------- */
async function openCaseFor(store, phone) {
  const p = wa.normalizePhone(phone);
  if (!p) return null;
  const all = (await store.list('exit_cases')).map(r => r.data).filter(k => k && k.status === 'open' && k.employee && k.employee.phone === p);
  all.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  for (const k of all) if (await modules.enabled(store, k.client, 'exit')) return k;
  return null;
}

async function claims(m, store) {
  return Boolean(m && m.from && await openCaseFor(store, m.from));
}

async function saveMsg(store, id, m) { await store.put('exit_messages', id, Object.assign({ at: nowIso(), channel: 'whatsapp' }, m), SYSTEM); }

// Emails HR once for each new red item (contacts.hr, else reply-to).
async function alertHr(store, k) {
  const open = (k.alerts || []).filter(a => a.open && !a.alertedAt);
  if (!open.length || !email.emailConfigured()) return false;
  const { setup } = await S.load(store, k.client);
  const to = email.addresses(setup.contacts.hr || setup.contacts.replyTo);
  if (!to.length) return false;
  try {
    await email.send({ to, cc: setup.contacts.cc, replyTo: setup.contacts.replyTo, subject: `Exit: ${k.employee.name} needs HR`,
      text: `${k.employee.name} (${k.employee.code || k.employee.phone}), ${k.typeName}, last working day ${R.niceDate(k.lwd)}.\n\n${open.map(a => '• ' + a.why).join('\n')}\n\nOpen the Exit module → Case journey to act.` });
    const at = nowIso();
    k.alerts = k.alerts.map(a => (a.open && !a.alertedAt ? Object.assign({}, a, { alertedAt: at }) : a));
    return true;
  } catch (e) { console.error('exit hr alert failed', e && e.message); return false; }
}

async function handle(m, store) {
  const k = await openCaseFor(store, m.from);
  if (!k) return;
  const id = 'xm-' + crypto.createHash('sha1').update(String(m.id || m.from + m.timestamp)).digest('hex').slice(0, 24);
  if (await store.get('exit_messages', id)) return; // Meta retries: handle each message once
  const text = m.media ? `[${m.type === 'image' ? 'Photo' : 'File'}${m.media.filename ? ': ' + m.media.filename : ''}]${m.text ? ' ' + m.text : ''}` : (m.text || `[${m.type || 'message'} received]`);
  await saveMsg(store, id, { caseId: k.id, direction: 'in', text, waId: m.id || '', kind: m.type || 'text' });
  const now = nowIso();
  k.lastInboundAt = now;
  k.alerts = (k.alerts || []).concat([{ why: `Employee wrote on WhatsApp: "${text.slice(0, 160)}"`, at: now, open: true }]).slice(-50);
  // A short holding reply, at most once every 6 hours, so the employee knows the message arrived.
  if (wa.waConfigured() && (!k.lastAutoReplyAt || Date.now() - Date.parse(k.lastAutoReplyAt) > REPLY_GAP_MS)) {
    const first = (k.employee.name || '').split(' ')[0] || 'there';
    const reply = `Thank you, ${first}. Your HR team has your message and will reply here soon.`;
    let waId = '', error = '';
    try { waId = (await wa.sendText(k.employee.phone, reply)).id || ''; } catch (e) { error = e.message; }
    await saveMsg(store, 'xo-' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'), { caseId: k.id, direction: 'out', text: reply, waId, error, source: 'system', kind: 'text' });
    k.lastAutoReplyAt = now;
  }
  await alertHr(store, k);
  await store.put('exit_cases', k.id, k, SYSTEM);
}

/* ---------------- Scheduler: mark steps that are due (sending comes with Case journey messaging) ---------------- */
async function tick(store, now = Date.now()) {
  const today = R.todayIst(now);
  let cases = 0, due = 0;
  for (const rec of await store.list('exit_cases')) {
    const k = rec.data;
    if (!k || k.status !== 'open' || !Array.isArray(k.plan)) continue;
    if (!await modules.enabled(store, k.client, 'exit')) continue;
    let changed = false;
    k.plan = k.plan.map(s => {
      if (s.status === 'planned' && s.date && s.date <= today) { changed = true; due++; return Object.assign({}, s, { status: 'due', dueAt: nowIso() }); }
      return s;
    });
    if (changed) { await store.put('exit_cases', rec.id, k, SYSTEM); cases++; }
  }
  return { ok: true, cases, due };
}

/* ---------------- One-click links with m: 'exit' (approvals and clearances, next batch) ---------------- */
function page(text, ok) {
  const body = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Exit</title></head><body style="font-family:Segoe UI,Arial,sans-serif;background:#f4f7f7;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center"><div style="background:#fff;border-radius:12px;padding:28px 32px;max-width:440px;box-shadow:0 2px 12px rgba(0,0,0,.08)"><div style="font-size:32px">${ok ? '✓' : '!'}</div><p style="font-size:16px;color:#1d2a30">${String(text).replace(/[<>&]/g, '')}</p><p style="font-size:12px;color:#667">TCMPL AI Exit Agent</p></div></body></html>`;
  return { status: ok ? 200 : 400, body, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } };
}
async function confirm(_p) { return page('This link is not active yet.', false); }

modules.register('exit', { claims, handle, tick, confirm });

module.exports = { action, claims, handle, tick, confirm, openCaseFor };
