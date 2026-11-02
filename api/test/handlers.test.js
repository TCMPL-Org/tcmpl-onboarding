'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DEV_MEMORY_STORE = '1';
delete process.env.COSMOS_CONNECTION_STRING;
const handlers = require('../src/lib/handlers');
const { getUser } = require('../src/lib/auth');

const user = { id: 'u1', name: 'jeet@example.com', roles: ['authenticated'] };

test('health reports features', () => {
  const r = handlers.health();
  assert.equal(r.status, 200);
  assert.equal(r.jsonBody.db, true);
  assert.equal(r.jsonBody.store, 'memory');
});

test('signed-out requests are refused', async () => {
  const r = await handlers.data({ method: 'GET', col: 'offers', user: null });
  assert.equal(r.status, 401);
});

test('unknown collections and bad ids are refused', async () => {
  assert.equal((await handlers.data({ method: 'GET', col: 'secrets', user })).status, 404);
  assert.equal((await handlers.data({ method: 'PUT', col: 'offers', id: '../x', body: {}, user })).status, 400);
});

test('save, list, read, delete round trip', async () => {
  const put = await handlers.data({ method: 'PUT', col: 'offers', id: 'of-1', body: { id: 'ignored', name: 'Ritika', client: 'northpeak' }, user });
  assert.equal(put.status, 200);
  assert.equal(put.jsonBody.data.name, 'Ritika');
  assert.equal(put.jsonBody.data.id, undefined);
  const list = await handlers.data({ method: 'GET', col: 'offers', user });
  assert.equal(list.jsonBody.items.length, 1);
  assert.equal(list.jsonBody.items[0].id, 'of-1');
  const one = await handlers.data({ method: 'GET', col: 'offers', id: 'of-1', user });
  assert.equal(one.jsonBody.meta.updatedBy, 'jeet@example.com');
  assert.equal((await handlers.data({ method: 'DELETE', col: 'offers', id: 'of-1', user })).status, 200);
  assert.equal((await handlers.data({ method: 'GET', col: 'offers', id: 'of-1', user })).status, 404);
});

test('oversized records are refused', async () => {
  const big = { rows: 'x'.repeat(1900000) };
  assert.equal((await handlers.data({ method: 'PUT', col: 'master', id: 'c1', body: big, user })).status, 413);
});

test('AI is off until configured, then calls Azure OpenAI', async () => {
  assert.equal((await handlers.ai({ body: { prompt: 'hi' }, user })).status, 503);
  process.env.AZURE_OPENAI_ENDPOINT = 'https://example.openai.azure.com/';
  process.env.AZURE_OPENAI_API_KEY = 'test-key';
  process.env.AZURE_OPENAI_DEPLOYMENT = 'chat';
  const realFetch = global.fetch;
  let seen = null;
  global.fetch = async (url, opts) => { seen = { url, opts }; return { ok: true, json: async () => ({ choices: [{ message: { content: '{"reply":"Hello","handover":false,"riskSignals":[]}' } }] }) }; };
  try {
    const r = await handlers.ai({ body: { prompt: 'Question' }, user });
    assert.equal(r.status, 200);
    assert.equal(r.jsonBody.result.reply, 'Hello');
    assert.match(seen.url, /^https:\/\/example\.openai\.azure\.com\/openai\/deployments\/chat\/chat\/completions\?api-version=/);
    assert.equal(seen.opts.headers['api-key'], 'test-key');
  } finally {
    global.fetch = realFetch;
    delete process.env.AZURE_OPENAI_ENDPOINT; delete process.env.AZURE_OPENAI_API_KEY; delete process.env.AZURE_OPENAI_DEPLOYMENT;
  }
});

test('reads the Static Web Apps user header', () => {
  const p = Buffer.from(JSON.stringify({ identityProvider: 'aad', userId: 'abc', userDetails: 'jeet@example.com', userRoles: ['authenticated'] })).toString('base64');
  assert.equal(getUser({ 'x-ms-client-principal': p }).name, 'jeet@example.com');
  assert.equal(getUser({}), null);
  assert.equal(getUser({ 'x-ms-client-principal': 'not-base64-json' }), null);
});
