'use strict';
// Email through Azure Communication Services.
// App settings:
//   ACS_CONNECTION_STRING  Communication Service → Settings → Keys → connection string
//   ACS_SENDER             a verified MailFrom address, e.g. DoNotReply@<id>.azurecomm.net (walkthroughs)
//                          or onboarding@talentcarriage.com once that domain is verified
// The sender's display name is set on the MailFrom address in Azure. Per client we set Reply-To and CC.

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

function emailConfigured() { return Boolean(process.env.ACS_CONNECTION_STRING && process.env.ACS_SENDER); }

// "Rohit Verma, IT <rohit@x.com>; a@b.com" → ['rohit@x.com', 'a@b.com']
function addresses(v) {
  const list = Array.isArray(v) ? v : String(v || '').split(/[;,\n]/);
  const out = [];
  for (const raw of list) {
    const m = /([^\s<>,;]+@[^\s<>,;]+\.[^\s<>,;]+)/.exec(String(raw || ''));
    if (m && EMAIL_RE.test(m[1]) && !out.includes(m[1].toLowerCase())) out.push(m[1].toLowerCase());
  }
  return out.slice(0, 20);
}

const escHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Plain text + simple HTML (paragraphs, and buttons for links).
function htmlOf(text, buttons) {
  const paras = String(text || '').split(/\n{2,}/).map(p => `<p style="margin:0 0 12px">${escHtml(p).replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</p>`).join('');
  const btns = (buttons || []).map(b => `<a href="${escHtml(b.url)}" style="display:inline-block;margin:4px 8px 4px 0;padding:10px 16px;border-radius:6px;background:${b.secondary ? '#ffffff' : '#0f6e6e'};color:${b.secondary ? '#0f6e6e' : '#ffffff'};border:1px solid #0f6e6e;text-decoration:none;font-weight:600">${escHtml(b.label)}</a>`).join('');
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1d2a30;max-width:620px">${paras}${btns ? `<p style="margin:16px 0">${btns}</p>` : ''}<p style="margin:20px 0 0;font-size:12px;color:#667">Sent by the TCMPL AI Onboarding Agent.</p></div>`;
}

let client = null;
async function send({ to, cc, subject, text, buttons, replyTo }) {
  if (!emailConfigured()) { const e = new Error('Email is not configured'); e.code = 'email_not_configured'; throw e; }
  const toList = addresses(to), ccList = addresses(cc).filter(a => !toList.includes(a)), reply = addresses(replyTo);
  if (!toList.length) { const e = new Error('No valid email address'); e.code = 'no_recipient'; throw e; }
  if (!client) { const { EmailClient } = require('@azure/communication-email'); client = new EmailClient(process.env.ACS_CONNECTION_STRING); }
  const plain = String(text || '') + ((buttons || []).length ? '\n\n' + buttons.map(b => `${b.label}: ${b.url}`).join('\n') : '');
  const message = {
    senderAddress: process.env.ACS_SENDER,
    content: { subject: String(subject || '').slice(0, 250), plainText: plain, html: htmlOf(text, buttons) },
    recipients: { to: toList.map(address => ({ address })), cc: ccList.map(address => ({ address })) },
    replyTo: reply.map(address => ({ address }))
  };
  const poller = await client.beginSend(message);
  const res = await poller.pollUntilDone();
  if (res.status && !/succeeded/i.test(res.status)) { const e = new Error('Email not sent: ' + res.status); e.code = 'email_failed'; throw e; }
  return { id: res.id || '', to: toList, cc: ccList };
}

module.exports = { emailConfigured, addresses, send, htmlOf, _setClient: c => { client = c; } };
