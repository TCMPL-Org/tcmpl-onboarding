'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DEV_MEMORY_STORE = '1';
delete process.env.COSMOS_CONNECTION_STRING;
delete process.env.ADMIN_EMAILS;
const access = require('../src/lib/access');
const handlers = require('../src/lib/handlers');
const modules = require('../src/lib/modules');
const { getStore } = require('../src/lib/store');

const principal = email => ({ 'x-ms-client-principal': Buffer.from(JSON.stringify({ userId: 'u-' + email, userDetails: email, identityProvider: 'aad', userRoles: ['authenticated'] })).toString('base64') });
const req = email => ({ headers: email ? principal(email) : {} });
const act = (action, email, body) => access.httpAction({ action, body: body || {}, request: req(email) });

test('setup mode until ADMIN_EMAILS is set; then only listed people get in', async () => {
  let r = await act('me', 'anyone@example.com');
  assert.equal(r.jsonBody.allowed, true);
  assert.equal(r.jsonBody.setupMode, true);
  process.env.ADMIN_EMAILS = 'Jeet.Pawar@talentcarriage.com';
  access.forget();
  r = await act('me', 'anyone@example.com');
  assert.equal(r.jsonBody.allowed, false);
  assert.equal(r.jsonBody.email, 'anyone@example.com');
  r = await act('me', 'jeet.pawar@talentcarriage.com');
  assert.equal(r.jsonBody.role, 'admin');
  const g = await access.guard(req('stranger@gmail.com'), {});
  assert.equal(g.response.status, 403);
  assert.equal((await access.guard(req(''), {})).response.status, 401);
});

test('admin adds an HR user for one client; HR sees only that client', async () => {
  const store = getStore();
  const hr = 'priya@client.com';
  let r = await act('user-save', 'jeet.pawar@talentcarriage.com', { email: 'Priya@Client.com', name: 'Priya', role: 'hr', clients: ['northpeak'] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.jsonBody.user.clients, ['northpeak']);
  assert.equal((await act('users', hr)).status, 403, 'HR cannot manage users');
  r = await act('me', hr);
  assert.equal(r.jsonBody.role, 'hr');
  const sys = { name: 't' };
  await store.put('candidates', 'wa-919800000011', { phone: '919800000011', profile: { client: 'northpeak' } }, sys);
  await store.put('candidates', 'wa-919800000012', { phone: '919800000012', profile: { client: 'lotus' } }, sys);
  await store.put('messages', 'm-1', { candidateId: 'wa-919800000011', text: 'a' }, sys);
  await store.put('messages', 'm-2', { candidateId: 'wa-919800000012', text: 'b' }, sys);
  const u = (await access.guard(req(hr), null)).user;
  let d = await handlers.data({ method: 'GET', col: 'candidates', user: u });
  assert.deepEqual(d.jsonBody.items.map(i => i.id), ['wa-919800000011']);
  d = await handlers.data({ method: 'GET', col: 'messages', user: u });
  assert.deepEqual(d.jsonBody.items.map(i => i.id), ['m-1']);
  d = await handlers.data({ method: 'GET', col: 'candidates', id: 'wa-919800000012', user: u });
  assert.equal(d.status, 403);
  d = await handlers.data({ method: 'GET', col: 'users', user: u });
  assert.equal(d.status, 403, 'user list never through the data API');
  // actions on another client's candidate or client are refused
  assert.equal((await access.guard(req(hr), { candidateId: 'wa-919800000012' })).response.status, 403);
  assert.equal((await access.guard(req(hr), { client: 'lotus' })).response.status, 403);
  assert.ok((await access.guard(req(hr), { client: 'northpeak' })).user);
  // HR cannot create clients or change modules
  d = await handlers.data({ method: 'PUT', col: 'clients', id: 'newco', body: { label: 'New Co' }, user: u });
  assert.equal(d.status, 403);
  const m = await modules.httpAction({ action: 'save', body: { client: 'northpeak', exit: true }, user: u });
  assert.equal(m.status, 403);
  // switched off -> no access; cannot remove yourself
  await act('user-save', 'jeet.pawar@talentcarriage.com', { email: hr, role: 'hr', clients: ['northpeak'], active: false });
  assert.equal((await act('me', hr)).jsonBody.allowed, false);
  assert.equal((await act('user-remove', 'jeet.pawar@talentcarriage.com', { email: 'jeet.pawar@talentcarriage.com' })).status, 400);
  assert.equal((await act('user-remove', 'jeet.pawar@talentcarriage.com', { email: hr })).status, 200);
});

test('admin switches Onboarding and Exit per client; Onboarding off stops offers and the scheduler', async () => {
  const store = getStore();
  const admin = (await access.guard(req('jeet.pawar@talentcarriage.com'), {})).user;
  let r = await modules.httpAction({ action: 'save', body: { client: 'acme', onboarding: false, exit: true }, user: admin });
  assert.deepEqual(r.jsonBody.modules, { onboarding: false, exit: true });
  r = await modules.httpAction({ action: 'list', body: {}, user: admin });
  assert.deepEqual(r.jsonBody.clients.acme, { onboarding: false, exit: true });
  const conv = require('../src/lib/conversations');
  const s = await conv.startForOffer({ mobile: '9800000021', name: 'A B', client: 'acme', profile: { client: 'acme' } }, { name: 'hr' });
  assert.equal(s.status, 403);
  assert.equal(s.body.error, 'onboarding_off');
  await modules.httpAction({ action: 'save', body: { client: 'acme', onboarding: true }, user: admin });
  const s2 = await conv.startForOffer({ mobile: '9800000021', name: 'A B', client: 'acme', profile: { client: 'acme' } }, { name: 'hr' });
  assert.equal(s2.status, 200);
  assert.ok(await store.get('candidates', 'wa-919800000021'));
});
