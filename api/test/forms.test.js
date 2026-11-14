'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DEV_MEMORY_STORE = '1';
delete process.env.COSMOS_CONNECTION_STRING;
process.env.WHATSAPP_TOKEN = 't'; process.env.WHATSAPP_PHONE_NUMBER_ID = '1';
const wa = require('../src/lib/whatsapp');
const handlers = require('../src/lib/handlers');
const { getStore } = require('../src/lib/store');
const user = { name: 'hr@x' };

test('HR saves, sends and approves joining forms', async () => {
  const sent = [];
  Object.assign(wa, {
    uploadMedia: async (buf, mime, name) => 'media-' + name,
    sendDocument: async (to, mid, name) => { sent.push('doc:' + name); return { id: 'd' }; },
    sendButtons: async (to, text, b) => { sent.push('buttons:' + b.join('|')); return { id: 'b' }; },
    sendText: async (to, text) => { sent.push('text:' + text.slice(0, 20)); return { id: 't' }; }
  });
  const store = getStore();
  const id = 'wa-917000000009';
  await store.put('candidates', id, { phone: '917000000009', name: 'Jeet Pawar', lastInboundAt: new Date().toISOString() }, user);

  let r = await handlers.formsAction({ action: 'details', body: { candidateId: id }, user });
  assert.equal(r.status, 200);
  assert.equal((await store.get('candidates', id)).data.details.step, 'marital');

  r = await handlers.formsAction({ action: 'save', body: { candidateId: id, vals: { 'f11:father': 'Ramesh Pawar', 'bad key!': 'x' }, states: { 'f11:father': 'corrected' } }, user });
  assert.equal(r.status, 200);
  assert.deepEqual(r.jsonBody.forms.vals, { 'f11:father': 'Ramesh Pawar' });

  const pdf = Buffer.from('%PDF-1.4 ' + 'x'.repeat(200)).toString('base64');
  r = await handlers.formsAction({ action: 'send', body: { candidateId: id, files: [{ filename: 'Form 11 Jeet.pdf', pdfBase64: pdf }, { filename: 'Form_F.pdf', pdfBase64: pdf }] }, user });
  assert.equal(r.status, 200);
  assert.deepEqual(sent.slice(-3), ['doc:Form_11_Jeet.pdf', 'doc:Form_F.pdf', 'buttons:All correct|Something is wrong']);
  let c = (await store.get('candidates', id)).data;
  assert.equal(c.forms.pendingConfirm, true);
  assert.equal(c.forms.vals['f11:father'], 'Ramesh Pawar', 'HR edits kept when sending');

  await handlers.formsAction({ action: 'save', body: { candidateId: id, vals: c.forms.vals, states: c.forms.states, approve: true }, user });
  c = (await store.get('candidates', id)).data;
  assert.equal(c.forms.approvedBy, 'hr@x');
  assert.equal(c.stage, 'Forms approved by HR');

  assert.equal((await handlers.formsAction({ action: 'send', body: { candidateId: id, files: [] }, user })).status, 400);
  assert.equal((await handlers.formsAction({ action: 'nope', body: {}, user })).status, 404);
  assert.equal((await handlers.formsAction({ action: 'save', body: {}, user: null })).status, 401);
});
