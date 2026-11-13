'use strict';
// Request handlers, kept free of Azure Functions types so they can be tested
// directly and reused by other channels (e.g. WhatsApp) later.

const { getStore, validCol, validId } = require('./store');
const { aiConfigured, completeJson } = require('./ai');
const wa = require('./whatsapp');
const conversations = require('./conversations');
const inductionRun = require('./induction-run');
const notify = require('./notify');
const walk = require('./walk');
const { emailConfigured } = require('./email');
const documents = require('./documents');
const { docintelConfigured } = require('./docintel');
const { storageConfigured } = require('./blob');
const modules = require('./modules');
const access = require('./access');

const MAX_DOC_BYTES = 1800000; // Cosmos DB items are limited to 2 MB

const json = (status, body) => ({ status, jsonBody: body });

function health() {
  const store = getStore();
  return json(200, { ok: true, db: Boolean(store), store: store ? store.kind : null, ai: aiConfigured(), whatsapp: wa.waConfigured(), webhook: wa.webhookConfigured(), ocr: docintelConfigured(), storage: storageConfigured(), scheduler: Boolean(process.env.CRON_SECRET), email: emailConfigured(), exit: modules.loaded('exit') });
}

async function data({ method, col, id, body, user }) {
  if (!user) return json(401, { error: 'sign_in_required' });
  if (!validCol(col)) return json(404, { error: 'unknown_collection' });
  if (id !== undefined && id !== null && id !== '' && !validId(id)) return json(400, { error: 'bad_id' });
  if (col === 'letters' || col === 'users') return json(403, { error: 'not_available' }); // users: only through /api/access
  if ((col === 'messages' || col === 'documents' || col === 'content') && method !== 'GET') return json(403, { error: 'read_only' });
  // Module switches and Exit records change only through their own routes (/api/modules, /api/exit).
  if ((col === 'modules' || col.startsWith('exit_')) && method !== 'GET') return json(403, { error: 'read_only' });
  if (col === 'facts' && method === 'PUT' && body) body = { facts: String(body.facts || '').slice(0, 12000), faq: String(body.faq || '').slice(0, 6000), updated: new Date().toISOString() };
  const store = getStore();
  if (!store) return json(503, { error: 'database_not_configured' });

  try {
    // HR users limited to some clients: reads are filtered, writes to other clients refused; new clients only by admins.
    if (method !== 'GET' && user.role && !access.allClients(user)) {
      const target = col === 'candidates' ? ((await store.get(col, id)) || {}).data : null;
      const clientId = col === 'candidates' ? (target && target.profile && target.profile.client) || (body && body.profile && body.profile.client) : ['clients', 'journeys', 'modules', 'facts', 'plans'].includes(col) ? id : '';
      if (clientId !== '' && !access.canClient(user, clientId)) return json(403, { error: 'client_not_allowed' });
    }
    if (col === 'clients' && method !== 'GET' && user.role && user.role !== 'admin' && (method === 'DELETE' || !(await store.get(col, id)))) return json(403, { error: 'admin_only' });
    if (method === 'GET') {
      // The full bank account number stays on the server.
      const safe = r => (col === 'documents' && r && r.data && r.data.account) ? Object.assign({}, r, { data: Object.assign({}, r.data, { account: undefined }) }) : r;
      if (id) {
        const rec = await store.get(col, id);
        if (rec && user.role && !(await access.filterItems(user, col, [rec])).length) return json(403, { error: 'client_not_allowed' });
        return rec ? json(200, safe(rec)) : json(404, { error: 'not_found' });
      }
      const items = (await store.list(col)).map(safe);
      return json(200, { items: user.role ? await access.filterItems(user, col, items) : items });
    }
    if (!id) return json(400, { error: 'id_required' });
    if (method === 'PUT') {
      if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'body_must_be_object' });
      const clean = Object.assign({}, body);
      delete clean.id;
      if (Buffer.byteLength(JSON.stringify(clean), 'utf8') > MAX_DOC_BYTES) return json(413, { error: 'too_large' });
      return json(200, await store.put(col, id, clean, user));
    }
    if (method === 'DELETE') {
      await store.remove(col, id, user);
      return json(200, { ok: true });
    }
    return json(405, { error: 'method_not_allowed' });
  } catch (e) {
    return json(500, { error: 'store_error', detail: String(e && e.message || e).slice(0, 200) });
  }
}

