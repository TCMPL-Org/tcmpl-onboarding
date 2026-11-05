'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DEV_MEMORY_STORE = '1';
delete process.env.COSMOS_CONNECTION_STRING;
process.env.WHATSAPP_TOKEN = 't'; process.env.WHATSAPP_PHONE_NUMBER_ID = '1';
const induction = require('../src/lib/induction');

const IST = 330 * 60000;
const ist = (d, hh, mm = 0) => Date.UTC(2026, 11, d, hh, mm) - IST; // December 2026, India time
const plan = {
  items: [
    { id: 'hr', day: 0, time: '15:00', mins: 30, title: 'HR connect', owner: 'Priya (HR)', kind: 'session' },
    { id: 'deck', day: 0, time: '10:00', title: 'Welcome deck', kind: 'content', ack: true, material: { id: 'c-abc123', name: 'Welcome.pdf', mime: 'application/pdf' } },
    { id: 'it', day: 1, time: '11:00', title: 'IT security training', kind: 'task' },
    { id: 'quiz', day: 2, time: '11:00', title: 'Know-your-company quiz', kind: 'quiz' }
  ],
  quiz: { questions: [
    { q: 'How long is probation?', options: ['3 months', '6 months', '12 months'], answer: 1 },
    { q: 'Where do HR questions go?', options: ['Email only', 'This WhatsApp', 'Manager'], answer: 1 }
  ], pass: 2 }
};
const cand = () => ({ phone: '917000000001', name: 'Jeet Pawar', profile: { doj: '2026-12-01', client: 'northpeak', first: 'Jeet' } });
const say = (c, text) => induction.onInbound(c, plan, { type: 'text', text });

test('times are India time, and nothing is sent at night or before it is due', () => {
  const c = cand();
  assert.equal(induction.at('2026-12-01', 0, '15:00'), Date.UTC(2026, 11, 1, 9, 30));
  assert.deepEqual(induction.due(c, plan, ist(1, 7)), [], 'before 8 am: quiet');
  assert.deepEqual(induction.due(c, plan, ist(1, 9)), [], 'deck is at 10');
});

test('content: file + "I have read it", acknowledgement marks it done', () => {
  const c = cand();
  const out = induction.due(c, plan, ist(1, 10, 5));
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].msgs[0].file.name, 'Welcome.pdf');
  assert.deepEqual(out[0].msgs[1].buttons, ['I have read it']);
  const r = say(c, 'I have read it');
  assert.equal(r.handled, true);
  assert.equal(c.induction.items.deck.status, 'done');
});

test('session: reminder before, "did it happen?" after, Not yet → asked again next day → escalated', () => {
  const c = cand();
  induction.due(c, plan, ist(1, 10, 5)); say(c, 'I have read it');
  let out = induction.due(c, plan, ist(1, 14, 10));
  assert.match(out[0].msgs[0].text, /reminder: \*HR connect\* with Priya \(HR\) is .* at 3:00 pm/);
  assert.deepEqual(induction.due(c, plan, ist(1, 15, 30)), [], 'meeting still on');
  out = induction.due(c, plan, ist(1, 16, 5));
  assert.deepEqual(out[0].msgs[0].buttons, ['Yes', 'Not yet', 'Rescheduled']);
  let r = say(c, 'Not yet');
  assert.match(r.replies[0].text, /remind Priya \(HR\)/);
  assert.deepEqual(induction.due(c, plan, ist(1, 18)), [], 'not asked again the same day');
  out = induction.due(c, plan, ist(2, 16, 10));
  assert.equal(out[0].id, 'hr');
  say(c, 'Not yet');
  induction.due(c, plan, ist(3, 16, 20));
  assert.equal(c.induction.items.hr.status, 'escalated');
  assert.match(c.handovers[0].why, /HR connect.*not confirmed/);
});

test('session rescheduled: new time, reminder and check follow the new time', () => {
  const c = cand();
  c.induction = { items: { deck: { status: 'done' } } };
  induction.due(c, plan, ist(1, 14, 10));
  induction.due(c, plan, ist(1, 16, 5));
  say(c, 'Rescheduled');
  const r = say(c, '3/12 11 am');
  assert.match(r.replies[0].text, /3 Dec at 11:00 am/);
  const out = induction.due(c, plan, ist(3, 10, 10));
  assert.match(out[0].msgs[0].text, /HR connect/);
  assert.match(out[0].msgs[0].text, /11:00 am/);
});

test('quiz: questions with buttons, wrong answer feedback, fail → try again → pass', () => {
  const c = cand();
  c.induction = { items: { deck: { status: 'done' }, hr: { status: 'done' }, it: { status: 'done' } } };
  const out = induction.due(c, plan, ist(3, 11, 5));
  assert.deepEqual(out[0].msgs[1].buttons, ['3 months', '6 months', '12 months']);
  let r = say(c, '3 months');
  assert.match(r.replies[0].text, /right answer is: 6 months/);
  r = say(c, 'This WhatsApp');
  assert.match(r.replies[0].text, /1\/2/);
  assert.deepEqual(r.replies[0].buttons, ['Try again', 'Later']);
  say(c, 'Try again');
  say(c, '6 months');
  r = say(c, '2');
  assert.match(r.replies[0].text, /2\/2.*passed/s);
  assert.equal(c.induction.items.quiz.status, 'done');
  assert.equal(c.induction.items.quiz.score, '2/2');
});

test('task: Need help is handed over; old milestones are skipped, not sent late', () => {
  const c = cand();
  c.induction = { items: { deck: { status: 'done' }, hr: { status: 'done' } } };
  const out = induction.due(c, plan, ist(2, 11, 5));
  assert.deepEqual(out[0].msgs[0].buttons, ['Yes', 'Not yet']);
  const late = cand();
  induction.due(late, plan, ist(10, 12));
  assert.equal(late.induction.items.deck.status, 'skipped');
  assert.equal(late.induction.items.quiz.status, 'skipped');
});

test('delivery holds messages when the 24-hour window is closed and sends them when the candidate writes', async () => {
  const wa = require('../src/lib/whatsapp');
  const run = require('../src/lib/induction-run');
  const { getStore } = require('../src/lib/store');
  const sent = [];
  wa.sendButtons = async () => { const e = new Error('Re-engagement message'); e.detail = { code: 131047 }; throw e; };
  wa.sendText = async (to, t) => { sent.push(t); return { id: 'x' }; };
  const c = cand();
  const r = await run.deliver(getStore(), 'wa-917000000001', c, [{ text: 'Did it happen?', buttons: ['Yes', 'Not yet'] }], { name: 't' }, 'HR connect');
  assert.equal(r.held, 1);
  assert.equal(c.induction.waiting.length, 1);
  const back = induction.onInbound(c, plan, { type: 'text', text: 'hi' });
  assert.equal(back.handled, true);
  assert.equal(back.replies[0].text, 'Did it happen?');
  assert.equal(c.induction.waiting.length, 0);
});

test('scheduler endpoint needs the secret', async () => {
  const handlers = require('../src/lib/handlers');
  process.env.CRON_SECRET = 'abc123';
  assert.equal((await handlers.cronTick({ key: 'nope' })).status, 401);
  assert.equal((await handlers.cronTick({ key: 'abc123' })).status, 200);
});
