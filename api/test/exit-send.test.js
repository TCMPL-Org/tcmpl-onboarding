'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DEV_MEMORY_STORE = '1';
delete process.env.COSMOS_CONNECTION_STRING;
delete process.env.WHATSAPP_NUDGE_TEMPLATE;
process.env.WHATSAPP_TOKEN = 't'; process.env.WHATSAPP_PHONE_NUMBER_ID = '1';
process.env.ACS_CONNECTION_STRING = 'endpoint=https://x.communication.azure.com/;accesskey=abc';
process.env.ACS_SENDER = 'DoNotReply@test.azurecomm.net';
process.env.LINK_SECRET = 'link-secret-for-tests';

const email = require('../src/lib/email');
const wa = require('../src/lib/whatsapp');
const handlers = require('../src/lib/handlers');
const conversations = require('../src/lib/conversations');
const modules = require('../src/lib/modules');
const exit = require('../src/lib/exit');
const { getStore } = require('../src/lib/store');

const user = { name: 'hr@x' };
const mails = [], was = [];
let windowOpen = false;
email._setClient({ beginSend: async m => { mails.push(m); return { pollUntilDone: async () => ({ id: 'e' + mails.length, status: 'Succeeded' }) }; } });
wa.sendText = async (to, t) => {
  if (!windowOpen) { const e = new Error('Re-engagement message'); e.detail = { code: 131047 }; throw e; }
  was.push([to, t]); return { id: 'w' + was.length };
};

const act = (action, body) => exit.action({ action, body, user });
const ID = 'exit-northpeak-NP1215-20261102';
const get = async () => (await act('case', { id: ID })).jsonBody.case;
const tokenOf = (m, label) => { const b = /href="([^"]+)"[^>]*>([^<]+)</g; let x; while ((x = b.exec(m.content.html))) if (x[2] === label) return new URL(x[1].replace(/&amp;/g, '&')).searchParams.get('t'); return null; };
const click = async (m, label) => handlers.confirmLink({ token: tokenOf(m, label) });
const to = m => m.recipients.to.map(r => r.address);

test('setup and a case with manager, employee email and partial owner contacts', async () => {
  await modules.httpAction({ action: 'save', body: { client: 'northpeak', exit: true }, user });
  const s = (await act('setup', { client: 'northpeak' })).jsonBody.setup;
  Object.assign(s.contacts, { company: 'Northpeak Logistics', hr: 'HR <hr@np.com>', payroll: 'payroll@np.com', recruitment: 'ta@np.com', replyTo: 'hr@np.com', cc: 'tcmpl@tc.com' });
  s.people.find(p => p.role === 'Sales head').contact = 'Vivek Anand <vivek@np.com>';
  s.people.find(p => p.role === 'HR head').contact = 'Priya Malhotra <priya@np.com>';
  s.owners.find(o => o.area === 'IT').contact = 'Rohit Verma, IT <rohit@np.com>';
  assert.equal((await act('setup-save', { client: 'northpeak', setup: s })).status, 200);
  const r = await act('raise', { client: 'northpeak', case: { employee: { code: 'NP1215', name: 'Rahul Mehta', mobile: '9812345678', email: 'rahul@mail.com', level: 'L3', dept: 'Sales', doj: '2022-01-10', manager: 'Anil Kumar', managerEmail: 'anil@np.com' }, typeId: 'resign', raisedBy: 'Employee', first: '2026-10-20T11:30', formal: '2026-11-02', requestedLwd: '2026-12-01' } });
  assert.equal(r.status, 200);
});

