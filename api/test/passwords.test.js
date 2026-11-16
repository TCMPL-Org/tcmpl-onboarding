'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DEV_MEMORY_STORE = '1';
delete process.env.COSMOS_CONNECTION_STRING;
delete process.env.ACS_CONNECTION_STRING;
delete process.env.SESSION_SECRET;
process.env.ADMIN_EMAILS = 'boss@talentcarriage.com';
process.env.APP_URL = 'https://app.example.com';

const access = require('../src/lib/access');
const passwords = require('../src/lib/passwords');
const S = require('../src/lib/session');
const email = require('../src/lib/email');
const { getStore } = require('../src/lib/store');

const ms = mail => ({ 'x-ms-client-principal': Buffer.from(JSON.stringify({ userId: 'u-' + mail, userDetails: mail, identityProvider: 'aad', userRoles: ['authenticated'] })).toString('base64') });
const admin = { headers: ms('boss@talentcarriage.com') };
const withCookie = setCookie => ({ headers: { cookie: String(setCookie).split(';')[0] } });
const act = (action, body, request) => access.httpAction({ action, body: body || {}, request: request || admin });
const auth = (action, body, request) => passwords.httpAction({ action, body: body || {}, request: request || { headers: {} } });

// Capture "sent" emails instead of calling Azure.
const outbox = [];
function emailOn() {
  process.env.ACS_CONNECTION_STRING = 'endpoint=https://x/;accesskey=y';
  process.env.ACS_SENDER = 'DoNotReply@x.azurecomm.net';
  email._setClient({ beginSend: async m => { outbox.push(m); return { pollUntilDone: async () => ({ status: 'Succeeded', id: 'm' + outbox.length }) }; } });
}
const linkToken = m => /#t=([A-Za-z0-9_-]+)/.exec(m.content.plainText)[1];

test('passwords: hashing, rules, sessions', async () => {
  const h = await S.hashPassword('a long passphrase here');
  assert.match(h, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await S.verifyPassword('a long passphrase here', h), true);
  assert.equal(await S.verifyPassword('wrong one entirely', h), false);
  assert.equal(await S.verifyPassword('anything', null), false);
  assert.equal(S.passwordProblem('short', 'a@b.com'), 'too_short');
  assert.equal(S.passwordProblem('password123', 'a@b.com'), 'too_common');
  assert.equal(S.passwordProblem('priyamalhotra2026', 'priyamalhotra@x.com'), 'contains_email');
  assert.equal(S.passwordProblem('blue tea at noon', 'a@b.com'), '');
  const store = getStore();
  const tok = await S.makeSession(store, { email: 'A@B.com', sessionVersion: 3 });
  const p = await S.readSession(store, tok);
  assert.equal(p.e, 'a@b.com'); assert.equal(p.v, 3);
  const [body, sig] = tok.split('.');
  const forged = Buffer.from(JSON.stringify({ e: 'boss@talentcarriage.com', v: 0, s: 'x', x: Date.now() + 1e6 })).toString('base64url');
  assert.equal(await S.readSession(store, forged + '.' + sig), null, 'a changed cookie is refused');
  assert.equal(await S.readSession(store, body + '.' + sig.slice(0, -2) + 'AA'), null);
  assert.equal(S.cookieFrom({ headers: { cookie: 'a=1; tc_session=abc.def; b=2' } }), 'abc.def');
});

test('without sign-in nobody gets in; the app answers "not signed in"', async () => {
  const r = await act('me', {}, { headers: {} });
  assert.equal(r.jsonBody.allowed, false);
  assert.equal(r.jsonBody.signedIn, false);
  assert.equal((await access.guard({ headers: { cookie: 'tc_session=junk.junk' } }, {})).response.status, 401);
});

