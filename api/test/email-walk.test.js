'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DEV_MEMORY_STORE = '1';
delete process.env.COSMOS_CONNECTION_STRING;
process.env.WHATSAPP_TOKEN = 't'; process.env.WHATSAPP_PHONE_NUMBER_ID = '1';
process.env.ACS_CONNECTION_STRING = 'endpoint=https://x.communication.azure.com/;accesskey=abc';
process.env.ACS_SENDER = 'DoNotReply@test.azurecomm.net';
process.env.LINK_SECRET = 'link-secret-for-tests';
const email = require('../src/lib/email');
const links = require('../src/lib/links');
const handlers = require('../src/lib/handlers');
const wa = require('../src/lib/whatsapp');
const { getStore } = require('../src/lib/store');
const user = { name: 'hr@x' };

const sentMail = [];
email._setClient({ beginSend: async m => { sentMail.push(m); return { pollUntilDone: async () => ({ id: 'e' + sentMail.length, status: 'Succeeded' }) }; } });
const sentWa = [];
wa.sendText = async (to, t) => { sentWa.push(t); return { id: 'w' }; };
wa.sendButtons = async (to, t, b) => { sentWa.push(t + ' [' + b.join('|') + ']'); return { id: 'w' }; };

test('addresses come out of "Name, Team <email>" text', () => {
  assert.deepEqual(email.addresses('Rohit Verma, IT <Rohit@Client.com>; a@b.co, nope'), ['rohit@client.com', 'a@b.co']);
});

test('signed links: valid, tamper-proof', () => {
  const l = links.link({ c: 'wa-1', k: 'laptop', a: 'done' });
  const t = new URL(l).searchParams.get('t');
  assert.equal(links.verify(t).k, 'laptop');
  assert.equal(links.verify(t.replace(/.$/, c => (c === 'A' ? 'B' : 'A'))), null);
});

test('owner email with CC and settings, then one-click Mark as done', async () => {
  const store = getStore();
  const id = 'wa-917000000011';
  await store.put('candidates', id, { phone: '917000000011', name: 'Asha Rao', email: 'asha@mail.com', profile: { client: 'northpeak', doj: '2026-12-01', first: 'Asha' } }, user);
  await handlers.notifyAction({ action: 'settings', body: { client: 'northpeak', replyTo: 'HR <hr@tcmpl.com>', cc: 'clienthr@client.com' }, user });
  const r = await handlers.notifyAction({ action: 'owner', body: { candidateId: id, k: 'laptop', task: 'Laptop and system access', owner: 'Rohit Verma, IT <rohit@client.com>', cc: 'mgr@client.com', subject: 'New colleague: laptop', body: 'Please arrange a laptop.', dueDate: '2026-11-24' }, user });
  assert.equal(r.status, 200);
  const m = sentMail[sentMail.length - 1];
  assert.deepEqual(m.recipients.to, [{ address: 'rohit@client.com' }]);
  assert.deepEqual(m.recipients.cc.map(x => x.address).sort(), ['clienthr@client.com', 'mgr@client.com']);
  assert.deepEqual(m.replyTo, [{ address: 'hr@tcmpl.com' }]);
  assert.match(m.content.html, /Mark as done/);
  let c = (await store.get('candidates', id)).data;
  assert.equal(c.readiness.items.laptop.status, 'requested');
  const url = /href="(https:[^"]+a[^"]*)"/.exec(m.content.html)[1].replace(/&amp;/g, '&');
  const page = await handlers.confirmLink({ token: new URL(url).searchParams.get('t') });
  assert.equal(page.status, 200);
  assert.match(page.body, /marked as done/);
  c = (await store.get('candidates', id)).data;
  assert.equal(c.readiness.items.laptop.status, 'done');
  assert.equal((await handlers.confirmLink({ token: 'bad.token' })).status, 400);
});

