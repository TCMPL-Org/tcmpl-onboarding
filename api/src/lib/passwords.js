'use strict';
// Email + password sign-in: login, logout, forgot password, invite / reset links, setting a password.
// Routes: POST /api/auth/{login|logout|forgot|link-info|set-password}  (open routes; see functions/auth.js)
// Admin side (invite, reset someone's password) is in access.js and calls sendLink() below.

const S = require('./session');
const access = require('./access');
const { getStore } = require('./store');
const email = require('./email');
const { appUrl } = require('./links');

const SYSTEM = { name: 'sign-in' };
const json = (status, jsonBody, headers) => ({ status, jsonBody, headers: Object.assign({ 'cache-control': 'no-store' }, headers || {}) });

async function userRec(store, mail) {
  const e = access.norm(mail);
  if (!access.isEmail(e)) return null;
  const rec = await store.get('users', access.idFor(e)).catch(() => null);
  return rec && rec.data && rec.data.email ? rec.data : null;
}
async function save(store, u) {
  await store.put('users', access.idFor(u.email), u, SYSTEM);
  access.forget();
}

// The user whose unused, unexpired invite or reset link this is.
async function byToken(store, token) {
  if (typeof token !== 'string' || token.length < 30 || token.length > 100) return null;
  const now = Date.now();
  for (const u of await access.allUsers(store, true)) {
    for (const kind of ['invite', 'reset']) {
      const t = u[kind];
      if (t && t.hash && Date.parse(t.expires) > now && S.tokenMatches(token, t.hash)) return { user: u, kind };
    }
  }
  return null;
}

const label = x => (x && (x.displayName || x.name || x.email)) || 'Your admin';

// kind: 'invite' (7 days) | 'reset' (forgot password, 1 hour) | 'admin-reset' (password cleared, link 24 hours).
// Admin kinds get the link back when email cannot be sent, so they can pass it on themselves.
async function sendLink(store, mail, kind, by) {
  const u = await userRec(store, mail);
  if (!u) return { error: 'no_such_user' };
  if (kind === 'invite' && u.pwHash) return { error: 'already_has_password' };
  const now = Date.now();
  const slot = kind === 'invite' ? 'invite' : 'reset';
  const last = u[slot] && Date.parse(u[slot].sentAt);
  if (last && now - last < 60000) return { error: 'wait_a_minute' };
  const ms = kind === 'invite' ? S.INVITE_DAYS * 86400000 : kind === 'admin-reset' ? S.ADMIN_RESET_HOURS * 3600000 : S.RESET_MINUTES * 60000;
  const { token, hash } = S.newLinkToken();
  const expires = new Date(now + ms).toISOString();
  const next = Object.assign({}, u);
  next[slot] = { hash, expires, sentAt: new Date(now).toISOString(), by: kind === 'reset' ? 'self' : (by && by.email) || '' };
  if (kind === 'admin-reset') {
    // The old password stops working and every open session ends.
    delete next.pwHash;
    next.sessionVersion = (u.sessionVersion || 0) + 1;
    next.fails = 0; next.lockedUntil = null;
    next.pwResetAt = new Date(now).toISOString(); next.pwResetBy = (by && by.email) || '';
  }
  await save(store, next);
  const link = `${appUrl()}/set-password#t=${token}`;
  const who = label(by);
  const role = u.role === 'admin' ? 'Admin' : 'HR';
  const msg = {
    invite: {
      subject: 'You are invited to the TalentCarriage Onboarding Agent',
      text: `Hello${u.name ? ' ' + u.name.split(' ')[0] : ''},\n\n${who} has given you access to the TalentCarriage AI Onboarding Agent as ${role}.\n\nSet your password to sign in. Your sign-in email is ${u.email}. The link works for ${S.INVITE_DAYS} days and only once.\n\nIf you did not expect this email, you can ignore it.`,
      button: 'Set your password'
    },
    reset: {
      subject: 'Reset your TalentCarriage Onboarding password',
      text: `Hello${u.name ? ' ' + u.name.split(' ')[0] : ''},\n\nSomeone asked to reset the password for ${u.email}. Choose a new password with the button below. The link works for ${S.RESET_MINUTES} minutes and only once.\n\nIf you did not ask for this, ignore this email: your password stays the same.`,
      button: 'Choose a new password'
    },
    'admin-reset': {
      subject: 'Your TalentCarriage Onboarding password was reset',
      text: `Hello${u.name ? ' ' + u.name.split(' ')[0] : ''},\n\n${who} has reset your password for the TalentCarriage AI Onboarding Agent. Your old password no longer works.\n\nChoose a new password with the button below. The link works for ${S.ADMIN_RESET_HOURS} hours and only once.`,
      button: 'Choose a new password'
    }
  }[kind];
  const out = { sent: false, to: u.email, expires };
  try {
    await email.send({ to: u.email, subject: msg.subject, text: msg.text, buttons: [{ label: msg.button, url: link }] });
    out.sent = true;
  } catch (e) {
    out.emailError = e.code || 'email_failed';
    if (kind !== 'reset') out.link = link; // an admin can share it another way
  }
  return out;
}

