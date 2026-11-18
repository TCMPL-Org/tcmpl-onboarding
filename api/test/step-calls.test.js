'use strict';
// AI calls for journey steps (Client setup → Journey setup): off by default; per step "call if no answer",
// "call first" or "WhatsApp and a call"; retries; WhatsApp fallback; answers on the call complete the step.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DEV_MEMORY_STORE = '1';
delete process.env.COSMOS_CONNECTION_STRING;
process.env.LIVEKIT_URL = 'wss://tcmpl-onboarding-test.livekit.cloud';
process.env.LIVEKIT_API_KEY = 'APIkey123';
process.env.LIVEKIT_API_SECRET = 'secret-for-tests';
process.env.CALL_AGENT_SECRET = 'call-secret-for-tests';
process.env.CALL_HOURS = '0-24';

const ck = require('../src/lib/checkins');
const calls = require('../src/lib/calls');
const run = require('../src/lib/induction-run');
const { getStore } = require('../src/lib/store');

const IST = 330 * 60000;
const t = (day, hh, mm = 0) => Date.UTC(2026, 11, 1 + day, hh, mm) - IST; // DOJ 1 Dec 2026, IST
const cand = () => ({ phone: '917000000001', name: 'Jeet Pawar', company: 'Northpeak', profile: { doj: '2026-12-01', client: 'northpeak', first: 'Jeet' } });
const only = (ids, on = true) => { const s = ck.defaults(); s.infra = []; s.autoCall = on; s.items = s.items.filter(i => ids.includes(i.id)); return s; };
const ON = () => ({ calls: { on: true, ok: true, left: 5 } });

const seen = [];
const realFetch = global.fetch;
let livekitOk = true;
test.before(() => {
  global.fetch = async (url, opts) => {
    seen.push({ url: String(url), body: opts && opts.body ? JSON.parse(opts.body) : null });
    if (/livekit/.test(String(url)) && !livekitOk) return { ok: false, status: 500, json: async () => ({ msg: 'down' }) };
    return { ok: true, json: async () => ({ messages: [{ id: 'wamid.x' }] }) };
  };
});
test.after(() => { global.fetch = realFetch; });

test('default: Automatic calls is off, so no step is ever called automatically', () => {
  const s = ck.defaults();
  assert.equal(s.autoCall, false);
  assert.equal(ck.cleanSetup({ items: [] }).autoCall, false);
  const c = cand();
  const s2 = only(['resign'], false);
  ck.due(c, s2, t(-28, 11, 5), ON());
  const out = ck.due(c, s2, t(-27, 11, 10), ON());
  assert.ok(out.every(x => !x.call));
  assert.ok(out.some(x => x.reminder)); // the normal WhatsApp reminder
});

test('"call if no answer": WhatsApp first, a call 24 h later, retries 2 h apart, then HR after the last try', () => {
  const c = cand(), s = only(['resign']);
  let out = ck.due(c, s, t(-28, 11, 5), ON());
  assert.ok(out[0].wa && !out[0].call);
  assert.equal(ck.due(c, s, t(-27, 10, 0), ON()).length, 0); // before 24 h: nothing
  out = ck.due(c, s, t(-27, 11, 10), ON());
  assert.equal(out.length, 1);
  assert.ok(out[0].call);
  assert.match(out[0].call.question, /submitted your resignation/);
  assert.deepEqual(out[0].call.options, ['Yes, submitted', 'Not yet', 'Need help']);
  const a = c.checkins.asks['resign@-28'];
  assert.equal(a.call.tries, 1);
  assert.ok(a.remindedAt); // the call counts as the reminder
  // nobody picked up
  a.call.status = 'no_answer';
  assert.equal(ck.due(c, s, t(-27, 12, 0), ON()).filter(x => x.call).length, 0); // too soon
  out = ck.due(c, s, t(-27, 13, 15), ON());
  assert.ok(out[0] && out[0].call);
  a.call.status = 'busy';
  out = ck.due(c, s, t(-27, 15, 20), ON());
  assert.ok(out[0] && out[0].call);
  assert.equal(a.call.tries, 3);
  a.call.status = 'no_answer';
  assert.equal(ck.due(c, s, t(-27, 18, 0), ON()).filter(x => x.call).length, 0); // no fourth try
  out = ck.due(c, s, t(-26, 15, 25), ON());
  assert.ok(out.some(x => x.escalate));
  assert.match(c.handovers.at(-1).why, /also called 3x/);
});

