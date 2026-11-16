'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DEV_MEMORY_STORE = '1';
delete process.env.COSMOS_CONNECTION_STRING;
const handlers = require('../src/lib/handlers');
const { getStore } = require('../src/lib/store');

const admin = { email: 'boss@tc.com', role: 'admin', clients: ['*'] };
const hr = { email: 'priya@client.com', role: 'hr', clients: ['northpeak'] };

test('salary calculator settings: constants admin-only; HR saving a client keeps its salary rules', async () => {
  const store = getStore();
  let r = await handlers.data({ method: 'PUT', col: 'ctc', id: 'config', body: { cfg: { erPF: 0.12 }, mw: [], fx: [] }, user: hr });
  assert.equal(r.status, 403);
  r = await handlers.data({ method: 'PUT', col: 'ctc', id: 'config', body: { cfg: { erPF: 0.12 }, mw: [], fx: [] }, user: admin });
  assert.equal(r.status, 200);
  r = await handlers.data({ method: 'GET', col: 'ctc', id: 'config', user: hr });
  assert.equal(r.status, 200, 'HR can read the constants');

  await handlers.data({ method: 'PUT', col: 'clients', id: 'northpeak', body: { client: 'northpeak', label: 'Northpeak', ctc: { code: 'C1008', noESIC: true } }, user: admin });
  r = await handlers.data({ method: 'PUT', col: 'clients', id: 'northpeak', body: { client: 'northpeak', label: 'Northpeak Ltd', ctc: { code: 'HACK', noESIC: false } }, user: hr });
  assert.equal(r.status, 200);
  const rec = (await store.get('clients', 'northpeak')).data;
  assert.equal(rec.label, 'Northpeak Ltd', 'HR edits to the client are saved');
  assert.deepEqual(rec.ctc, { code: 'C1008', noESIC: true }, 'but the salary rules stay');
});
