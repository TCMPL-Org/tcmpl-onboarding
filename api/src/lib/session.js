'use strict';
// Email + password sign-in for people outside Microsoft (Microsoft sign-in through Static Web Apps stays as well).
//
// Passwords:  scrypt (N=16384, r=8, p=1, 64-byte key, 16-byte random salt), stored as "scrypt$16384$8$1$<salt>$<hash>".
// Sessions:   a signed cookie "tc_session" (HttpOnly, Secure, SameSite=Strict, Path=/api), 12 hours, holding the email,
//             a random id and the user's sessionVersion. Changing or resetting a password, or switching a user off,
//             ends every session of that user at once (the version no longer matches / the user is not active).
// Links:      invite (7 days) and reset (1 hour; 24 hours when an admin starts it) links carry a random 32-byte token;
//             only its SHA-256 is stored, and it works once.
// Secret:     SESSION_SECRET (Azure setting, 32+ characters) signs the cookies. Without it, a random secret is made
//             once and kept in the database (users/_system:session), so sign-in works with no extra setup.

const crypto = require('node:crypto');

const COOKIE = 'tc_session';
const SESSION_HOURS = 12;
const INVITE_DAYS = 7;
const RESET_MINUTES = 60;
const ADMIN_RESET_HOURS = 24;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const SCRYPT = { N: 16384, r: 8, p: 1, len: 64 };
const SECRET_ID = '_system:session';

const b64u = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = s => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');

function scrypt(password, salt, o = SCRYPT) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password), salt, o.len, { N: o.N, r: o.r, p: o.p, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, b64u(salt), b64u(key)].join('$');
}

// Always does the same amount of work, also for an unknown user (no hint which emails exist).
const DUMMY = 'scrypt$16384$8$1$' + b64u(Buffer.alloc(16, 7)) + '$' + b64u(Buffer.alloc(64, 7));
async function verifyPassword(password, stored) {
  const parts = String(stored || DUMMY).split('$');
  const use = parts.length === 6 && parts[0] === 'scrypt' ? parts : DUMMY.split('$');
  const o = { N: +use[1], r: +use[2], p: +use[3], len: SCRYPT.len };
  const want = fromB64u(use[5]);
  const got = await scrypt(password, fromB64u(use[4]), Object.assign(o, { len: want.length || SCRYPT.len }));
  return Boolean(stored) && want.length === got.length && crypto.timingSafeEqual(want, got);
}

// Rules a new password must meet; '' when fine.
const COMMON = new Set(['password', 'password1', 'password123', '1234567890', '12345678901', 'qwertyuiop', 'iloveyou12', 'welcome123', 'admin12345', 'talentcarriage', 'onboarding']);
function passwordProblem(password, email) {
  const p = String(password || '');
  if (p.length < 10) return 'too_short';
  if (p.length > 200) return 'too_long';
  if (COMMON.has(p.toLowerCase())) return 'too_common';
  const local = String(email || '').split('@')[0].toLowerCase();
  if (local.length >= 4 && p.toLowerCase().includes(local)) return 'contains_email';
  if (/^(.)\1+$/.test(p)) return 'too_common';
  return '';
}

/* ---------- signing secret ---------- */
let secretCache = null;
async function secret(store) {
  const env = String(process.env.SESSION_SECRET || '');
  if (env.length >= 32) return env;
  if (secretCache) return secretCache;
  if (!store) throw Object.assign(new Error('no secret'), { code: 'session_not_configured' });
  const rec = await store.get('users', SECRET_ID).catch(() => null);
  if (rec && rec.data && typeof rec.data.secret === 'string' && rec.data.secret.length >= 32) return (secretCache = rec.data.secret);
  const made = b64u(crypto.randomBytes(48));
  await store.put('users', SECRET_ID, { secret: made, createdAt: new Date().toISOString(), note: 'Signs sign-in cookies. Set SESSION_SECRET in Azure to replace it.' }, { name: 'system' });
  return (secretCache = made);
}

const sign = (key, text) => b64u(crypto.createHmac('sha256', key).update(text).digest());

async function makeSession(store, user) {
  const payload = { e: String(user.email).toLowerCase(), v: user.sessionVersion || 0, s: b64u(crypto.randomBytes(9)), x: Date.now() + SESSION_HOURS * 3600000 };
  const body = b64u(JSON.stringify(payload));
  return body + '.' + sign(await secret(store), body);
}

// { e, v, s, x } when the cookie is genuine and not expired, else null. Does not look at the user record.
async function readSession(store, token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig || body.length > 600) return null;
  let key;
  try { key = await secret(store); } catch { return null; }
  const want = Buffer.from(sign(key, body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(fromB64u(body).toString('utf8'));
    if (!p || typeof p.e !== 'string' || !(p.x > Date.now())) return null;
    return p;
  } catch { return null; }
}

/* ---------- cookies ---------- */
function header(request, name) {
  const h = request && request.headers;
  if (!h) return '';
  return String((typeof h.get === 'function' ? h.get(name) : h[name] || h[name.toLowerCase()]) || '');
}
function cookieFrom(request) {
  for (const part of header(request, 'cookie').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}
const setCookie = token => `${COOKIE}=${encodeURIComponent(token)}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`;
const clearCookie = () => `${COOKIE}=; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

// A browser on another site cannot use the cookie (SameSite=Strict); as a second check, a POST that says where it
// comes from must come from this app.
function sameOrigin(request) {
  const origin = header(request, 'origin');
  if (!origin) return true;
  const host = header(request, 'x-forwarded-host') || header(request, 'host');
  try { return new URL(origin).host === host.split(',')[0].trim(); } catch { return false; }
}

/* ---------- one-time links ---------- */
function newLinkToken() {
  const token = b64u(crypto.randomBytes(32));
  return { token, hash: sha256(token) };
}
const tokenMatches = (token, hash) => {
  if (!token || !hash) return false;
  const a = Buffer.from(sha256(token)), b = Buffer.from(String(hash));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

module.exports = {
  COOKIE, SESSION_HOURS, INVITE_DAYS, RESET_MINUTES, ADMIN_RESET_HOURS, MAX_FAILS, LOCK_MINUTES,
  hashPassword, verifyPassword, passwordProblem, makeSession, readSession, cookieFrom, setCookie, clearCookie,
  sameOrigin, newLinkToken, tokenMatches, header, SECRET_ID, _forgetSecret: () => { secretCache = null; }
};