test('employee step: email goes, WhatsApp is held while the window is closed, then sent when the employee writes', async () => {
  mails.length = 0;
  const r = await act('send', { id: ID, key: 'ack' });
  assert.equal(r.status, 200);
  assert.equal(r.jsonBody.result.status, 'sent');
  assert.deepEqual(to(mails[0]), ['rahul@mail.com']);
  assert.match(mails[0].content.plainText, /Hi Rahul, this is the HR assistant of Northpeak Logistics/);
  assert.deepEqual(mails[0].recipients.cc.map(x => x.address), ['tcmpl@tc.com']);
  let k = await get();
  assert.equal(k.held.length, 1);
  assert.match(k.plan.find(s => s.key === 'ack').note, /WhatsApp: held/);
  windowOpen = true;
  await conversations.handleInbound({ id: 'wamid.a', from: '919812345678', type: 'text', text: 'ok thanks' });
  k = await get();
  assert.equal(k.held.length, 0);
  assert.ok(was.some(w => /HR assistant of Northpeak/.test(w[1])));
});

test('approvals: manager first; waiver goes on to the Sales head; a rejection restores the notice last day', async () => {
  mails.length = 0;
  const r = await act('send', { id: ID, key: 'approval' });
  assert.equal(r.jsonBody.result.status, 'sent');
  assert.equal(mails.length, 2);
  assert.ok(mails.every(m => to(m)[0] === 'anil@np.com'));
  const accept = mails.find(m => /Accept resignation/.test(m.content.subject));
  const waiver = mails.find(m => /Notice waiver/.test(m.content.subject));
  assert.match((await click(accept, 'Approve')).body, /approval is recorded/);
  assert.match((await click(accept, 'Approve')).body, /already answered/);
  let k = await get();
  assert.equal(k.approvals.find(a => a.action === 'Accept resignation').status, 'Approved');
  assert.equal(k.stage, 'accepted');
  mails.length = 0;
  await click(waiver, 'Approve');
  assert.deepEqual(to(mails[0]), ['vivek@np.com']);
  await click(mails[0], 'Reject');
  k = await get();
  assert.equal(k.approvals.find(a => a.action === 'Notice waiver').status, 'Rejected');
  assert.equal(k.lwd, '2026-12-19');
  assert.equal(k.waiverDays, 0);
  assert.equal(k.plan.find(s => s.key === 'lastday').date, '2026-12-19');
  assert.ok(k.alerts.some(a => a.open && /rejected by Vivek Anand/.test(a.why)));
});

test('clearances: every owner emailed, missing emails flagged, reminder only to owners still open', async () => {
  mails.length = 0;
  await act('send', { id: ID, key: 'clearance-start' });
  assert.deepEqual(mails.filter(m => /^Start clearances/.test(m.content.subject)).map(m => to(m)[0]).sort(), ['anil@np.com', 'rohit@np.com']); // IT, and the manager area uses the manager's email
  let k = await get();
  assert.ok(k.alerts.some(a => /No email for the Admin clearance owner/.test(a.why)));
  assert.match((await click(mails.find(m => to(m)[0] === 'rohit@np.com'), 'Cleared')).body, /IT clearance for Rahul Mehta is recorded/);
  mails.length = 0;
  await act('send', { id: ID, key: 'clearance-remind' });
  const rem = mails.filter(m => /^Reminder to owners/.test(m.content.subject));
  assert.deepEqual(rem.map(m => to(m)[0]), ['anil@np.com']);
  await click(rem[0], 'Something is pending');
  k = await get();
  assert.equal(k.clearances.o1.status, 'cleared');
  assert.equal(k.clearances.o5.status, 'issue');
  assert.ok(k.alerts.some(a => /Manager reports something pending/.test(a.why)));
});

test('manager handover link, HR marks steps, HR replies on WhatsApp', async () => {
  mails.length = 0;
  await act('send', { id: ID, key: 'handover' });
  await click(mails.find(m => /^Handover reminder/.test(m.content.subject)), 'Handover is complete');
  let k = await get();
  assert.equal(k.plan.find(s => s.key === 'handover').status, 'done');
  await act('step', { id: ID, key: 'announce', status: 'skipped' });
  assert.equal((await act('step', { id: ID, key: 'nope', status: 'done' })).status, 400);
  const r = await act('reply', { id: ID, text: 'Your relieving letter will come on the last day.' });
  assert.equal(r.jsonBody.result.ok, true);
  k = await get();
  assert.equal(k.plan.find(s => s.key === 'announce').status, 'skipped');
  const msgs = (await act('case', { id: ID })).jsonBody.messages;
  assert.ok(msgs.some(m => m.source === 'hr' && /relieving letter/.test(m.text)));
});