test('invite → set password → sign in → reset by admin → old password and sessions stop', async () => {
  emailOn();
  let r = await act('user-save', { email: 'Priya@Client.com', name: 'Priya Malhotra', role: 'hr', clients: ['northpeak'], invite: true });
  assert.equal(r.status, 200);
  assert.equal(r.jsonBody.invite.sent, true);
  assert.equal(r.jsonBody.user.invitePending, true);
  assert.equal(r.jsonBody.user.pwHash, undefined, 'no hash to the browser');
  const invite = outbox.at(-1);
  assert.deepEqual(invite.recipients.to, [{ address: 'priya@client.com' }]);
  assert.match(invite.content.plainText, /https:\/\/app\.example\.com\/set-password#t=/);
  const token = linkToken(invite);
  // nothing secret in the stored record
  const rec = (await getStore().get('users', access.idFor('priya@client.com'))).data;
  assert.ok(rec.invite.hash && !JSON.stringify(rec).includes(token), 'only the hash of the link is stored');

  // users list never shows hashes
  const list = (await act('users')).jsonBody.users;
  assert.ok(list.every(u => !('pwHash' in u) && !('invite' in u)));

  assert.equal((await auth('link-info', { token })).jsonBody.purpose, 'invite');
  assert.equal((await auth('set-password', { token, password: 'short' })).jsonBody.problem, 'too_short');
  r = await auth('set-password', { token, password: 'monsoon on marine drive' });
  assert.equal(r.status, 200);
  assert.match(r.headers['Set-Cookie'], /^tc_session=.+; Path=\/api; HttpOnly; Secure; SameSite=Strict/);
  assert.equal((await auth('link-info', { token })).status, 404, 'link works once');

  // sign in with the password
  assert.equal((await auth('login', { email: 'priya@client.com', password: 'nope nope nope' })).status, 401);
  r = await auth('login', { email: 'PRIYA@client.com', password: 'monsoon on marine drive' });
  assert.equal(r.status, 200);
  const cookie = withCookie(r.headers['Set-Cookie']);
  let me = await act('me', {}, cookie);
  assert.equal(me.jsonBody.allowed, true);
  assert.equal(me.jsonBody.provider, 'password');
  assert.deepEqual(me.jsonBody.clients, ['northpeak']);
  const g = await access.guard(cookie, { client: 'lotus' });
  assert.equal(g.response.status, 403, 'HR still limited to their clients');
  assert.equal((await act('users', {}, cookie)).status, 403, 'HR cannot manage users');

  // admin resets the password: old password and the open session stop at once
  r = await act('reset-password', { email: 'priya@client.com' });
  assert.equal(r.status, 200);
  assert.equal(r.jsonBody.sent, true);
  assert.match(outbox.at(-1).content.subject, /was reset/);
  me = await act('me', {}, cookie);
  assert.equal(me.jsonBody.signedIn, false, 'old session ended');
  assert.equal((await auth('login', { email: 'priya@client.com', password: 'monsoon on marine drive' })).status, 401, 'old password ended');
  const t2 = linkToken(outbox.at(-1));
  assert.equal((await auth('set-password', { token: t2, password: 'chai with ginger please' })).status, 200);
  assert.equal((await auth('login', { email: 'priya@client.com', password: 'chai with ginger please' })).status, 200);
});

test('forgot password: same answer for unknown emails; link works for 1 hour', async () => {
  emailOn();
  const before = outbox.length;
  let r = await auth('forgot', { email: 'nobody@nowhere.com' });
  assert.equal(r.status, 200);
  assert.equal(outbox.length, before, 'no email for an unknown address');
  r = await auth('forgot', { email: 'priya@client.com' });
  assert.equal(r.status, 200);
  assert.equal(outbox.length, before + 1);
  const rec = (await getStore().get('users', access.idFor('priya@client.com'))).data;
  const mins = (Date.parse(rec.reset.expires) - Date.now()) / 60000;
  assert.ok(mins > 55 && mins <= 60);
  // the current password still works until a new one is chosen
  assert.equal((await auth('login', { email: 'priya@client.com', password: 'chai with ginger please' })).status, 200);
});

test('five wrong passwords lock the account for 15 minutes', async () => {
  for (let i = 0; i < 4; i++) assert.equal((await auth('login', { email: 'priya@client.com', password: 'wrong ' + i + ' xxxxx' })).status, 401);
  const r = await auth('login', { email: 'priya@client.com', password: 'wrong 5 xxxxx' });
  assert.equal(r.status, 429);
  assert.equal(r.jsonBody.error, 'locked');
  assert.equal((await auth('login', { email: 'priya@client.com', password: 'chai with ginger please' })).status, 429, 'even the right password waits');
  const list = (await act('users')).jsonBody.users;
  assert.equal(list.find(u => u.email === 'priya@client.com').locked, true);
  // an admin reset clears the lock
  const rec = (await getStore().get('users', access.idFor('priya@client.com'))).data;
  await getStore().put('users', access.idFor('priya@client.com'), Object.assign({}, rec, { lockedUntil: null }), { name: 't' });
  access.forget();
});

test('switching a user off ends their session; other sites cannot post', async () => {
  const r = await auth('login', { email: 'priya@client.com', password: 'chai with ginger please' });
  assert.equal(r.status, 200);
  const cookie = withCookie(r.headers['Set-Cookie']);
  assert.equal((await act('me', {}, cookie)).jsonBody.allowed, true);
  await act('user-save', { email: 'priya@client.com', name: 'Priya Malhotra', role: 'hr', clients: ['northpeak'], active: false });
  assert.equal((await act('me', {}, cookie)).jsonBody.signedIn, false);
  assert.equal((await auth('login', { email: 'priya@client.com', password: 'chai with ginger please' })).status, 401);
  const evil = { headers: { origin: 'https://evil.example', host: 'app.example.com' } };
  assert.equal((await auth('login', { email: 'x@y.com', password: 'z' }, evil)).status, 403);
});

test('email not set up: the admin gets the link to pass on; forgot never reveals one', async () => {
  delete process.env.ACS_CONNECTION_STRING;
  let r = await act('user-save', { email: 'ravi@client.com', role: 'hr', clients: ['northpeak'], invite: true });
  assert.equal(r.jsonBody.invite.sent, false);
  assert.match(r.jsonBody.invite.link, /\/set-password#t=/);
  // an ADMIN_EMAILS admin can also get a password
  r = await act('invite', { email: 'boss@talentcarriage.com' });
  assert.equal(r.status, 200);
  assert.ok(r.jsonBody.link);
  r = await auth('forgot', { email: 'boss@talentcarriage.com' });
  assert.deepEqual(r.jsonBody, { ok: true });
  assert.equal((await act('reset-password', { email: 'boss@talentcarriage.com' })).jsonBody.error, 'use_forgot_password');
});
