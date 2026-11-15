'use strict';
// 15 Nov fixes: delivery reports, messages per candidate, no trapped questions, revised offers keep progress,
// documents start on acceptance, scheduler rotation and time budget.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DEV_MEMORY_STORE = '1';
delete process.env.COSMOS_CONNECTION_STRING;
process.env.WHATSAPP_PHONE_NUMBER_ID = '111';
process.env.WHATSAPP_TOKEN = 't';
process.env.WHATSAPP_TEMPLATE = 'offer_letter_ready';
process.env.WHATSAPP_TEMPLATE_LANG = 'en';
delete process.env.WHATSAPP_TEMPLATE_HEADER;
delete process.env.WHATSAPP_TEMPLATE_PARAMS;
process.env.WHATSAPP_NUDGE_TEMPLATE = 'onboarding_pending_step';

const { getStore } = require('../src/lib/store');
const wa = require('../src/lib/whatsapp');
const agent = require('../src/lib/agent');
const conversations = require('../src/lib/conversations');
const handlers = require('../src/lib/handlers');
const inductionRun = require('../src/lib/induction-run');
const { isOtherMessage } = require('../src/lib/answers');

const user = { id: 'u1', name: 'hr@example.com', roles: ['authenticated'] };
const store = () => getStore();

// Every WhatsApp send is recorded instead of going to Meta.
const sent = [];
let n = 0;
const stub = { sendText: wa.sendText, sendButtons: wa.sendButtons, sendTemplate: wa.sendTemplate, sendNamedTemplate: wa.sendNamedTemplate };
wa.sendText = async (to, text) => { sent.push({ to, text }); return { id: 'wamid.' + (++n) }; };
wa.sendButtons = async (to, text, buttons) => { sent.push({ to, text, buttons }); return { id: 'wamid.' + (++n) }; };
wa.sendTemplate = async () => { sent.push({ template: 'offer_letter_ready' }); return { id: 'wamid.' + (++n), template: 'offer_letter_ready', withDocument: false }; };
wa.sendNamedTemplate = async (to, name) => { sent.push({ to, template: name }); return { id: 'wamid.' + (++n) }; };
agent.reply = async () => ({ reply: 'You report at 9:30 AM at the Baner office.', riskSignals: [], handover: false });
test.after(() => Object.assign(wa, stub));

const inbound = (from, text, extra) => conversations.handleInbound(Object.assign({ id: 'in.' + (++n), from, type: 'text', text, timestamp: String(Math.floor(Date.now() / 1000)) }, extra));
const msgsOf = async id => (await store().listByCandidate('messages', id)).map(r => r.data).sort((a, b) => String(a.at).localeCompare(String(b.at)));

test('delivery reports: read beats delivered, failed shows the reason in plain words, other numbers are ignored', async () => {
  await store().put('messages', 'o-dr1', { candidateId: 'wa-919800000001', direction: 'out', text: 'Hi', waId: 'wamid.DR1', at: new Date().toISOString() }, user);
  await store().put('messages', 'o-dr2', { candidateId: 'wa-919800000001', direction: 'out', text: 'Docs', waId: 'wamid.DR2', at: new Date().toISOString() }, user);
  const body = s => ({ entry: [{ changes: [{ value: { metadata: { phone_number_id: '111' }, statuses: s } }] }] });
  const st = (id, status, extra) => Object.assign({ id, status, recipient_id: '919800000001', timestamp: '1794700000' }, extra);
  const parsed = wa.parseStatuses(body([st('wamid.DR1', 'read'), st('wamid.DR2', 'failed', { errors: [{ code: 131047, title: 'Re-engagement message' }] })]));
  assert.equal(parsed.length, 2);
  for (const s of parsed) await conversations.onStatus(s);
  await conversations.onStatus(wa.parseStatuses(body([st('wamid.DR1', 'delivered')]))[0]); // late "delivered" after "read"
  const one = (await store().get('messages', 'o-dr1')).data, two = (await store().get('messages', 'o-dr2')).data;
  assert.equal(one.status, 'read');
  assert.ok(one.readAt && one.deliveredAt);
  assert.equal(two.status, 'failed');
  assert.match(two.error, /24 hours/);
  // a report for the attendance bot's number never touches our messages
  const other = { entry: [{ changes: [{ value: { metadata: { phone_number_id: '999' }, statuses: [st('wamid.DR1', 'failed')] } }] }] };
  assert.equal(wa.parseStatuses(other).length, 0);
});

test('messages and documents are read per candidate', async () => {
  await store().put('messages', 'o-pc1', { candidateId: 'wa-919800000002', direction: 'out', text: 'mine' }, user);
  const r = await handlers.data({ method: 'GET', col: 'messages', candidateId: 'wa-919800000002', user });
  assert.equal(r.status, 200);
  assert.ok(r.jsonBody.items.length >= 1);
  assert.ok(r.jsonBody.items.every(i => i.data.candidateId === 'wa-919800000002'));
});