test('walkthrough: jump to D-1 reminds the owner, D+1 escalates to HR; D-2 sends the candidate check; reset starts again', async () => {
  const store = getStore();
  const id = 'wa-917000000011';
  sentMail.length = 0; sentWa.length = 0;
  let c = (await store.get('candidates', id)).data;
  c.readiness.items.seat = { status: 'requested', ownerEmail: 'admin@client.com', dueDate: '2026-11-24', task: 'Seat or workstation' };
  await store.put('candidates', id, c, user);
  await handlers.notifyAction({ action: 'jump', body: { candidateId: id, day: -7, time: '11:00' }, user });
  await handlers.notifyAction({ action: 'run', body: { candidateId: id }, user });
  assert.match(sentMail.map(m => m.content.subject).join('|'), /Reminder: Seat or workstation/);
  await handlers.notifyAction({ action: 'jump', body: { candidateId: id, day: -2, time: '10:30' }, user });
  await handlers.notifyAction({ action: 'run', body: { candidateId: id }, user });
  assert.match(sentWa.join('|'), /email ID and login details/);
  assert.match(sentMail.map(m => m.content.subject).join('|'), /Overdue for Asha Rao: Seat/);
  c = (await store.get('candidates', id)).data;
  assert.ok(c.handovers.some(h => /overdue/i.test(h.why)));
  await store.put('messages', 'o-test', { candidateId: id, direction: 'out', text: 'x' }, user);
  const r = await handlers.notifyAction({ action: 'reset', body: { candidateId: id }, user });
  assert.equal(r.status, 200);
  c = (await store.get('candidates', id)).data;
  assert.equal(c.readiness, undefined);
  assert.equal(c.stage, 'Offer sent');
  assert.equal(c.profile.doj, '2026-12-01');
  assert.equal(await store.get('messages', 'o-test'), null);
});

test('journey check-ins: saved setup, walkthrough jump runs resignation check, manager email answer by link', async () => {
  const store = getStore();
  const id = 'wa-917000000099';
  await store.put('candidates', id, { phone: '917000000099', name: 'Asha Rao', email: 'asha@example.com', profile: { doj: '2026-12-01', client: 'ckclient', first: 'Asha' } }, user);
  let r = await handlers.checkinAction({ action: 'setup', body: { client: 'ckclient' }, user });
  assert.equal(r.status, 200);
  const setup = r.jsonBody.setup;
  setup.contacts.manager = 'Arjun <arjun@example.com>';
  r = await handlers.checkinAction({ action: 'save', body: { client: 'ckclient', setup }, user });
  assert.equal(r.status, 200);
  r = await handlers.notifyAction({ action: 'jump', body: { candidateId: id, day: -28, time: '11:30' }, user });
  assert.equal(r.status, 200);
  sentWa.length = 0;
  await handlers.notifyAction({ action: 'run', body: { candidateId: id }, user });
  assert.ok(sentWa.some(t => /resignation/.test(t) && /Yes, submitted/.test(t)));
  // HR sends the manager's fortnightly check-in now; the manager answers by the email link
  sentMail.length = 0;
  r = await handlers.checkinAction({ action: 'send', body: { candidateId: id, key: 'mgr-pulse@14' }, user });
  assert.equal(r.status, 200);
  assert.equal(sentMail[0].recipients.to[0].address, 'arjun@example.com');
  const html = sentMail[0].content.html;
  const href = /href="([^"]*a?confirm\?t=[^"]+)"[^>]*>Some concerns/.exec(html);
  assert.ok(href, 'answer button in email');
  const t = new URL(href[1].replace(/&amp;/g, '&')).searchParams.get('t');
  const page = await handlers.confirmLink({ token: t });
  assert.match(page.body, /sent to HR/);
  const c = (await store.get('candidates', id)).data;
  assert.equal(c.checkins.asks['mgr-pulse@14'].answer, 'Some concerns');
  assert.ok(c.handovers.some(h => /Fortnightly check-in \(manager\)/.test(h.why)));
});