async function ai({ body, user }) {
  if (!user) return json(401, { error: 'sign_in_required' });
  if (!aiConfigured()) return json(503, { error: 'ai_not_configured' });
  const prompt = body && body.prompt;
  if (typeof prompt !== 'string' || !prompt.trim()) return json(400, { error: 'prompt_required' });
  try {
    return json(200, { result: await completeJson(prompt) });
  } catch (e) {
    const status = e.code === 'rate_limited' ? 429 : 502;
    return json(status, { error: e.code || 'ai_error' });
  }
}

// When WhatsApp refuses because the 24-hour window is closed, keep the message and send it as soon as the candidate writes.
async function heldOr(r, action, payload, user) {
  if (r.status === 409 && r.body && r.body.error === 'window_closed' && payload && payload.candidateId) {
    const h = await conversations.hold(String(payload.candidateId), action, payload, user);
    return json(h.status, h.body);
  }
  return json(r.status, r.body);
}

async function waStart({ body, user }) {
  if (!user) return json(401, { error: 'sign_in_required' });
  const r = await conversations.startForOffer(body || {}, user);
  return json(r.status, r.body);
}

async function waSend({ body, user }) {
  if (!user) return json(401, { error: 'sign_in_required' });
  const r = await conversations.sendManual(body || {}, user);
  return heldOr(r, 'text', body, user);
}

async function waPush({ body, user }) {
  if (!user) return json(401, { error: 'sign_in_required' });
  const r = await conversations.pushItems(body || {}, user);
  const rest = Object.assign({}, body, { items: (Array.isArray(body && body.items) ? body.items : []).slice((r.body && r.body.sent) || 0) });
  return heldOr(r, 'push', rest, user);
}

// Documents: HR asks for documents, reviews them, opens a stored file.
async function docsRequest({ body, user }) {
  if (!user) return json(401, { error: 'sign_in_required' });
  const store = getStore();
  if (!store) return json(503, { error: 'database_not_configured' });
  if (!wa.waConfigured()) return json(503, { error: 'whatsapp_not_configured' });
  const id = String((body && body.candidateId) || '');
  if (!/^wa-\d{11,15}$/.test(id)) return json(400, { error: 'candidate_required' });
  const r = await documents.request(store, id, user);
  return heldOr(r, 'docs', { candidateId: id }, user);
}

async function docsReview({ body, user }) {
  if (!user) return json(401, { error: 'sign_in_required' });
  const store = getStore();
  if (!store) return json(503, { error: 'database_not_configured' });
  const r = await documents.review(store, body || {}, user);
  return json(r.status, r.body);
}

async function docsFile({ candidateId, type, user }) {
  if (!user) return json(401, { error: 'sign_in_required' });
  const store = getStore();
  if (!store || !storageConfigured()) return json(503, { error: 'storage_not_configured' });
  try {
    const r = await documents.file(store, candidateId, type);
    if (r.status !== 200) return json(r.status, { error: r.status === 404 ? 'no_file' : 'bad_request' });
    return { status: 200, body: r.buffer, headers: { 'content-type': r.contentType, 'cache-control': 'private, no-store', 'content-disposition': 'inline' } };
  } catch (e) {
    return json(502, { error: 'storage_error', detail: String(e && e.message || e).slice(0, 200) });
  }
}

// Joining forms: details questions, HR edits/approval, send to candidate.
async function formsAction({ action, body, user }) {
  if (!user) return json(401, { error: 'sign_in_required' });
  const fn = { details: conversations.askDetails, save: conversations.saveForms, send: conversations.sendForms, missing: conversations.missingDetails }[action];
  if (!fn) return json(404, { error: 'unknown_action' });
  const r = await fn(body || {}, user);
  return action === 'details' ? heldOr(r, 'details', body, user) : action === 'send' ? heldOr(r, 'forms', body, user) : json(r.status, r.body);
}

