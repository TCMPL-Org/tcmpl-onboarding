'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DEV_MEMORY_STORE = '1';
delete process.env.COSMOS_CONNECTION_STRING;
delete process.env.WHATSAPP_NUDGE_TEMPLATE;
delete process.env.WHATSAPP_ALUMNI_TEMPLATE;
process.env.WHATSAPP_TOKEN = 't'; process.env.WHATSAPP_PHONE_NUMBER_ID = '1';
process.env.ACS_CONNECTION_STRING = 'endpoint=https://x.communication.azure.com/;accesskey=abc';
process.env.ACS_SENDER = 'DoNotReply@test.azurecomm.net';
process.env.LINK_SECRET = 'link-secret-for-tests';

const email = require('../src/lib/email');
const wa = require('../src/lib/whatsapp');
const blob = require('../src/lib/blob');
const conversations = require('../src/lib/conversations');
const modules = require('../src/lib/modules');
const exit = require('../src/lib/exit');
const R = require('../src/lib/exit/rules');
const { getStore } = require('../src/lib/store');

const user = { name: 'hr@x' };
const mails = [], sent = [];
email._setClient({ beginSend: async m => { mails.push(m); return { pollUntilDone: async () => ({ id: 'e' + mails.length, status: 'Succeeded' }) }; } });
wa.sendText = async (to, t) => { sent.push([to, t]); return { id: 'w' + sent.length }; };
wa.sendButtons = async (to, t, b) => { sent.push([to, t + ' [' + b.join('|') + ']']); return { id: 'w' + sent.length }; };
wa.uploadMedia = async () => 'media';
wa.sendDocument = async () => ({ id: 'wd' });
wa.downloadMedia = async () => ({ buffer: Buffer.from('fake-jpeg'), mime: 'image/jpeg' });
const files = {};
blob.storageConfigured = () => true;
blob.putFile = async (p, b, t) => { files[p] = { buffer: b, contentType: t }; return p; };
blob.getFile = async p => files[p];

const act = (action, body) => exit.action({ action, body, user });
let n = 0;
const say = (from, text, extra) => conversations.handleInbound(Object.assign({ id: 'wamid.' + (++n), from, type: 'text', text }, extra));
const last = to => (sent.filter(x => x[0] === to).pop() || [])[1] || '';
const store = () => getStore();
const caseOf = async phone => (await store().list('exit_cases')).map(r => r.data).filter(k => k.employee.phone === phone).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];

test('setup: Exit on, employee master, contacts', async () => {
  await modules.httpAction({ action: 'save', body: { client: 'northpeak', exit: true }, user });
  await store().put('master', 'northpeak', { client: 'northpeak', rows: [
    ['NP1', 'Anil Kumar', 'Sales Head', 'Sales', '', 'anil@np.com', '9800000001', 'Manager'],
    ['NP2', 'Rahul Mehta', 'Area Manager', 'Sales', 'NP1', 'rahul@mail.com', '9800000002', ''],
    ['NP3', 'Sana Shaikh', 'Analyst', 'Finance', 'NP1', 'sana@mail.com', '9800000003', ''],
    ['NP4', 'Joy Das', 'Executive', 'Ops', 'NP1', '', '9800000004', ''],
    ['NP5', 'New Joiner', 'Executive', 'Ops', 'NP1', '', '9800000005', '']
  ] }, user);
  const s = (await act('setup', { client: 'northpeak' })).jsonBody.setup;
  Object.assign(s.contacts, { company: 'Northpeak', hr: 'hr@np.com', payroll: 'payroll@np.com' });
  s.people.find(p => p.role === 'HR business partner').contact = 'Neha Kapoor <neha@np.com>';
  await act('setup-save', { client: 'northpeak', setup: s });
});

test('"I want to resign" from someone not in a master stays with onboarding', async () => {
  assert.equal(await modules.route({ id: 'x', from: '919811111111', type: 'text', text: 'I want to resign' }, store()), '');
  assert.equal(await exit.claims({ from: '919800000002', text: 'hello' }, store()), false); // known employee, but no resignation words
});

test('a new joiner still in onboarding is left to onboarding', async () => {
  await store().put('candidates', 'wa-919800000005', { phone: '919800000005', stage: 'Offer accepted', profile: { doj: R.addDays(R.todayIst(), 10) } }, user);
  assert.equal(await exit.claims({ from: '919800000005', text: 'I want to resign' }, store()), false);
});

