'use strict';
// Request handlers, kept free of Azure Functions types so they can be tested
// directly and reused by other channels (e.g. WhatsApp) later.

const { getStore, validCol, validId } = require('./store');
const { aiConfigured, completeJson } = require('./ai');

const MAX_DOC_BYTES = 1800000; // Cosmos DB items are limited to 2 MB

const json = (status, body) => ({ status, jsonBody: body });

function health() {
  const store = getStore();
  return json(200, { ok: true, db: Boolean(store), store: store ? store.kind : null, ai: aiConfigured() });
}

async function data({ method, col, id, body, user }) {
  if (!user) return json(401, { error: 'sign_in_required' });
  if (!validCol(col)) return json(404, { error: 'unknown_collection' });
  if (id !== undefined && id !== null && id !== '' && !validId(id)) return json(400, { error: 'bad_id' });
  const store = getStore();
  if (!store) return json(503, { error: 'database_not_configured' });

  try {
    if (method === 'GET') {
      if (id) {
        const rec = await store.get(col, id);
        return rec ? json(200, rec) : json(404, { error: 'not_found' });
      }
      return json(200, { items: await store.list(col) });
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

module.exports = { health, data, ai };