test('"call first": a call instead of WhatsApp; WhatsApp only when the calls do not get through', () => {
  const c = cand(), s = only(['role']);
  let out = ck.due(c, s, t(7, 11, 5), ON());
  assert.equal(out.length, 1);
  assert.ok(out[0].call && !out[0].wa);
  const a = c.checkins.asks.role;
  for (const h of [13, 15]) { a.call.status = 'no_answer'; out = ck.due(c, s, t(7, h, 10), ON()); assert.ok(out[0].call); }
  a.call.status = 'no_answer';
  out = ck.due(c, s, t(7, 17, 15), ON());
  assert.ok(out[0].wa, 'WhatsApp after three missed calls');
  assert.equal(a.via, 'call+whatsapp');
  assert.equal(c.checkins.pending.key, 'role');
});

test('"call first" outside calling hours waits, then goes on WhatsApp after a day', () => {
  const c = cand(), s = only(['role']);
  const shut = { calls: { on: true, ok: false, left: 5 } };
  assert.equal(ck.due(c, s, t(7, 11, 5), shut).length, 0);
  const out = ck.due(c, s, t(8, 11, 10), shut);
  assert.ok(out[0].wa);
});

test('"WhatsApp and a call": the evening-before details go on WhatsApp and the call follows', () => {
  const c = cand(), s = only(['eve']);
  const out = ck.due(c, s, t(-1, 18, 5), ON());
  assert.ok(out.find(x => x.wa));
  assert.ok(out.find(x => x.call));
  assert.match(out.find(x => x.call).call.question, /See you tomorrow/);
  assert.doesNotMatch(out.find(x => x.call).call.question, /https?:/); // links stay on WhatsApp
});

test('at most one call per candidate per run, and the run budget is respected', () => {
  const c = cand(), s = only(['role', 'intros']);
  s.items.find(i => i.id === 'intros').call = 'call';
  const ctx = { calls: { on: true, ok: true, left: 5 } };
  const out = ck.due(c, s, t(7, 15, 5), ctx);
  assert.equal(out.filter(x => x.call).length, 1);
  assert.equal(ck.due(cand(), s, t(7, 15, 5), { calls: { on: true, ok: true, left: 0 } }).filter(x => x.call).length, 0);
});

test('answers given on the call complete the step; red answers alert HR', () => {
  const s = only(['resign', 'relieving', 'day1-survey']);
  const c = cand();
  ck.markCalled(c, 'resign@-28', 'call-1', 'hr@example.com');
  let r = ck.callResult(c, s, 'resign@-28', { status: 'answered', callId: 'call-1' }, 'need help');
  assert.equal(r.value, 'Need help');
  assert.equal(r.flagged, true);
  assert.match(c.handovers.at(-1).why, /Need help.*answered by call/);
  ck.callResult(c, s, 'relieving', { status: 'answered', callId: 'call-2' }, '25/11/2026');
  assert.equal(c.prejoin.relievingDate.value, '2026-11-25');
  r = ck.callResult(c, s, 'day1-survey', { status: 'answered', callId: 'call-3' }, 'I would say 2');
  assert.equal(r.value, '2');
  assert.equal(r.flagged, true);
  r = ck.callResult(c, s, 'resign@-21', { status: 'no_answer', callId: 'call-4' }, '');
  assert.equal(r.recorded, false);
  assert.equal(c.checkins.asks['resign@-21'].call.status, 'no_answer');
  assert.equal(ck.normalizeAnswer({ answer: 'buttons', options: ['Yes', 'Not yet'] }, 'not answered'), '');
});

