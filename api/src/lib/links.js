'use strict';
// Signed one-click links in emails ("Mark as done", "Yes, it happened"): no sign-in needed, can't be forged.
const crypto = require('node:crypto');

function secret() { return process.env.LINK_SECRET || process.env.CRON_SECRET || process.env.WHATSAPP_APP_SECRET || ''; }
const b64 = s => Buffer.from(s).toString('base64url');

function sign(payload, days = 60) {
  const s = secret(); if (!s) return '';
  const body = b64(JSON.stringify(Object.assign({}, payload, { exp: Date.now() + days * 864e5 })));
  const mac = crypto.createHmac('sha256', s).update(body).digest('base64url').slice(0, 32);
  return `${body}.${mac}`;
}

function verify(token) {
  const s = secret(); const [body, mac] = String(token || '').split('.');
  if (!s || !body || !mac) return null;
  const want = crypto.createHmac('sha256', s).update(body).digest('base64url').slice(0, 32);
  if (want.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(mac))) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
}

function appUrl() { return (process.env.APP_URL || 'https://lively-island-0f17b1b00.3.azurestaticapps.net').replace(/\/+$/, ''); }
const link = (payload, days) => { const t = sign(payload, days); return t ? `${appUrl()}/api/confirm?t=${t}` : ''; };

module.exports = { sign, verify, link, appUrl };
