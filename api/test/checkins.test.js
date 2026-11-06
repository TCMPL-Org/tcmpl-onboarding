'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DEV_MEMORY_STORE = '1';
delete process.env.COSMOS_CONNECTION_STRING;
const ck = require('../src/lib/checkins');
const IST = 330 * 60000;
// DOJ 1 Dec 2026; t(day, hh, mm) = that day relative to DOJ, IST.
const t = (day, hh, mm = 0) => Date.UTC(2026, 11, 1 + day, hh, mm) - IST;
const cand = () => ({ phone: '917000000001', name: 'Jeet Pawar', email: 'jeet@example.com', company: 'Northpeak', profile: { doj: '2026-12-01', client: 'northpeak', first: 'Jeet' } });
const setup = () => {
  const s = ck.defaults();
  s.joining = { reportTime: '9:30 AM', address: 'Tower B, Sector 44, Gurugram', mapUrl: '', poc: 'Priya Malhotra', pocPhone: '+91 98100 00000', dress: '', bring: 'PAN card' };
  s.contacts = { manager: 'Arjun <arjun@example.com>', hr: 'hr@example.com', buddy: '' };
  return s;
};
const link = p => `https://x/api/confirm?t=${p.k}.${p.v}`;

test('resignation check repeats weekly until "Yes, submitted", with buttons; "Need help" alerts HR', () => {
  const c = cand(), s = setup();
  let out = ck.due(c, s, t(-28, 11, 5), { link, candidateId: 'wa-1' });
  assert.equal(out.length, 1);
  assert.equal(out[0].key, 'resign@-28');
  assert.deepEqual(out[0].wa[0].buttons, ['Yes, submitted', 'Not yet', 'Need help']);
  assert.match(out[0].wa[0].text, /Hi Jeet/);
  let r = ck.onInbound(c, s, { text: 'Not yet' });
  assert.equal(r.handled, true);
  assert.equal(c.prejoin.resignation.value, 'Not yet');
  assert.equal(c.handovers, undefined);
  out = ck.due(c, s, t(-21, 11, 5), { link });
  assert.ok(out.some(x => x.key === 'resign@-21'));
  // only one WhatsApp question at a time: relieving date waits
  assert.ok(!out.some(x => x.key === 'relieving'));
  ck.onInbound(c, s, { text: 'yes, submitted' });
  assert.equal(c.prejoin.resignation.value, 'Yes, submitted');
  out = ck.due(c, s, t(-21, 15, 0), { link });
  assert.equal(out[0].key, 'relieving');
  r = ck.onInbound(c, s, { text: 'my last day is 28/11/2026' });
  assert.equal(c.prejoin.relievingDate.value, '2026-11-28');
  assert.match(r.replies[0].text, /28 November 2026/);
  out = ck.due(c, s, t(-14, 11, 5), { link });
  assert.ok(!out.some(x => x.key === 'resign@-14'), 'stops after "Yes, submitted"');
  assert.equal(c.checkins.asks['resign@-14'].skipped, true);
});

test('relieving date on or after joining is flagged to HR', () => {
  const c = cand(), s = setup();
  c.checkins = { asks: {}, pending: { key: 'relieving', at: new Date(t(-21, 11)).toISOString() } };
  ck.onInbound(c, s, { text: '3 Dec' });
  assert.equal(c.prejoin.relievingDate.value, '2026-12-03');
  assert.match(c.handovers[0].why, /after the joining date/);
});

test('joining details go on WhatsApp and email with point of contact and a Google Maps link', () => {
  const c = cand(), s = setup();
  c.checkins = { asks: {} };
  for (const o of ck.occurrences(s)) if (o.day < -3) c.checkins.asks[o.key] = { skipped: true };
  const out = ck.due(c, s, t(-3, 12, 5), { link, candidateId: 'wa-1' });
  const j = out.find(x => x.key === 'joining-info');
  assert.match(j.wa[0].text, /9:30 AM/);
  assert.match(j.wa[0].text, /Priya Malhotra \(\+91 98100 00000\)/);
  assert.match(j.wa[0].text, /google\.com\/maps\/search\/\?api=1&query=Tower%20B/);
  assert.equal(j.email.to, 'jeet@example.com');
  assert.equal(j.email.buttons.length, 2);
});