test('scheduler places the call through LiveKit with the step script; a failed start is undone', async () => {
  const store = getStore();
  const id = 'wa-917000000001';
  await store.put('journeys', 'northpeak', { client: 'northpeak', checkins: only(['role']) }, { name: 't' });
  const c = Object.assign(cand(), { clockOffsetMs: t(7, 11, 5) - Date.now() });
  await store.put('candidates', id, c, { name: 't' });
  seen.length = 0;
  const plans = { __calls: { on: true, left: 5 } };
  const n = await run.runCandidate(store, id, c, plans, Date.now());
  assert.equal(n, 1);
  const dispatch = seen.find(x => /CreateDispatch/.test(x.url));
  const meta = JSON.parse(dispatch.body.metadata);
  assert.equal(meta.purpose, 'checkin');
  assert.equal(meta.step.key, 'role');
  assert.match(meta.note, /onboarding step "Role clarity"/); // older voice agents follow the note
  assert.ok(c.checkins.asks.role.call.callId);
  assert.equal(plans.__calls.left, 4);
  assert.equal(c.lastCall.status, 'dialing');

  // LiveKit down: the step goes back to "not sent" and is tried again later
  livekitOk = false;
  const c2 = Object.assign(cand(), { phone: '917000000002', clockOffsetMs: t(7, 11, 5) - Date.now() });
  await store.put('candidates', 'wa-917000000002', c2, { name: 't' });
  await run.runCandidate(store, 'wa-917000000002', c2, { __calls: { on: true, left: 5 } }, Date.now());
  livekitOk = true;
  assert.equal(c2.checkins.asks.role, undefined);
});

test('the voice agent reports back: the answer completes the step; HR "Call now" works with Automatic calls off', async () => {
  const store = getStore();
  const id = 'wa-917000000003';
  await store.put('journeys', 'northpeak', { client: 'northpeak', checkins: only(['resign'], false) }, { name: 't' });
  await store.put('candidates', id, Object.assign(cand(), { phone: '917000000003' }), { name: 't' });
  const r = await run.checkinAction('call', { candidateId: id, key: 'resign@-28' }, { name: 'hr@example.com' });
  assert.equal(r.status, 200);
  let c = (await store.get('candidates', id)).data;
  assert.equal(c.checkins.asks['resign@-28'].call.status, 'dialing');
  const res = await calls.result({ callId: r.body.callId, status: 'answered', transcript: [{ role: 'agent', text: 'Have you resigned?' }, { role: 'candidate', text: 'Haan, kal submit kar diya' }], answers: { answer: 'Yes, submitted' } }, 'call-secret-for-tests');
  assert.equal(res.status, 200);
  c = (await store.get('candidates', id)).data;
  assert.equal(c.checkins.asks['resign@-28'].answer, 'Yes, submitted');
  assert.equal(c.checkins.asks['resign@-28'].by, 'call');
  assert.equal(c.prejoin.resignation.value, 'Yes, submitted');
  const msg = (await store.get('messages', 'o-' + r.body.callId)).data;
  assert.match(msg.text, /Step answered on the call: Yes, submitted/);
  // a manager step cannot be called
  const bad = await run.checkinAction('call', { candidateId: id, key: 'mgr-pulse@14' }, { name: 'hr@example.com' });
  assert.ok(bad.status === 400 || bad.status === 404);
});

test('call scripts: fields to extract follow the step\'s answer type', () => {
  assert.match(calls.stepFields({ answer: 'buttons', options: ['Yes', 'Not yet'] }), /exactly one of: "Yes" \/ "Not yet"/);
  assert.match(calls.stepFields({ answer: 'rating' }), /1-5/);
  assert.match(calls.stepBrief({ title: 'Travel', question: 'Do you need travel?', answer: 'buttons', options: ['No', 'Yes'] }), /possible answers are: No, Yes/);
  assert.equal(calls.cleanStep({ key: '', question: 'x' }), null);
});