test('resign formally on WhatsApp: private menu, date told, notice shown, case opened and HR alerted', async () => {
  await say('919800000002', 'Hi, I want to resign');
  let k = await caseOf('919800000002');
  assert.equal(k.status, 'intent');
  assert.match(last('919800000002'), /stays private.*\[Resign formally\|Talk to HR first\|Not now\]/s);
  assert.equal(await store().get('candidates', 'wa-919800000002'), null);
  await say('919800000002', 'Resign formally');
  assert.match(last('919800000002'), /Have you already told your manager/);
  await say('919800000002', 'sometime');
  assert.match(last('919800000002'), /Please reply with a date/);
  await say('919800000002', 'yesterday');
  assert.match(last('919800000002'), /Your notice is \d+ days, counted from/);
  await say('919800000002', 'as per notice');
  k = await caseOf('919800000002');
  assert.equal(k.status, 'open');
  assert.equal(k.source, 'WhatsApp');
  assert.equal(k.first, R.addDays(R.todayIst(), -1));
  assert.equal(k.employee.managerEmail, 'anil@np.com');
  assert.equal(k.lwd, R.addDays(k.noticeStart, k.noticeDays));
  assert.ok(k.plan.length > 5);
  assert.ok(k.alerts.some(a => /New resignation on WhatsApp/.test(a.why)));
  assert.ok(mails.some(m => /hr@np\.com/.test(JSON.stringify(m.recipients.to))));
  assert.match(last('919800000002'), /Your resignation is recorded with last working day/);
});

test('talk to HR first, and not now', async () => {
  await say('919800000003', 'thinking about my notice period');
  await say('919800000003', 'Talk to HR first');
  let k = await caseOf('919800000003');
  assert.equal(k.intent.step, 'hr');
  assert.ok(k.alerts.some(a => /confidential call/.test(a.why)));
  await say('919800000003', 'Any update?');
  k = await caseOf('919800000003');
  assert.ok(k.alerts.some(a => /wrote again/.test(a.why)));
  await say('919800000004', 'I am quitting');
  await say('919800000004', 'Not now');
  assert.equal((await caseOf('919800000004')).status, 'cancelled');
  assert.match(last('919800000004'), /Nothing has been recorded/);
});

test('asset photos are stored privately and listed; DONE closes the step', async () => {
  const k0 = await caseOf('919800000002');
  await act('send', { id: k0.id, key: 'assets' });
  await conversations.handleInbound({ id: 'wamid.p1', from: '919800000002', type: 'image', text: 'Laptop', media: { id: 'm1', mime: 'image/jpeg', caption: 'Laptop' } });
  await conversations.handleInbound({ id: 'wamid.p2', from: '919800000002', type: 'image', text: '', media: { id: 'm2', mime: 'image/jpeg' } });
  assert.match(last('919800000002'), /received item 2/);
  await say('919800000002', 'done');
  const k = await caseOf('919800000002');
  assert.equal(k.assets.length, 2);
  assert.match(k.assets[0].path, new RegExp(`^exit/northpeak/${k.id}/assets/1-`));
  assert.equal(k.plan.find(s => s.key === 'assets').status, 'done');
  assert.match(last('919800000002'), /2 items are recorded/);
  const f = await act('asset', { id: k.id, index: 0 });
  assert.equal(Buffer.from(f.jsonBody.base64, 'base64').toString(), 'fake-jpeg');
  assert.ok(!k.alerts.some(a => /Photo/.test(a.why))); // photos are not HR alerts
});

test('exit interview: one question at a time, invalid answers asked again, stored for group reports', async () => {
  const k0 = await caseOf('919800000002');
  await act('send', { id: k0.id, key: 'interview' });
  assert.match(last('919800000002'), /Six short questions.*Overall, how was your experience/s);
  for (const [a, expect] of [['7', /from 1 \(poor\) to 5/], ['4', /main reason/], ['1', /supported/], ['3', /keep you/], ['A clearer growth path', /recommend/], ['8', /coming back/], ['maybe', /Thank you for your time/]]) {
    await say('919800000002', a);
    assert.match(last('919800000002'), expect);
  }
  const iv = (await store().get('exit_interviews', k0.id)).data;
  assert.deepEqual(iv.answers, { q1: 4, q2: 'Career growth', q3: 3, q4: 'A clearer growth path', q5: 8, q6: 'Maybe' });
  assert.equal(iv.dept, 'Sales');
  let rep = (await act('interviews', { client: 'northpeak', groupBy: 'dept' })).jsonBody;
  assert.deepEqual([rep.total, rep.groups.length, rep.hiddenGroups], [1, 0, 1]); // under the minimum group size: hidden
  const s = (await act('setup', { client: 'northpeak' })).jsonBody.setup;
  s.interview.threshold = 1;
  await act('setup-save', { client: 'northpeak', setup: s });
  rep = (await act('interviews', { client: 'northpeak', groupBy: 'dept' })).jsonBody;
  assert.equal(rep.groups[0].group, 'Sales');
  assert.equal(rep.groups[0].answers.q1, 4);
});

