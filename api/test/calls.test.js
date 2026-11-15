'use strict';
// Phone calls: HR starts a call (LiveKit room + agent dispatch), the voice agent posts the outcome back.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.DEV_MEMORY_STORE = '1';
delete process.env.COSMOS_CONNECTION_STRING;
process.env.LIVEKIT_URL = 'wss://tcmpl-onboarding-test.livekit.cloud';
process.env.LIVEKIT_API_KEY = 'APIkey123';
process.env.LIVEKIT_API_SECRET = 'secret-for-tests';
process.env.CALL_AGENT_SECRET = 'call-secret-for-tests';
process.env.CALL_HOURS = '0-24';

const { getStore } = require('../src/lib/store');
const calls = require('../src/lib/calls');
const handlers = require('../src/lib/handlers');
const user = { id: 'u1', name: 'hr@example.com', roles: ['authenticated'] };

const seen = [];
const realFetch = global.fetch;
test.before(() => {
  global.fetch = async (url, opts) => {
    seen.push({ url: String(url), opts, body: JSON.parse(opts.body) });
    return { ok: true, json: async () => ({}) };
  };
});
test.after(() => { global.fetch = realFetch; });

test('health shows calling once LiveKit is configured', () => {
  assert.equal(handlers.health().jsonBody.calls, true);
});

test('HR starts a call: room created, agent dispatched with the candidate details, chat shows "calling"', async () => {
  const store = getStore();
  await store.put('facts', 'northpeak', { facts: 'Address: Baner office, Pune\nReporting time: 9:30 am\nContact: Sr. Mary Joseph' }, user);
  await store.put('candidates', 'wa-917623026914', { phone: '917623026914', name: 'Anjali Gowda', first: 'Anjali', company: 'Northpeak', role: 'Staff Nurse, ICU', agentName: 'Northpeak HR', doj: '2026-12-01', profile: { client: 'northpeak', doj: '2026-12-01' } }, user);
  seen.length = 0;
  const r = await calls.start({ candidateId: 'wa-917623026914', purpose: 'confirm' }, user);
  assert.equal(r.status, 200);
  assert.match(seen[0].url, /^https:\/\/tcmpl-onboarding-test\.livekit\.cloud\/twirp\/livekit\.RoomService\/CreateRoom$/);
  assert.match(seen[1].url, /AgentDispatchService\/CreateDispatch$/);
  assert.equal(seen[1].body.agent_name, 'tcmpl-onboarding-caller');
  const meta = JSON.parse(seen[1].body.metadata);
  assert.equal(meta.phone, '+917623026914');
  assert.equal(meta.purpose, 'confirm');
  assert.equal(meta.doj, '1 December 2026');
  assert.equal(meta.address, 'Baner office, Pune');
  assert.equal(meta.reportingTime, '9:30 am');
  assert.equal(meta.contact, 'Sr. Mary Joseph');
  // the token is a valid HS256 JWT for the project key
  const jwt = seen[1].opts.headers.authorization.replace('Bearer ', '').split('.');
  const sig = crypto.createHmac('sha256', 'secret-for-tests').update(jwt[0] + '.' + jwt[1]).digest('base64url');
  assert.equal(sig, jwt[2]);
  const claims = JSON.parse(Buffer.from(jwt[1], 'base64url').toString());
  assert.equal(claims.iss, 'APIkey123');
  assert.equal(claims.video.roomAdmin, true);
  const c = (await store.get('candidates', 'wa-917623026914')).data;
  assert.equal(c.lastCall.status, 'dialing');
  const m = (await store.get('messages', 'o-' + r.body.callId)).data;
  assert.match(m.text, /calling \+917623026914/);
  // a second call while the first is still ringing is refused
  assert.equal((await calls.start({ candidateId: 'wa-917623026914', purpose: 'confirm' }, user)).body.error, 'call_in_progress');
});

test('the agent reports back: answers in the chat, HR items raised, transcript kept; wrong key refused', async () => {
  const store = getStore();
  const id = 'wa-917623026915';
  await store.put('candidates', id, { phone: '917623026915', name: 'Ravi', profile: { client: 'northpeak', doj: '2026-12-01' } }, user);
  const s = await calls.start({ candidateId: id, purpose: 'eve' }, user);
  const callId = s.body.callId;
  const body = {
    callId, candidateId: id, status: 'answered', durationSec: 95,
    answers: { coming_tomorrow: 'yes' }, flags: ['Asks whether parking is free'], callback: '',
    transcript: [{ role: 'agent', text: 'Hi Ravi, this is the onboarding assistant.' }, { role: 'candidate', text: 'Haan, bataiye.' }]
  };
  assert.equal((await calls.result(body, 'wrong')).status, 401);
  const r = await calls.result(body, 'call-secret-for-tests');
  assert.equal(r.status, 200);
  const m = (await store.get('messages', 'o-' + callId)).data;
  assert.match(m.text, /Day-before-joining call: answered \(1:35\)/);
  assert.match(m.text, /coming tomorrow: yes/);
  assert.match(m.text, /For HR: Asks whether parking is free/);
  assert.equal(m.transcript.length, 2);
  const c = (await store.get('candidates', id)).data;
  assert.equal(c.lastCall.status, 'answered');
  assert.equal(c.callAnswers.coming_tomorrow, 'yes');
  assert.ok(c.handovers.some(h => /parking/.test(h.why) && h.open));
  // the same result twice changes nothing
  assert.equal((await calls.result(body, 'call-secret-for-tests')).body.duplicate, true);
});

test('a call that is not answered is recorded as such', async () => {
  const store = getStore();
  const id = 'wa-917623026916';
  await store.put('candidates', id, { phone: '917623026916', name: 'Meera', profile: { client: 'northpeak' } }, user);
  const s = await calls.start({ candidateId: id, purpose: 'noreply' }, user);
  await calls.result({ callId: s.body.callId, status: 'no_answer', sipStatus: '480 Temporarily Unavailable' }, 'call-secret-for-tests');
  const m = (await store.get('messages', 'o-' + s.body.callId)).data;
  assert.match(m.text, /not answered · 480/);
});

test('outside calling hours a call needs confirmation', async () => {
  process.env.CALL_HOURS = '25-26';
  const r = await calls.start({ candidateId: 'wa-917623026916', purpose: 'noreply' }, user);
  assert.equal(r.body.error, 'outside_hours');
  process.env.CALL_HOURS = '0-24';
});
