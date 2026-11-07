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
const X = require('./send');

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
        const now = X.caseNow(rec.data);
        return json(200, { case: rec.data, messages: msgs.slice(-200), today: R.todayIst(now), clock: rec.data.clockOffsetMs ? new Date(now).toISOString() : '' });
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
      case 'send': case 'step': case 'walk': case 'reply': return await caseAction(store, name, body, user);
      default: return json(404, { error: 'unknown_action' });
    }
  } catch (e) {
    return json(500, { error: 'exit_error', detail: String(e && e.message || e).slice(0, 200) });
  }
}

/* ---------------- Case journey actions: send a step, mark it, walkthrough clock, HR reply ---------------- */
const IST = 330 * 60000;
async function caseAction(store, name, body, user) {
  const id = String(body.id || '');
  if (!ID_RE.test(id)) return json(400, { error: 'bad_id' });
  const rec = await store.get('exit_cases', id);
  if (!rec) return json(404, { error: 'case_not_found' });
  const k = Object.assign({}, rec.data);
  if (k.status !== 'open') return json(409, { error: 'not_open' });
  if (!await modules.enabled(store, k.client, 'exit')) return json(403, { error: 'exit_off_for_client' });
  const { setup } = await S.load(store, k.client);
  let out = {};
  if (name === 'send') {
    const r = await X.sendStep(store, setup, k, String(body.key || ''), user);
    if (r.error) return json(404, { error: r.error });
    out = { result: r };
  } else if (name === 'step') {
    const key = String(body.key || ''), st = String(body.status || '');
    const s = (k.plan || []).find(x => x.key === key);
    if (!s || !['done', 'skipped', 'planned'].includes(st)) return json(400, { error: 'bad_step' });
    k.plan = k.plan.map(x => (x.key === key ? Object.assign({}, x, { status: st, at: nowIso(), by: user.name }) : x));
    X.log(k, `Step "${s.title}" marked ${st} by HR.`, user);
  } else if (name === 'reply') {
    const text = S.str(body.text, 4000);
    if (!text) return json(400, { error: 'text_required' });
    const w = await whatsappReply(store, k, text, user);
    out = { result: w };
  } else if (name === 'walk') {
    const a = String(body.action || '');
    if (a === 'jump') {
      const anchor = body.anchor === 'lwd' ? k.lwd : body.anchor === 'first' ? (k.first || '').slice(0, 10) : k.formal;
      const day = Math.max(-120, Math.min(365, parseInt(body.day, 10) || 0));
      const tm = /^(\d{1,2}):(\d{2})$/.exec(String(body.time || '10:30')) || [0, 10, 30];
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(R.addDays(anchor, day));
      if (!m) return json(400, { error: 'bad_date' });
      k.clockOffsetMs = Date.UTC(+m[1], +m[2] - 1, +m[3], +tm[1], +tm[2]) - IST - Date.now();
      k.walkthrough = true;
      X.log(k, `Walkthrough clock moved to ${R.niceDate(R.addDays(anchor, day))} ${tm[1]}:${tm[2]}.`, user);
    } else if (a === 'run') {
      out = { sent: await X.runDue(store, setup, k, user, Date.now(), { force: true }) };
    } else if (a === 'realtime') {
      k.clockOffsetMs = 0;
      X.log(k, 'Walkthrough clock back to real time.', user);
    } else if (a === 'reset') {
      k.plan = R.planFor(setup, k, []);
      k.approvals = (k.approvals || []).map(x => Object.assign({}, x, { status: 'Pending', at: undefined, chain: x.chain.map(c => Object.assign({}, c, { status: 'Waiting', at: undefined, askedAt: undefined })) }));
      Object.assign(k, { clearances: {}, held: [], alerts: [], stage: 'raised', acceptedAt: undefined, clockOffsetMs: 0, lastAutoReplyAt: undefined, nudgedAt: undefined });
      let removed = 0;
      for (const m of await store.list('exit_messages')) if (m.data && m.data.caseId === id) { await store.remove('exit_messages', m.id, user); removed++; }
      X.log(k, `Case reset for a new walkthrough (${removed} messages removed).`, user);
    } else return json(400, { error: 'bad_action' });
  }
  await alertHr(store, k);
  await store.put('exit_cases', id, k, user);
  return json(200, Object.assign({ case: k }, out));
}