test('walkthrough clock: jump to the last day, run what is due (old steps marked missed), back to real time, reset', async () => {
  let r = await act('walk', { id: ID, action: 'jump', anchor: 'lwd', day: 0, time: '10:30' });
  assert.equal(r.status, 200);
  assert.equal((await act('case', { id: ID })).jsonBody.today, '2026-12-19');
  mails.length = 0;
  r = await act('walk', { id: ID, action: 'run' });
  const k = r.jsonBody.case;
  assert.equal(k.plan.find(s => s.key === 'lastday').status, 'sent');
  assert.equal(k.plan.find(s => s.key === 'access').status, 'planned'); // 17:00, not yet at 10:30
  assert.equal(k.plan.find(s => s.key === 'assets').status, 'missed');
  assert.equal(k.plan.find(s => s.key === 'fnf-draft').status, 'sent');
  assert.ok(mails.some(m => to(m)[0] === 'payroll@np.com'));
  r = await act('walk', { id: ID, action: 'realtime' });
  assert.equal(r.jsonBody.case.clockOffsetMs, 0);
  r = await act('walk', { id: ID, action: 'reset' });
  const z = r.jsonBody.case;
  assert.ok(z.plan.every(s => s.status === 'planned'));
  assert.ok(z.approvals.every(a => a.status === 'Pending' && a.chain.every(c => c.status === 'Waiting')));
  assert.deepEqual([z.alerts.length, Object.keys(z.clearances).length, z.stage], [0, 0, 'raised']);
  assert.equal((await act('case', { id: ID })).jsonBody.messages.length, 0);
});

test('scheduler: sends due steps only when auto-send is on, and never at night', async () => {
  const st = getStore();
  mails.length = 0;
  await exit.tick(st, Date.parse('2026-11-02T06:00:00Z')); // 11:30 IST, auto-send off
  let k = await get();
  assert.equal(k.plan.find(s => s.key === 'ack').status, 'due');
  assert.equal(mails.length, 0);
  const s = (await act('setup', { client: 'northpeak' })).jsonBody.setup;
  s.sending.auto = true;
  await act('setup-save', { client: 'northpeak', setup: s });
  await exit.tick(st, Date.parse('2026-11-02T17:00:00Z')); // 22:30 IST
  assert.equal(mails.length, 0);
  await exit.tick(st, Date.parse('2026-11-03T04:00:00Z')); // 9:30 IST next day
  k = await get();
  assert.equal(k.plan.find(s => s.key === 'ack').status, 'sent');
  assert.equal(k.plan.find(s => s.key === 'approval').status, 'sent');
  assert.equal(k.plan.find(s => s.key === 'accepted').status, 'planned'); // 3 Nov 11:00, not yet
  assert.ok(mails.length >= 3);
});

test('links stop working when the case is closed or Exit is switched off', async () => {
  mails.length = 0;
  await act('walk', { id: ID, action: 'reset' });
  await act('send', { id: ID, key: 'approval' });
  const m = mails.find(x => /^Approval/.test(x.content.subject));
  await modules.httpAction({ action: 'save', body: { client: 'northpeak', exit: false }, user });
  assert.match((await click(m, 'Approve')).body, /not active/);
  assert.equal((await act('send', { id: ID, key: 'ack' })).status, 403);
  await modules.httpAction({ action: 'save', body: { client: 'northpeak', exit: true }, user });
  await act('cancel', { id: ID });
  assert.match((await click(m, 'Approve')).body, /closed/);
  assert.equal((await act('send', { id: ID, key: 'ack' })).status, 409);
});
