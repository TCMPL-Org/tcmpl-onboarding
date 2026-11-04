'use strict';
// Request handlers, kept free of Azure Functions types so they can be tested
// directly and reused by other channels (e.g. WhatsApp) later.

const { getStore, validCol, validId } = require('./store');
const { aiConfigured, completeJson } = require('./ai');
const wa = require('./whatsapp');
const conversations = require('./conversations');
const documents = require('./documents');
const { docintelConfigured } = require('./docintel');
const { storageConfigured } = require('./blob');

const MAX_DOC_BYTES = 1800000; // Cosmos DB items are limited to 2 MB

const json = (status, body) => ({ status, jsonBody: body });

function health() {
  const store = getStore();
  return json(200, { ok: true, db: Boolean(store), store: store ? store.kind : null, ai: aiConfigured(), whatsapp: wa.waConfigured(), webhook: wa.webhookConfigured(), ocr: docintelConfigured(), storage: storageConfigured() });
}

async function data({ method, col, id, body, user }) {
  if (!user) return json(401, { error: 'sign_in_required' });
  if (!validCol(col)) return json(404, { error: 'unknown_collection' });
  if (id !== undefined && id !== null && id !== '' && !validId(id)) return json(400, { error: 'bad_id' });
  if (col === 'letters') return json(403, { error: 'not_available' });
  if ((col === 'messages' || col === 'documents') && method !== 'GET') return json(403, { error: 'read_only' });
  const store = getStore();
  if (!store) return json(503, { error: 'database_not_configured' });

  try {
    if (method === 'GET') {
      // The full bank account number stays on the server.
      const safe = r => (col === 'documents' && r && r.data && r.data.account) ? Object.assign({}, r, { data: Object.assign({}, r.data, { account: undefined }) }) : r;
      if (id) {
        const rec = await store.get(col, id);
        return rec ? json(200, safe(rec)) : json(404, { error: 'not_found' });
      }
      return json(200, { items: (await store.list(col)).map(safe) });
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

async function waStart({ body, user }) {
  if (!user) return json(401, { error: 'sign_in_required' });
  const r = await conversations.startForOffer(body || {}, user);
  return json(r.status, r.body);
}

async function waSend({ body, user }) {
  if (!user) return json(401, { error: 'sign_in_required' });
  const r = await conversations.sendManual(body || {}, user);
  return json(r.status, r.body);
}

async function waPush({ body, user }) {
  if (!user) return json(401, { error: 'sign_in_required' });
  const r = await conversations.pushItems(body || {}, user);
  return json(r.status, r.body);
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
  return json(r.status, r.body);
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

module.exports = { health, data, ai, waStart, waSend, waPush, waVerify, waWebhook, docsRequest, docsReview, docsFile };