test('a pending date question never traps the candidate: a question goes to the agent, then the date is asked again', async () => {
  assert.equal(isOtherMessage('hi, what time do I report?'), true);
  assert.equal(isOtherMessage('25/11/2026'), false);
  assert.equal(isOtherMessage('25th nov'), false);
  const id = 'wa-919800000003';
  await store().put('candidates', id, {
    phone: '919800000003', name: 'Asha Rao', lastInboundAt: new Date().toISOString(),
    profile: { client: 'trapclient', doj: '2026-12-21', first: 'Asha' },
    checkins: { asks: {}, pending: { key: 'relieving', at: new Date().toISOString() } }
  }, user);
  sent.length = 0;
  await inbound('919800000003', 'hi, what time do I report on day 1?');
  assert.equal(sent[0].text, 'You report at 9:30 AM at the Baner office.');
  assert.match(sent[1].text, /Relieving date.*25\/11\/2026/);
  assert.ok((await store().get('candidates', id)).data.checkins.pending, 'the date question is still waiting');
  // a real attempt that cannot be read gets the format hint
  sent.length = 0;
  await inbound('919800000003', '31/31');
  assert.match(sent[0].text, /could not read that date/);
  // and the date itself is recorded
  sent.length = 0;
  await inbound('919800000003', '28/11/2026');
  const c = (await store().get('candidates', id)).data;
  assert.equal(c.prejoin.relievingDate.value, '2026-11-28');
  assert.equal(c.checkins.pending, null);
});

test('a revised offer keeps documents, check-ins and the WhatsApp window; acceptance is asked again', async () => {
  const id = 'wa-919800000004';
  await store().put('candidates', id, {
    phone: '919800000004', name: 'Ravi Kumar', offerId: 'of-1', role: 'Analyst', doj: '2026-12-01', releasedAt: '2026-11-10T10:00:00Z',
    acceptedAt: '2026-11-11T10:00:00Z', stage: 'Offer accepted', lastInboundAt: new Date().toISOString(),
    profile: { client: 'northpeak', doj: '2026-12-01' }, client: 'northpeak',
    docs: { requestedAt: '2026-11-11T10:05:00Z', consentAt: '2026-11-11T10:06:00Z', items: { pan: { status: 'confirmed' } } },
    checkins: { asks: { resign: { answer: 'Yes, submitted' } } }, details: { maritalStatus: 'Single' }
  }, user);
  const r = await handlers.waStart({ user, body: { name: 'Ravi Kumar', mobile: '9800000004', role: 'Senior Analyst', client: 'northpeak', offerId: 'of-2', doj: '2026-12-08', profile: { client: 'northpeak', doj: '2026-12-08' } } });
  assert.equal(r.status, 200);
  const c = (await store().get('candidates', id)).data;
  assert.equal(c.role, 'Senior Analyst');
  assert.equal(c.doj, '2026-12-08');
  assert.equal(c.docs.items.pan.status, 'confirmed');
  assert.equal(c.checkins.asks.resign.answer, 'Yes, submitted');
  assert.equal(c.details.maritalStatus, 'Single');
  assert.ok(c.lastInboundAt);
  assert.equal(c.acceptedAt, null);
  assert.equal(c.stage, 'Revised offer released');
  assert.equal(c.offerHistory[0].offerId, 'of-1');
  assert.equal(c.offerHistory[0].acceptedAt, '2026-11-11T10:00:00Z');
});

test('accepting the offer on WhatsApp starts documents straight away (unless switched off for the client)', async () => {
  const id = 'wa-919800000005';
  await store().put('candidates', id, { phone: '919800000005', name: 'Meera', company: 'Northpeak', stage: 'Offer released', lastInboundAt: new Date().toISOString(), profile: { client: 'autodocs', doj: '2026-12-01' } }, user);
  sent.length = 0;
  await inbound('919800000005', 'Accept offer', { type: 'button' });
  const c = (await store().get('candidates', id)).data;
  assert.equal(c.stage, 'Offer accepted');
  assert.ok(c.docs && c.docs.requestedAt, 'documents were asked for');
  assert.ok(sent.some(s => /Before you share documents/.test(s.text || '')), 'consent message went out');
  assert.ok((await msgsOf(id)).some(m => /Before you share documents/.test(m.text)), 'and shows in the chat');

  const id2 = 'wa-919800000006';
  await store().put('journeys', 'nodocs', { client: 'nodocs', autoDocs: false }, user);
  await store().put('candidates', id2, { phone: '919800000006', name: 'Kiran', stage: 'Offer released', lastInboundAt: new Date().toISOString(), profile: { client: 'nodocs', doj: '2026-12-01' } }, user);
  await inbound('919800000006', 'Accept offer', { type: 'button' });
  assert.ok(!((await store().get('candidates', id2)).data.docs || {}).requestedAt, 'switched off: HR starts documents');
});

test('accepting by the email link with the WhatsApp window closed holds the documents and sends documents_request', async () => {
  const id = 'wa-919800000007';
  await store().put('candidates', id, { phone: '919800000007', name: 'Neha', stage: 'Offer released', profile: { client: 'emailaccept', doj: '2026-12-01', first: 'Neha' } }, user);
  sent.length = 0;
  const r = await conversations.autoStartDocs(store(), id);
  assert.equal(r.status, 202);
  assert.deepEqual(sent.map(s => s.template), ['documents_request']);
  const c = (await store().get('candidates', id)).data;
  assert.equal(c.held[0].action, 'docs');
});

test('scheduler skips finished candidates and stops starting new ones when its time is up', async () => {
  await store().put('candidates', 'wa-919800000008', { phone: '919800000008', stage: 'Offer declined', profile: { client: 'x', doj: '2026-12-01' } }, user);
  await store().put('candidates', 'wa-919800000009', { phone: '919800000009', stage: 'Day 120', profile: { client: 'x', doj: '2026-01-01' } }, user);
  const r = await inductionRun.tick(Date.now(), -1); // no time at all: nothing is started, the rest is counted as skipped
  assert.equal(r.ok, true);
  assert.equal(r.candidates, 0);
  assert.ok(r.skipped >= 1);
  const all = (await store().list('candidates')).length;
  assert.ok(r.skipped < all, 'declined and long-finished candidates are not even queued');
});
