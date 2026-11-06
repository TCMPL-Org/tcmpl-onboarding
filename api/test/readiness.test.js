'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DEV_MEMORY_STORE = '1';
delete process.env.COSMOS_CONNECTION_STRING;
process.env.WHATSAPP_TOKEN = 't'; process.env.WHATSAPP_PHONE_NUMBER_ID = '1';
const readiness = require('../src/lib/readiness');
const IST = 330 * 60000;
const ist = (d, hh, mm = 0) => Date.UTC(2026, 11, d, hh, mm) - IST;
const cand = () => ({ phone: '917000000001', name: 'Jeet Pawar', profile: { doj: '2026-12-01', client: 'northpeak', first: 'Jeet' } });

test('candidate checks: D-2 email, Day-1 card and laptop; Yes marks done, Not yet flags a problem', () => {
  const c = cand();
  assert.deepEqual(readiness.due(c, ist(29 - 30 + 30, 9)), []); // 29 Nov 9 am: before 10
  const nov29 = Date.UTC(2026, 10, 29, 10, 5) - IST;
  let out = readiness.due(c, nov29);
  assert.equal(out[0].qid, 'email');
  assert.deepEqual(out[0].msgs[0].buttons, ['Yes', 'Not yet']);
  readiness.onInbound(c, { text: "Yes" });
  let r;
  assert.equal(c.readiness.items.email.status, 'done');
  assert.equal(c.readiness.items.email.candidate, 'Confirmed by candidate');
  out = readiness.due(c, ist(1, 11, 5));
  assert.match(out[0].msgs[0].text, /Welcome to your first day, Jeet! Did you get your \*access card/);
  r = readiness.onInbound(c, { text: 'Not yet' });
  assert.match(r.replies[0].text, /sort it out today/);
  assert.equal(c.readiness.items.card.status, 'issue');
  assert.match(c.handovers[0].why, /card/);
  assert.deepEqual(readiness.due(c, ist(1, 11, 30)), [], 'one question at a time, not repeated');
  out = readiness.due(c, ist(1, 12, 5));
  assert.equal(out[0].qid, 'laptop');
  assert.equal(readiness.onInbound(c, { text: 'what time is lunch?' }).handled, false, 'other messages go to the agent');
});

test('old questions are skipped, not sent late; HR can update tasks', () => {
  const c = cand();
  readiness.due(c, ist(5, 12));
  assert.ok(c.readiness.asks.email.skipped);
  const r = readiness.update(c, { k: 'laptop', status: 'requested', note: 'Emailed Rohit' }, { name: 'hr@x' });
  assert.equal(r.item.status, 'requested');
  assert.ok(r.item.requestedAt);
  assert.equal(readiness.update(c, { k: 'laptop', status: 'bogus' }, { name: 'hr@x' }).error, 'bad_status');
});

test('messages are held while the 24-hour window is closed and sent when the candidate writes', async () => {
  const wa = require('../src/lib/whatsapp');
  const handlers = require('../src/lib/handlers');
  const conversations = require('../src/lib/conversations');
  const { getStore } = require('../src/lib/store');
  const store = getStore();
  const id = 'wa-917000000003';
  await store.put('candidates', id, { phone: '917000000003', name: 'Asha', profile: { client: 'northpeak' } }, { name: 't' });
  let open = false; const sent = [];
  wa.sendText = async (to, t) => { if (!open) { const e = new Error('Re-engagement message'); e.detail = { code: 131047 }; throw e; } sent.push(t); return { id: 'x' }; };
  wa.sendButtons = async (to, t) => { sent.push(t); return { id: 'y' }; };
  let r = await handlers.waSend({ body: { candidateId: id, text: 'Your joining time is 9:30' }, user: { name: 'hr@x' } });
  assert.equal(r.status, 202);
  assert.equal(r.jsonBody.held, true);
  r = await handlers.waPush({ body: { candidateId: id, items: [{ type: 'text', text: 'Day-1 kit' }], touchpoint: 'Day-1 kit', touchpointKey: 'day1kit' }, user: { name: 'hr@x' } });
  assert.equal(r.status, 202);
  assert.equal((await store.get('candidates', id)).data.held.length, 2);
  open = true;
  const n = await conversations.replayHeld(store, id);
  assert.equal(n, 2);
  assert.deepEqual(sent, ['Your joining time is 9:30', 'Day-1 kit']);
  const c = (await store.get('candidates', id)).data;
  assert.equal(c.held.length, 0);
  assert.ok(c.touchpoints.day1kit, 'the step is marked sent');
});

test('the agent uses the latest company facts but keeps the candidate\'s own offer line', async () => {
  const conversations = require('../src/lib/conversations');
  const { getStore } = require('../src/lib/store');
  const store = getStore();
  await store.put('facts', 'northpeak', { facts: 'address: New office, Baner\nreporting: 9:00 am', faq: 'Parking: free' }, { name: 'hr' });
  const c = await conversations.withLatestFacts(store, { profile: { client: 'northpeak' }, facts: 'address: Old office\noffer: role Analyst; joining 1 Dec 2026', faq: 'old' });
  assert.match(c.facts, /New office/);
  assert.doesNotMatch(c.facts, /Old office/);
  assert.match(c.facts, /offer: role Analyst/);
  assert.equal(c.faq, 'Parking: free');
});
