'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DEV_MEMORY_STORE = '1';
delete process.env.COSMOS_CONNECTION_STRING;
process.env.WHATSAPP_TOKEN = 't'; process.env.WHATSAPP_PHONE_NUMBER_ID = '1';
process.env.ACS_CONNECTION_STRING = 'endpoint=https://x.communication.azure.com/;accesskey=abc';
process.env.ACS_SENDER = 'DoNotReply@test.azurecomm.net';
process.env.LINK_SECRET = 'link-secret-for-tests';
process.env.CRON_SECRET = 'cron-secret-for-tests';

const email = require('../src/lib/email');
const wa = require('../src/lib/whatsapp');
const links = require('../src/lib/links');
const handlers = require('../src/lib/handlers');
const conversations = require('../src/lib/conversations');
const modules = require('../src/lib/modules');
const exit = require('../src/lib/exit'); // registers the Exit module, as api/src/functions/exit.js does
const { getStore } = require('../src/lib/store');

const user = { name: 'hr@x' };
const sentMail = [], sentWa = [];
email._setClient({ beginSend: async m => { sentMail.push(m); return { pollUntilDone: async () => ({ id: 'e' + sentMail.length, status: 'Succeeded' }) }; } });
wa.sendText = async (to, t) => { sentWa.push([to, t]); return { id: 'w' + sentWa.length }; };

const act = (action, body) => exit.action({ action, body, user });
const kase = (o = {}) => Object.assign({ employee: { code: 'NP1215', name: 'Rahul Mehta', mobile: '9812345678', level: 'L3', dept: 'Sales', doj: '2022-01-10', manager: 'Anil Kumar' }, typeId: 'resign', raisedBy: 'Employee', first: '2026-10-20T11:30', formal: '2026-11-02', requestedLwd: '2026-12-01' }, o);

test('modules: Exit is off by default, switched on per client', async () => {
  assert.ok(modules.loaded('exit'));
  assert.equal((await modules.httpAction({ action: 'get', body: { client: 'northpeak' }, user: null })).status, 401);
  assert.deepEqual((await modules.httpAction({ action: 'get', body: { client: 'northpeak' }, user })).jsonBody.modules, { onboarding: true, exit: false });
  assert.equal((await act('raise', { client: 'northpeak', case: kase() })).status, 403);
  const r = await modules.httpAction({ action: 'save', body: { client: 'northpeak', exit: true }, user });
  assert.deepEqual(r.jsonBody.modules, { onboarding: true, exit: true });
  assert.equal(await modules.enabled(getStore(), 'otherclient', 'exit'), false);
});

test('health shows the Exit module', () => {
  assert.equal(handlers.health().jsonBody.exit, true);
});

test('exit records change only through /api/exit; the data API can read them', async () => {
  assert.equal((await handlers.data({ method: 'PUT', col: 'exit_cases', id: 'x', body: { a: 1 }, user })).status, 403);
  assert.equal((await handlers.data({ method: 'DELETE', col: 'modules', id: 'northpeak', user })).status, 403);
  assert.equal((await handlers.data({ method: 'GET', col: 'exit_cases', user })).status, 200);
});

test('setup: TCMPL default, save per client, reset', async () => {
  const d = await act('setup', { client: 'northpeak' });
  assert.equal(d.jsonBody.isDefault, true);
  assert.equal(d.jsonBody.enabled, true);
  const s = d.jsonBody.setup;
  s.contacts.company = 'Northpeak Logistics'; s.contacts.hr = 'HR <hr@northpeak.com>';
  const saved = await act('setup-save', { client: 'northpeak', setup: s });
  assert.equal(saved.status, 200);
  assert.equal((await act('setup', { client: 'northpeak' })).jsonBody.setup.contacts.company, 'Northpeak Logistics');
  assert.equal((await act('setup', { client: 'lotus' })).jsonBody.isDefault, true);
  await act('setup-reset', { client: 'lotus' });
});

test('raise: preview, create, no duplicate, list', async () => {
  const p = await act('preview', { client: 'northpeak', case: kase() });
  assert.equal(p.jsonBody.case.lwd, '2026-12-01');
  assert.ok((await act('preview', { client: 'northpeak', case: kase({ typeId: '' }) })).jsonBody.errors.length);
  const r = await act('raise', { client: 'northpeak', case: kase() });
  assert.equal(r.status, 200);
  assert.equal(r.jsonBody.case.status, 'open');
  assert.equal((await act('raise', { client: 'northpeak', case: kase() })).status, 409);
  const list = (await act('cases', { client: 'northpeak' })).jsonBody.items;
  assert.equal(list.length, 1);
  assert.equal(list[0].next.key, 'ack');
  assert.equal((await act('cases', { client: 'lotus' })).jsonBody.items.length, 0);
});