// Induction: HR "Send now", content upload / open.
async function inductionAction({ action, body, user }) {
  if (!user) return json(401, { error: 'sign_in_required' });
  if (action === 'ready-update' || action === 'ready-ask') { const r = await inductionRun.readyAction(action.slice(6), body || {}, user); return json(r.status, r.body); }
  const fn = { send: inductionRun.sendNow, upload: inductionRun.uploadContent }[action];
  if (!fn) return json(404, { error: 'unknown_action' });
  const r = await fn(body || {}, user);
  return json(r.status, r.body);
}

async function contentFile({ id, user }) {
  if (!user) return json(401, { error: 'sign_in_required' });
  try {
    const r = await inductionRun.contentFile(id);
    if (r.status !== 200) return json(r.status, { error: r.status === 404 ? 'not_found' : 'storage_not_configured' });
    return { status: 200, body: r.buffer, headers: { 'content-type': r.contentType, 'cache-control': 'private, no-store', 'content-disposition': `inline; filename="${String(r.name).replace(/"/g, '')}"` } };
  } catch (e) { return json(502, { error: 'storage_error', detail: String(e && e.message || e).slice(0, 200) }); }
}

// Scheduler tick: called every 15 minutes by GitHub Actions with the CRON_SECRET header.
async function cronTick({ key }) {
  const want = process.env.CRON_SECRET || '';
  const a = Buffer.from(String(key || '')), b = Buffer.from(want);
  if (!want || a.length !== b.length || !require('node:crypto').timingSafeEqual(a, b)) return json(401, { error: 'bad_key' });
  const out = await inductionRun.tick();
  // Other modules (Exit) run their own due steps; their errors are caught inside runTicks.
  const store = getStore();
  if (store) out.modules = await modules.runTicks(store);
  return json(200, out);
}

// Email: owner tasks, candidate emails, client email settings. Walkthrough: jump / run / realtime / reset.
async function notifyAction({ action, body, user }) {
  if (!user) return json(401, { error: 'sign_in_required' });
  const fn = { owner: notify.ownerTask, candidate: notify.candidateEmail, settings: notify.saveSettings }[action];
  if (fn) { const r = await fn(body || {}, user); return json(r.status, r.body); }
  if (['jump', 'run', 'realtime', 'reset'].includes(action)) { const r = await walk.action(action, body || {}, user); return json(r.status, r.body); }
  return json(404, { error: 'unknown_action' });
}

// One-click links in emails (no sign-in; the link is signed).
async function checkinAction({ action, body, user }) {
  if (!user) return json(401, { error: 'sign_in_required' });
  const r = await inductionRun.checkinAction(action, body || {}, user);
  return json(r.status, r.body);
}

async function confirmLink({ token }) { return notify.confirm(token); }

// Meta webhook: GET = subscription check, POST = incoming messages.
function waVerify(query) {
  const ok = query.get('hub.mode') === 'subscribe' && process.env.WHATSAPP_VERIFY_TOKEN && query.get('hub.verify_token') === process.env.WHATSAPP_VERIFY_TOKEN;
  return ok ? { status: 200, body: String(query.get('hub.challenge') || '') } : { status: 403, body: 'Forbidden' };
}

async function waWebhook(rawBody, signature) {
  if (!wa.verifySignature(rawBody, signature)) return { status: 401, body: 'Bad signature' };
  let payload;
  try { payload = JSON.parse(rawBody); } catch { return { status: 400, body: 'Bad JSON' }; }
  for (const m of wa.parseInbound(payload)) {
    try { await conversations.handleInbound(m); } catch (e) { console.error('whatsapp inbound failed', e && e.message); }
  }
  return { status: 200, body: 'OK' };
}

module.exports = { health, data, ai, waStart, waSend, waPush, waVerify, waWebhook, docsRequest, docsReview, docsFile, formsAction, inductionAction, contentFile, cronTick, notifyAction, confirmLink, checkinAction };
