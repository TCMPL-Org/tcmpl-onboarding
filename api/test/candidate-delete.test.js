'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DEV_MEMORY_STORE = '1';
delete process.env.COSMOS_CONNECTION_STRING;
delete process.env.STORAGE_CONNECTION_STRING;
const candidates = require('../src/lib/candidates');
const handlers = require('../src/lib/handlers');
const { getStore } = require('../src/lib/store');

const admin = { email: 'boss@tc.com', role: 'admin', clients: ['*'] };
const hr = { email: 'priya@client.com', role: 'hr', clients: ['northpeak'] };
const sys = { name: 'seed' };

test('admins delete a candidate and everything about them; others are untouched', async () => {
  const st = getStore();
  for (const [id, name] of [['wa-919810000001', 'Ritika Sharma'], ['wa-919810000002', 'Arjun Rao']]) {
    await st.put('candidates', id, { name, phone: id.slice(3), offerId: 'of-' + id, history: [{ offerId: 'of-old-' + id }], profile: { name, client: 'northpeak' } }, sys);
    await st.put('messages', 'm1-' + id, { candidateId: id, text: 'hi' }, sys);
    await st.put('messages', 'm2-' + id, { candidateId: id, text: 'offer' }, sys);
    await st.put('documents', 'd-' + id, { candidateId: id, type: 'pan' }, sys);
    await st.put('calls', 'c-' + id, { candidateId: id, purpose: 'confirm' }, sys);
    await st.put('letters', id, { pdfBase64: 'x', text: 'letter' }, sys);
    await st.put('offers', 'of-' + id, { name }, sys);
    await st.put('offers', 'of-old-' + id, { name }, sys);
  }
  const id = 'wa-919810000001';
  let r = await candidates.handle('delete', { candidateId: id, confirmName: 'Ritika Sharma' }, hr);
  assert.equal(r.status, 403, 'HR cannot delete');
  r = await candidates.handle('delete', { candidateId: id, confirmName: 'Ritika' }, admin);
  assert.equal(r.status, 409, 'the full name must be typed');
  r = await handlers.data({ method: 'DELETE', col: 'candidates', id, user: admin });
  assert.equal(r.status, 403, 'never deleted piecemeal through the data API');

  r = await candidates.handle('delete', { candidateId: id, confirmName: '  ritika  sharma ' }, admin);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.counts, { documents: 1, files: 0, messages: 2, calls: 1, letter: 1, offers: 2 });
  assert.equal(await st.get('candidates', id), null);
  assert.equal(await st.get('letters', id), null);
  assert.equal(await st.get('offers', 'of-' + id), null);
  for (const col of ['messages', 'documents', 'calls']) assert.ok(!(await st.list(col)).some(x => x.data.candidateId === id), col);

  // The other candidate keeps everything.
  const other = 'wa-919810000002';
  assert.ok(await st.get('candidates', other));
  assert.equal((await st.list('messages')).filter(x => x.data.candidateId === other).length, 2);
  assert.ok(await st.get('letters', other));

  const log = await handlers.data({ method: 'GET', col: 'deletions', user: admin });
  assert.equal(log.jsonBody.items.length, 1);
  const d = log.jsonBody.items[0].data;
  assert.equal(d.by, 'boss@tc.com'); assert.equal(d.mobileLast4, '0001'); assert.equal(d.client, 'northpeak');
  assert.ok(!JSON.stringify(d).includes('Ritika'), 'no name kept');
  assert.equal((await handlers.data({ method: 'GET', col: 'deletions', user: hr })).status, 403);
  assert.equal((await candidates.handle('delete', { candidateId: id, confirmName: 'Ritika Sharma' }, admin)).status, 404);
});