test('WhatsApp: an employee with an open case goes to Exit, onboarding never sees it', async () => {
  sentWa.length = 0; sentMail.length = 0;
  await conversations.handleInbound({ id: 'wamid.1', from: '919812345678', name: 'Rahul', type: 'text', text: 'Can I get my relieving letter early?' });
  await conversations.handleInbound({ id: 'wamid.1', from: '919812345678', name: 'Rahul', type: 'text', text: 'Can I get my relieving letter early?' }); // Meta retry
  await conversations.handleInbound({ id: 'wamid.2', from: '919812345678', name: 'Rahul', type: 'text', text: 'Also my PF?' });
  const store = getStore();
  assert.equal(await store.get('candidates', 'wa-919812345678'), null);
  const c = (await act('case', { id: 'exit-northpeak-NP1215-20261102' })).jsonBody;
  assert.deepEqual(c.messages.filter(m => m.direction === 'in').map(m => m.text), ['Can I get my relieving letter early?', 'Also my PF?']);
  assert.equal(sentWa.length, 1); // one holding reply, not one per message
  assert.match(sentWa[0][1], /Thank you, Rahul/);
  assert.equal(c.case.alerts.filter(a => a.open).length, 2);
  assert.equal(sentMail.length, 2); // HR emailed once per new red item
  assert.deepEqual(sentMail[0].recipients.to, [{ address: 'hr@northpeak.com' }]);
  const closed = await act('alert-close', { id: c.case.id, index: 0 });
  assert.equal(closed.jsonBody.case.alerts[0].open, false);
});

test('WhatsApp: other numbers still go to onboarding', async () => {
  const store = getStore();
  assert.equal(await modules.route({ id: 'x1', from: '919800000001', type: 'text', text: 'hello' }, store), '');
  assert.equal(await exit.claims({ from: '919800000001' }, store), false);
});

test('scheduler tick runs onboarding and Exit; Exit marks due steps', async () => {
  const r = await handlers.cronTick({ key: 'cron-secret-for-tests' });
  assert.equal(r.status, 200);
  assert.ok(r.jsonBody.modules && r.jsonBody.modules.exit && r.jsonBody.modules.exit.ok);
  const t = await exit.tick(getStore(), Date.parse('2026-11-10T06:00:00Z'));
  assert.equal(t.ok, true);
  const k = (await act('case', { id: 'exit-northpeak-NP1215-20261102' })).jsonBody.case;
  assert.equal(k.plan.find(s => s.key === 'ack').status, 'due');
  assert.equal(k.plan.find(s => s.key === 'lastday').status, 'planned');
});

test('a failing module tick does not stop the others', async () => {
  modules.register('broken', { tick: async () => { throw new Error('boom'); } });
  const out = await modules.runTicks(getStore());
  assert.equal(out.broken.ok, false);
  assert.ok(out.exit.ok);
});

test('one-click links: m: exit goes to the Exit module; onboarding links unchanged', async () => {
  const t = new URL(links.link({ m: 'exit', c: 'exit-northpeak-NP1215-20261102', a: 'approve' })).searchParams.get('t');
  const r = await handlers.confirmLink({ token: t });
  assert.match(r.body, /TCMPL AI Exit Agent/);
  const t2 = new URL(links.link({ c: 'wa-910000000000', k: 'x', a: 'done' })).searchParams.get('t');
  assert.match((await handlers.confirmLink({ token: t2 })).body, /no longer in onboarding/);
});

test('HRMS import: any column names, errors per row', async () => {
  const r = await act('import', { client: 'northpeak', rows: [
    { 'Emp ID': 'NP0640', 'Employee Name': 'Meera Iyer', 'Separation Type': 'Superannuation', 'Resignation Date': '02/11/2026', 'Relieving Date': '31-12-2026', Mobile: '9800011122' },
    { 'Emp ID': 'NP9', 'Employee Name': 'X Y', 'Separation Type': 'Space travel', 'Resignation Date': '02/11/2026' },
    { 'Employee Name': 'No Code', 'Separation Type': 'Resignation', 'Resignation Date': '02/11/2026' }
  ] });
  assert.equal(r.jsonBody.created, 1);
  assert.equal(r.jsonBody.failed, 2);
  const k = (await act('case', { id: 'exit-northpeak-NP0640-20261102' })).jsonBody.case;
  assert.deepEqual([k.typeId, k.lwd, k.source], ['retire', '2026-12-31', 'HRMS import']);
  assert.equal((await act('import', { client: 'northpeak', rows: new Array(301).fill({}) })).status, 400);
});

test('cancel closes the case and Exit stops claiming WhatsApp', async () => {
  const r = await act('cancel', { id: 'exit-northpeak-NP1215-20261102', reason: 'Resignation withdrawn' });
  assert.equal(r.jsonBody.case.status, 'cancelled');
  assert.equal(await exit.claims({ from: '919812345678' }, getStore()), false);
  assert.equal((await act('cancel', { id: 'exit-northpeak-NP1215-20261102' })).status, 409);
  assert.equal((await act('case', { id: '../etc' })).status, 400);
});

test('switching Exit off for a client stops its WhatsApp claims and ticks', async () => {
  await act('raise', { client: 'northpeak', case: kase({ formal: '2026-11-03' }) });
  assert.equal(await exit.claims({ from: '919812345678' }, getStore()), true);
  await modules.httpAction({ action: 'save', body: { client: 'northpeak', exit: false }, user });
  assert.equal(await exit.claims({ from: '919812345678' }, getStore()), false);
  assert.equal((await exit.tick(getStore(), Date.parse('2027-03-01T06:00:00Z'))).due, 0);
});