async function whatsappReply(store, k, text, user) {
  if (!wa.waConfigured() || !k.employee.phone) return { ok: false, note: 'WhatsApp is not connected or no mobile number' };
  try {
    const r = await wa.sendText(k.employee.phone, text);
    await saveMsg(store, 'xo-' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'), { caseId: k.id, direction: 'out', text, waId: r.id || '', by: user.name, source: 'hr', kind: 'text' });
    return { ok: true };
  } catch (e) {
    if (X.windowClosed(e)) {
      k.held = (k.held || []).concat([{ text, about: 'hr', by: user.name, at: nowIso() }]).slice(-10);
      await saveMsg(store, 'xo-' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'), { caseId: k.id, direction: 'out', text, error: 'held until the employee next writes (24-hour window closed)', by: user.name, source: 'hr', kind: 'held' });
      return { ok: false, held: true };
    }
    return { ok: false, note: e.message };
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
  // The employee just wrote, so the 24-hour window is open: send anything that was held.
  if (wa.waConfigured()) await X.replayHeld(store, k).catch(e => console.error('exit replay failed', e && e.message));
  await alertHr(store, k);
  await store.put('exit_cases', k.id, k, SYSTEM);
}

/* ---------------- Scheduler: steps due at each case's clock; sent automatically when the client switches it on ---------------- */
async function tick(store, now = Date.now()) {
  let cases = 0, due = 0, sent = 0;
  const setups = {};
  for (const rec of await store.list('exit_cases')) {
    const k = rec.data;
    if (!k || k.status !== 'open' || !Array.isArray(k.plan)) continue;
    if (!await modules.enabled(store, k.client, 'exit')) continue;
    const setup = setups[k.client] || (setups[k.client] = (await S.load(store, k.client)).setup);
    const before = JSON.stringify([k.plan, k.alerts, k.approvals, k.held]);
    const cnow = X.caseNow(k, now);
    k.plan = k.plan.map(s => {
      if (s.status === 'planned' && X.stepTime(s) <= cnow) { due++; return Object.assign({}, s, { status: 'due', dueAt: nowIso() }); }
      return s;
    });
    if (setup.sending && setup.sending.auto) sent += await X.runDue(store, setup, k, SYSTEM, now);
    if (JSON.stringify([k.plan, k.alerts, k.approvals, k.held]) !== before) { await alertHr(store, k); await store.put('exit_cases', rec.id, k, SYSTEM); cases++; }
  }
  return { ok: true, cases, due, sent };
}

/* ---------------- One-click links with m: 'exit' (approvals and clearances, next batch) ---------------- */
function page(text, ok) {
  const body = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Exit</title></head><body style="font-family:Segoe UI,Arial,sans-serif;background:#f4f7f7;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center"><div style="background:#fff;border-radius:12px;padding:28px 32px;max-width:440px;box-shadow:0 2px 12px rgba(0,0,0,.08)"><div style="font-size:32px">${ok ? '✓' : '!'}</div><p style="font-size:16px;color:#1d2a30">${String(text).replace(/[<>&]/g, '')}</p><p style="font-size:12px;color:#667">TCMPL AI Exit Agent</p></div></body></html>`;
  return { status: ok ? 200 : 400, body, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } };
}
async function confirm(p) {
  const store = getStore();
  if (!store) return page('The exit system is not available right now. Please try again later.', false);
  const rec = ID_RE.test(String(p && p.c || '')) ? await store.get('exit_cases', p.c) : null;
  if (!rec) return page('This exit case is no longer open.', false);
  const k = Object.assign({}, rec.data);
  if (!await modules.enabled(store, k.client, 'exit')) return page('This link is not active.', false);
  const { setup } = await S.load(store, k.client);
  const r = await X.onLink(store, setup, k, p);
  await alertHr(store, k);
  await store.put('exit_cases', k.id, k, SYSTEM);
  return page(r.msg, r.ok);
}

modules.register('exit', { claims, handle, tick, confirm });

module.exports = { action, claims, handle, tick, confirm, openCaseFor };
