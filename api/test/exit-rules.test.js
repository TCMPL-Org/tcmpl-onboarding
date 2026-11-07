'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const R = require('../src/lib/exit/rules');
const D = require('../src/lib/exit/defaults');
const S = require('../src/lib/exit/setup');
const C = require('../src/lib/exit/cases');

const setup = D.tcmplDefault();
const emp = (o = {}) => Object.assign({ name: 'Rahul Mehta', code: 'NP1215', mobile: '9812345678', level: 'L3', dept: 'Operations', doj: '2022-01-10', manager: 'Anil Kumar' }, o);

test('dates: valid ISO only, add days, months between', () => {
  assert.equal(R.isoDate('2026-02-30'), '');
  assert.equal(R.isoDate('2026-11-02T10:00'), '2026-11-02');
  assert.equal(R.addDays('2026-12-25', 10), '2027-01-04');
  assert.equal(R.monthsBetween('2026-05-10', '2026-11-09'), 5);
  assert.equal(R.monthsBetween('2026-05-10', '2026-11-10'), 6);
  assert.equal(R.niceDate('2026-11-02'), '2 Nov 2026');
});

test('level ranges and specific rules', () => {
  assert.ok(R.lvlMatch('L3-L5', 'L4'));
  assert.ok(!R.lvlMatch('L3-L5', 'L2'));
  assert.ok(R.lvlMatch('Any', 'L9'));
  const n = R.noticeFor(setup, emp(), '2026-11-02');
  assert.deepEqual([n.days, n.inProb], [60, false]);
  const p = R.noticeFor(setup, emp({ doj: '2026-08-01' }), '2026-11-02');
  assert.deepEqual([p.days, p.inProb], [30, true]);
});

test('notice start: Sales counts from the first conversation, others from the formal date, case override', () => {
  assert.equal(R.startRuleFor(setup, emp({ dept: 'Sales' })).start, 'first');
  assert.equal(R.startRuleFor(setup, emp()).start, 'formal');
  assert.equal(R.startRuleFor(setup, emp(), 'accept').src, 'Set for this case');
});

test('approvals: the most specific rule wins; parallel chains', () => {
  assert.equal(R.approvalRule(setup, 'Notice waiver', emp({ dept: 'Sales' }), 'resign').id, 'a4');
  assert.equal(R.approvalRule(setup, 'Notice waiver', emp({ level: 'L1' }), 'resign').id, 'a2');
  assert.equal(R.approvalRule(setup, 'Recovery waiver', emp(), 'resign', 30000).id, 'a9');
  assert.equal(R.approvalRule(setup, 'Recovery waiver', emp(), 'resign', 1000).id, 'a10');
  const ch = R.chainOf(R.approvalRule(setup, 'Recovery waiver', emp(), 'resign', 30000));
  assert.deepEqual(ch.map(s => [s.role, s.step]), [['Finance head', 1], ['HR head', 1]]);
});

test('case: notice, waiver, approvals and dated plan', () => {
  const { k, errors } = C.build(setup, { employee: emp({ dept: 'Sales' }), typeId: 'resign', raisedBy: 'Employee', first: '2026-10-20T11:30', formal: '2026-11-02', requestedLwd: '2026-12-01' }, { client: 'northpeak' });
  assert.deepEqual(errors, []);
  assert.equal(k.id, 'exit-northpeak-NP1215-20261102');
  assert.equal(k.employee.phone, '919812345678');
  assert.equal(k.noticeStart, '2026-10-20');
  assert.equal(k.noticeLwd, '2026-12-19');
  assert.equal(k.lwd, '2026-12-01');
  assert.equal(k.waiverDays, 18);
  assert.deepEqual(k.approvals.map(a => a.action), ['Accept resignation', 'Notice waiver']);
  assert.deepEqual(k.approvals[1].chain.map(s => s.role), ['Manager', 'Sales head', 'HR head']);
  assert.equal(k.approvals[0].chain[0].person, 'Anil Kumar');
  const by = Object.fromEntries(k.plan.map(s => [s.key, s.date]));
  assert.equal(by.ack, '2026-11-02');
  assert.equal(by.handover, '2026-11-17');
  assert.equal(by.lastday, '2026-12-01');
  assert.equal(by.interview, '2026-12-08');
  assert.ok(k.plan.every((s, i) => i === 0 || (k.plan[i - 1].date + k.plan[i - 1].time) <= (s.date + s.time)));
});