/* ---------- routes ---------- */
async function login(body, request) {
  if (!S.sameOrigin(request)) return json(403, { error: 'bad_origin' });
  const store = getStore();
  if (!store) return json(503, { error: 'database_not_configured' });
  const u = await userRec(store, body && body.email);
  const password = String((body && body.password) || '').slice(0, 200);
  const now = Date.now();
  if (u && u.lockedUntil && Date.parse(u.lockedUntil) > now) {
    await S.verifyPassword(password, null);
    return json(429, { error: 'locked', minutes: Math.ceil((Date.parse(u.lockedUntil) - now) / 60000) });
  }
  const ok = await S.verifyPassword(password, u && u.active !== false ? u.pwHash : null);
  if (!ok) {
    if (u && u.pwHash) {
      const fails = (u.fails || 0) + 1;
      const next = Object.assign({}, u, { fails: fails >= S.MAX_FAILS ? 0 : fails, lastFailAt: new Date(now).toISOString() });
      if (fails >= S.MAX_FAILS) next.lockedUntil = new Date(now + S.LOCK_MINUTES * 60000).toISOString();
      await save(store, next);
      if (fails >= S.MAX_FAILS) return json(429, { error: 'locked', minutes: S.LOCK_MINUTES });
    }
    return json(401, { error: 'wrong_login' });
  }
  // The password is right; the user list still decides (role, switched off).
  const next = Object.assign({}, u, { fails: 0, lockedUntil: null, lastLoginAt: new Date(now).toISOString() });
  await save(store, next);
  const token = await S.makeSession(store, next);
  return json(200, { ok: true, email: next.email }, { 'Set-Cookie': S.setCookie(token) });
}

function logout() {
  return json(200, { ok: true }, { 'Set-Cookie': S.clearCookie() });
}

// Always answers the same, whether the email is known or not.
async function forgot(body, request) {
  if (!S.sameOrigin(request)) return json(403, { error: 'bad_origin' });
  const store = getStore();
  if (store) {
    const u = await userRec(store, body && body.email).catch(() => null);
    if (u && u.active !== false && u.pwHash) await sendLink(store, u.email, 'reset', null, request).catch(() => null);
  }
  return json(200, { ok: true });
}

async function linkInfo(body) {
  const store = getStore();
  if (!store) return json(503, { error: 'database_not_configured' });
  const f = await byToken(store, body && body.token);
  if (!f || f.user.active === false) return json(404, { error: 'link_invalid' });
  return json(200, { ok: true, email: f.user.email, name: f.user.name || '', purpose: f.kind });
}

async function setPassword(body, request) {
  if (!S.sameOrigin(request)) return json(403, { error: 'bad_origin' });
  const store = getStore();
  if (!store) return json(503, { error: 'database_not_configured' });
  const f = await byToken(store, body && body.token);
  if (!f || f.user.active === false) return json(404, { error: 'link_invalid' });
  const password = String((body && body.password) || '');
  const problem = S.passwordProblem(password, f.user.email);
  if (problem) return json(400, { error: 'weak_password', problem });
  const now = new Date().toISOString();
  const next = Object.assign({}, f.user, { pwHash: await S.hashPassword(password), pwSetAt: now, sessionVersion: (f.user.sessionVersion || 0) + 1, fails: 0, lockedUntil: null, lastLoginAt: now });
  delete next.invite; delete next.reset;
  if (f.kind === 'invite') next.acceptedAt = now;
  await save(store, next);
  const token = await S.makeSession(store, next);
  return json(200, { ok: true, email: next.email }, { 'Set-Cookie': S.setCookie(token) });
}

async function httpAction({ action, body, request }) {
  try {
    if (action === 'login') return await login(body, request);
    if (action === 'logout') return logout();
    if (action === 'forgot') return await forgot(body, request);
    if (action === 'link-info') return await linkInfo(body);
    if (action === 'set-password') return await setPassword(body, request);
    return json(404, { error: 'unknown_action' });
  } catch (e) {
    return json(500, { error: 'sign_in_failed', detail: e.code || '' });
  }
}

module.exports = { httpAction, sendLink, login, setPassword, forgot, linkInfo, byToken };