test('manager fortnightly check-in is an email with one-click answers; reminder then escalation', () => {
  const c = cand(), s = setup();
  c.checkins = { asks: {} };
  for (const o of ck.occurrences(s)) if (o.day < 14) c.checkins.asks[o.key] = { skipped: true };
  let out = ck.due(c, s, t(14, 10, 5), { link, candidateId: 'wa-1', waBusy: true });
  const m = out.find(x => x.key === 'mgr-pulse@14');
  assert.equal(m.email.to, 'Arjun <arjun@example.com>');
  assert.deepEqual(m.email.buttons.map(b => b.label), ['Settling in well', 'Some concerns', 'Serious concerns']);
  assert.ok(!m.wa);
  assert.ok(!out.some(x => x.key === 'pulse@14'), 'candidate WhatsApp waits while another question is open');
  out = ck.due(c, s, t(15, 10, 10), { link, waBusy: true });
  assert.ok(out.some(x => x.key === 'mgr-pulse@14' && x.reminder));
  out = ck.due(c, s, t(16, 10, 15), { link, waBusy: true });
  assert.ok(out.some(x => x.key === 'mgr-pulse@14' && x.escalate));
  assert.match(c.handovers.at(-1).why, /Fortnightly check-in \(manager\)/);
  // manager answers by email link
  const r = ck.record(c, s, 'mgr-pulse@28', 'Some concerns', 'manager (email)');
  assert.equal(r.flagged, true);
});

test('ratings: 1-5 replies; low scores alert HR; infra list expands', () => {
  const c = cand(), s = setup();
  c.checkins = { asks: {}, pending: { key: 'day1-survey', at: new Date(t(0, 18)).toISOString() } };
  let r = ck.onInbound(c, s, { text: 'hmm' });
  assert.match(r.replies[0].text, /1 to 5/);
  ck.onInbound(c, s, { text: '2' });
  assert.equal(c.checkins.asks['day1-survey'].answer, '2');
  assert.match(c.handovers[0].why, /rated 2 of 5/);
  const keys = ck.occurrences(s).map(o => o.key);
  assert.ok(keys.includes('infra-canteen-coupons'));
  assert.ok(keys.includes('pulse@84') && !keys.includes('pulse@98'));
});

test('induction reminder only while induction is open; quiet hours respected', () => {
  const c = cand(), s = setup();
  c.checkins = { asks: {} };
  for (const o of ck.occurrences(s)) if (o.day < 5 || o.key !== 'induction-due@5') c.checkins.asks[o.key] = c.checkins.asks[o.key] || (o.day < 5 ? { skipped: true } : undefined);
  assert.deepEqual(ck.due(c, s, t(5, 22, 0), { pending: ['Welcome deck'] }).filter(x => x.wa), []);
  const out = ck.due(c, s, t(5, 10, 5), { pending: ['Welcome deck', 'Quiz'] });
  const ir = out.find(x => x.key === 'induction-due@5');
  assert.match(ir.wa[0].text, /Still open: Welcome deck, Quiz/);
  assert.match(ir.wa[0].text, /22 December 2026/);
  ck.due(c, s, t(8, 10, 5), { pending: [] });
  assert.equal(c.checkins.asks['induction-due@8'].skipped, true);
});

test('setup is sanitised and dates parse', () => {
  const s = ck.cleanSetup({ items: [{ title: 'X', to: 'boss', channel: 'fax', answer: 'buttons', options: ['A very very long option text', 'B'], flag: ['B', 'Z'], day: '7' }], infra: ['Laptop bag'] });
  assert.equal(s.items[0].to, 'candidate');
  assert.equal(s.items[0].channel, 'whatsapp');
  assert.equal(s.items[0].options[0].length, 20);
  assert.deepEqual(s.items[0].flag, ['B']);
  assert.equal(s.items[0].day, 7);
  assert.equal(ck.parseDate('Nov 25', 2026), '2026-11-25');
  assert.equal(ck.parseDate('25-11-26', 2026), '2026-11-25');
});