test('case: types without notice, steps that do not apply, and errors', () => {
  const d = C.build(setup, { employee: emp(), typeId: 'death', raisedBy: 'HR', formal: '2026-11-02' }, { client: 'c' }).k;
  assert.equal(d.lwd, '2026-11-02');
  assert.equal(d.noticeDays, 0);
  assert.ok(!d.plan.some(s => ['ack', 'interview', 'alumni', 'lastday'].includes(s.key)));
  const m = C.build(setup, { employee: emp(), typeId: 'misconduct', raisedBy: 'HR', formal: '2026-11-02', lwd: '2026-11-06' }, { client: 'c' }).k;
  assert.deepEqual(m.approvals.map(a => a.action), ['Involuntary separation']);
  assert.ok(!m.plan.some(s => s.key === 'interview'));
  assert.match(C.build(setup, { employee: emp(), typeId: 'misconduct', raisedBy: 'Employee', formal: '2026-11-02' }, { client: 'c' }).errors[0], /cannot raise/);
  assert.ok(C.build(setup, { employee: { name: 'X' }, typeId: 'resign', raisedBy: 'HR', formal: '2026-11-02' }, { client: 'c' }).errors.some(e => /code or a valid mobile/.test(e)));
  assert.ok(C.build(setup, { employee: emp({ mobile: '123' }), typeId: 'resign', raisedBy: 'HR', formal: '2026-11-02' }, { client: 'c' }).errors.some(e => /not valid/.test(e)));
  assert.match(C.build(setup, { employee: emp(), typeId: 'retire', raisedBy: 'HR', formal: '2026-11-02', lwd: '2026-10-01' }, { client: 'c' }).errors[0], /cannot be before/);
});

test('messages are filled from the case', () => {
  const { k } = C.build(setup, { employee: emp(), typeId: 'resign', raisedBy: 'Employee', formal: '2026-11-02' }, { client: 'c' });
  const s = Object.assign({}, setup, { contacts: Object.assign({}, setup.contacts, { company: 'Northpeak' }) });
  assert.equal(R.fill('Hi {first}, last day {lwd} at {company}; notice {notice}. {unknown}', k, s), 'Hi Rahul, last day 1 Jan 2027 at Northpeak; notice 60 days. {unknown}');
});

test('import helpers: dates in any common format, type names from any HRMS', () => {
  assert.equal(C.anyDate('02/11/2026'), '2026-11-02');
  assert.equal(C.anyDate('2-11-2026'), '2026-11-02');
  assert.equal(C.anyDate('2 Nov 2026'), '2026-11-02');
  assert.equal(C.anyDate('46328'), '2026-11-02');
  assert.equal(C.anyDate('nope'), '');
  assert.equal(C.typeFromText(setup, 'Voluntary Resignation').id, 'resign');
  assert.equal(C.typeFromText(setup, 'Superannuation').id, 'retire');
  assert.equal(C.typeFromText(setup, 'Absconding').id, 'abandon');
  assert.equal(C.typeFromText(setup, 'zzz'), null);
});

test('setup is cleaned field by field', () => {
  const s = S.cleanSetup({ types: [{ id: 'x', name: 'Odd', cat: 'Nope', raise: 'Employee, Robot', notice: 'Whatever', interview: 'yes' }, { name: '' }], noticeRules: [{ level: 'L1', prob: '-5', conf: 9999 }], steps: [{ title: 'Ping', stage: 'zz', channel: 'fax', day: 900, time: 'soon', evil: '<script>' }], probationMonths: 'abc' });
  assert.deepEqual(s.types, [{ id: 'x', name: 'Odd', cat: 'Voluntary', raise: 'Employee', notice: 'Serve notice', letters: '', interview: true, alumni: false, announce: 'None', ta: 'After manager confirms' }]);
  assert.deepEqual([s.noticeRules[0].prob, s.noticeRules[0].conf], [0, 365]);
  assert.deepEqual([s.steps[0].stage, s.steps[0].channel, s.steps[0].day, s.steps[0].time, s.steps[0].evil], ['raised', 'both', 365, '11:00', undefined]);
  assert.equal(s.probationMonths, 6);
  assert.equal(s.approvals.length, setup.approvals.length); // missing parts fall back to the TCMPL default
});