test('alumni: YES joins with consent, jobs shared by email, STOP leaves', async () => {
  const k0 = await caseOf('919800000002');
  await act('send', { id: k0.id, key: 'alumni' });
  await say('919800000002', 'Yes please');
  assert.match(last('919800000002'), /Welcome to the alumni network/);
  let list = (await act('alumni', { client: 'northpeak' })).jsonBody.items;
  assert.equal(list.length, 1);
  assert.match(list[0].consent, /Replied "Yes please"/);
  mails.length = 0;
  const r = await act('alumni-share', { client: 'northpeak', role: 'Area Manager, Pune', link: 'https://jobs.example/123' });
  assert.deepEqual([r.jsonBody.alumni, r.jsonBody.emails, r.jsonBody.whatsapps], [1, 1, 0]);
  assert.match(mails[0].content.subject, /Opening at Northpeak: Area Manager, Pune/);
  await act('fnf-status', { id: k0.id, status: 'Closed' });
  await say('919800000002', 'STOP');
  list = (await act('alumni', { client: 'northpeak' })).jsonBody.items;
  assert.equal(list.length, 0);
  assert.match(last('919800000002'), /left the alumni network/);
});

test('approvals tab: pending list, remind, HR decision, escalation to the delegate after the reply time', async () => {
  const r = await act('raise', { client: 'northpeak', case: { employee: { code: 'NP9', name: 'Tara Nair', mobile: '9800000009', level: 'L2', dept: 'Ops', manager: 'Anil Kumar', managerEmail: 'anil@np.com' }, typeId: 'resign', raisedBy: 'HR', formal: R.todayIst(), requestedLwd: R.addDays(R.todayIst(), 10) } });
  const id = r.jsonBody.case.id;
  await act('send', { id, key: 'approval' });
  let items = (await act('approvals', { client: 'northpeak' })).jsonBody.items.filter(x => x.caseId === id);
  assert.deepEqual(items.map(x => x.action).sort(), ['Accept resignation', 'Notice waiver']);
  assert.ok(items.every(x => !x.overdue && x.chain[0].status === 'Asked'));
  mails.length = 0;
  const waiver = items.find(x => x.action === 'Notice waiver');
  await act('approval-remind', { id, approvalId: waiver.approvalId });
  assert.equal(mails.filter(m => /^Approval: Notice waiver/.test(m.content.subject)).length, 1);
  // 48 hours later nobody has answered "Accept resignation": the delegate (HR business partner) is asked
  mails.length = 0;
  await exit.tick(store(), Date.now() + 49 * 3600e3);
  assert.ok(mails.some(m => /neha@np\.com/.test(JSON.stringify(m.recipients.to)) && /no reply from Anil Kumar/.test(m.content.subject)));
  let k = (await act('case', { id })).jsonBody.case;
  assert.ok(k.alerts.some(a => /no reply from Anil Kumar in 48 hours \(HR business partner asked\)/.test(a.why)));
  await act('approval-decide', { id, approvalId: waiver.approvalId, decision: 'no', note: 'Busy quarter' });
  k = (await act('case', { id })).jsonBody.case;
  assert.equal(k.approvals.find(a => a.action === 'Notice waiver').status, 'Rejected');
  assert.equal(k.lwd, k.noticeLwd);
  assert.equal((await act('approval-decide', { id, approvalId: waiver.approvalId, decision: 'yes' })).status, 409);
  items = (await act('approvals', { client: 'northpeak' })).jsonBody.items.filter(x => x.caseId === id);
  assert.deepEqual(items.map(x => x.action), ['Accept resignation']);
  const w = (await act('who', { client: 'northpeak', action: 'Notice waiver', level: 'L4', dept: 'Sales' })).jsonBody;
  assert.deepEqual(w.chain.map(s => s.role), ['Manager', 'Sales head', 'HR head']);
});

test('dashboard: tiles, months, departments, tenure, interview figures', async () => {
  const d = (await act('dashboard', { client: 'northpeak', months: 12 })).jsonBody;
  assert.equal(d.months.length, 12);
  assert.ok(d.tiles.open >= 1);
  assert.equal(d.tiles.thinking, 1); // Sana is waiting for the HR call
  assert.equal(d.tiles.alumni, 0);
  assert.ok(d.byDept.some(([g]) => g === 'Ops'));
  assert.ok(d.byTenure.length >= 1);
  assert.ok(d.tiles.pendingApprovals >= 1);
});
