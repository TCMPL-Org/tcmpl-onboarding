'use strict';
// The 24-hour WhatsApp window: outside it Meta accepts normal messages and then drops them,
// so the app must send the approved template (offer) or hold the message and nudge.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DEV_MEMORY_STORE = '1';
delete process.env.COSMOS_CONNECTION_STRING;
process.env.WHATSAPP_PHONE_NUMBER_ID = '111';
process.env.WHATSAPP_TOKEN = 't';
process.env.WHATSAPP_TEMPLATE = 'offer_letter_ready';
process.env.WHATSAPP_TEMPLATE_LANG = 'en';
process.env.WHATSAPP_TEMPLATE_HEADER = 'document';
process.env.WHATSAPP_TEMPLATE_PARAMS = 'first,company,role,doj,agent';
process.env.WHATSAPP_NUDGE_TEMPLATE = 'onboarding_pending_step';

const { getStore } = require('../src/lib/store');
const conversations = require('../src/lib/conversations');
const handlers = require('../src/lib/handlers');

const user = { id: 'u1', name: 'hr@example.com', roles: ['authenticated'] };
const PDF = Buffer.from('%PDF-1.4 ' + 'x'.repeat(300)).toString('base64');

function mockMeta(missing = []) {
  const calls = [];
  const real = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).endsWith('/media')) { calls.push({ media: true }); return { ok: true, json: async () => ({ id: 'MEDIA1' }) }; }
    const body = JSON.parse(opts.body);
    calls.push(body);
    if (body.template && missing.includes(body.template.name)) return { ok: false, status: 404, json: async () => ({ error: { message: 'Template name does not exist in the translation', code: 132001 } }) };
    return { ok: true, json: async () => ({ messages: [{ id: 'wamid.' + calls.length }] }) };
  };
  return { calls, restore: () => { global.fetch = real; } };
}

async function seed(id, lastInboundAt) {
  await getStore().put('candidates', id, {
    phone: id.slice(3), name: 'Anjali Gowda', first: 'Anjali', role: 'Staff Nurse', company: 'Northpeak',
    agentName: 'Northpeak HR', doj: '2026-12-01', lastInboundAt
  }, user);
}

const offerItems = [{ type: 'text', text: 'Hi Anjali, congratulations!', buttons: ['Accept offer', 'I have questions', 'Decline'] }, { type: 'letter', pdfBase64: PDF, filename: 'Offer.pdf' }];

test('window helper', () => {
  assert.equal(conversations.windowOpen({}), false);
  assert.equal(conversations.windowOpen({ lastInboundAt: new Date(Date.now() - 3600e3).toISOString() }), true);
  assert.equal(conversations.windowOpen({ lastInboundAt: new Date(Date.now() - 25 * 3600e3).toISOString() }), false);
});

test('offer sent from the journey with the window closed goes as the offer template with the PDF', async () => {
  const m = mockMeta();
  try {
    await seed('wa-917623026914', new Date(Date.now() - 40 * 3600e3).toISOString());
    const r = await handlers.waPush({ body: { candidateId: 'wa-917623026914', touchpoint: 'Offer and take-home', touchpointKey: 'offer', items: offerItems }, user });
    assert.equal(r.status, 200);
    const sends = m.calls.filter(c => !c.media);
    assert.equal(sends.length, 1);
    assert.equal(sends[0].type, 'template');
    assert.equal(sends[0].template.name, 'offer_letter_ready');
    assert.equal(sends[0].template.components[0].parameters[0].document.id, 'MEDIA1');
    assert.deepEqual(sends[0].template.components[1].parameters.map(p => p.text), ['Anjali', 'Northpeak', 'Staff Nurse', '01 Dec 2026', 'Northpeak HR']);
  } finally { m.restore(); }
});

test('offer sent with the window open goes as normal messages', async () => {
  const m = mockMeta();
  try {
    await seed('wa-917623026915', new Date(Date.now() - 3600e3).toISOString());
    const r = await handlers.waPush({ body: { candidateId: 'wa-917623026915', touchpointKey: 'offer', items: offerItems }, user });
    assert.equal(r.status, 200);
    assert.deepEqual(m.calls.filter(c => !c.media).map(c => c.type), ['interactive', 'document']);
  } finally { m.restore(); }
});

test('other messages with the window closed are held and the reminder template goes out', async () => {
  const m = mockMeta();
  try {
    await seed('wa-917623026916', '');
    const r = await handlers.waSend({ body: { candidateId: 'wa-917623026916', text: 'Have you resigned?' }, user });
    assert.equal(r.status, 202);
    assert.equal(r.jsonBody.held, true);
    const sends = m.calls.filter(c => !c.media);
    assert.equal(sends.length, 1);
    assert.equal(sends[0].template.name, 'onboarding_pending_step');
    const rec = await getStore().get('candidates', 'wa-917623026916');
    assert.equal(rec.data.held.length, 1);
  } finally { m.restore(); }
});

test('journey steps use their own approved template when the window is closed', async () => {
  const m = mockMeta();
  try {
    await seed('wa-917623026917', '');
    const r = await handlers.waPush({ body: { candidateId: 'wa-917623026917', touchpoint: 'Resignation check', touchpointKey: 'resign', items: [{ type: 'text', text: 'Have you resigned?', buttons: ['Yes, submitted', 'Not yet'] }] }, user });
    assert.equal(r.status, 202);
    assert.equal(r.jsonBody.template, 'resignation_check');
    const t = m.calls.find(c => c.type === 'template');
    assert.deepEqual(t.template.components[0].parameters.map(p => p.text), ['Anjali', 'Northpeak']);
  } finally { m.restore(); }
});

test('a step template that is not approved yet falls back to the general reminder', async () => {
  const m = mockMeta(['joining_details']);
  try {
    await seed('wa-917623026918', '');
    const r = await handlers.waPush({ body: { candidateId: 'wa-917623026918', touchpoint: 'Day-1 kit', touchpointKey: 'day1kit', items: [{ type: 'text', text: 'Reporting 9:30 at Baner' }] }, user });
    assert.equal(r.status, 202);
    assert.equal(r.jsonBody.template, 'onboarding_pending_step');
    assert.deepEqual(m.calls.filter(c => c.type === 'template').map(c => c.template.name), ['joining_details', 'onboarding_pending_step']);
  } finally { m.restore(); }
});

test('the hourly run sends one reminder per template in 12 hours, not every hour', async () => {
  const steps = require('../src/lib/step-templates');
  const cand = {};
  assert.equal(steps.shouldRemind(cand, 'resign'), true);
  steps.markReminded(cand, 'resign');
  assert.equal(steps.shouldRemind(cand, 'resign'), false);
  assert.equal(steps.shouldRemind(cand, 'docs'), true);
  assert.equal(steps.templateFor('pulse30'), 'onboarding_checkin');
  assert.equal(steps.templateFor('cx:abc'), '');
});
