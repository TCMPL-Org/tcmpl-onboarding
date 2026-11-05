'use strict';
// WhatsApp Business Platform (Meta Cloud API) adapter.
// App settings:
//   WHATSAPP_TOKEN            permanent (system user) or temporary access token
//   WHATSAPP_PHONE_NUMBER_ID  the sending number's ID (WhatsApp -> API Setup)
//   WHATSAPP_APP_SECRET       Meta app secret, used to verify incoming webhooks
//   WHATSAPP_VERIFY_TOKEN     any phrase you choose; typed into Meta's webhook setup
//   WHATSAPP_TEMPLATE         template sent when an offer is released (default: hello_world)
//   WHATSAPP_TEMPLATE_LANG    template language code (default: en_US)
//   WHATSAPP_TEMPLATE_PARAMS  comma list of body parameters, e.g. "first,company" (default: none)
//   WHATSAPP_GRAPH_VERSION    Graph API version (default: v23.0)

const crypto = require('node:crypto');

function waConfigured() {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}
function webhookConfigured() {
  return Boolean(process.env.WHATSAPP_APP_SECRET && process.env.WHATSAPP_VERIFY_TOKEN);
}

// Digits only, with India's country code added to bare 10-digit mobile numbers.
function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D+/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = '91' + d;
  return d.length >= 11 && d.length <= 15 ? d : '';
}

function candidateIdFor(phone) {
  const p = normalizePhone(phone);
  return p ? 'wa-' + p : '';
}

function verifySignature(rawBody, header) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !header || !String(header).startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const got = String(header).slice(7);
  if (got.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got, 'hex'), Buffer.from(expected, 'hex'));
}

// Pulls user messages out of a Meta webhook payload.
function parseInbound(body) {
  const out = [];
  const entries = (body && Array.isArray(body.entry)) ? body.entry : [];
  for (const entry of entries) {
    for (const change of (entry.changes || [])) {
      const v = change.value || {};
      const names = {};
      (v.contacts || []).forEach(c => { if (c.wa_id) names[c.wa_id] = c.profile && c.profile.name; });
      for (const m of (v.messages || [])) {
        let text = '';
        if (m.type === 'text') text = (m.text && m.text.body) || '';
        else if (m.type === 'button') text = (m.button && m.button.text) || '';
        else if (m.type === 'interactive') {
          const i = m.interactive || {};
          text = (i.button_reply && i.button_reply.title) || (i.list_reply && i.list_reply.title) || '';
        }
        let media = null;
        if (m.type === 'image' || m.type === 'document') {
          const md = m[m.type] || {};
          media = { id: md.id, mime: md.mime_type || '', filename: md.filename || '', caption: md.caption || '' };
          text = md.caption || '';
        }
        out.push({ id: m.id, from: m.from, name: names[m.from] || '', type: m.type, text, media, timestamp: m.timestamp });
      }
    }
  }
  return out;
}

async function graph(payload) {
  const version = process.env.WHATSAPP_GRAPH_VERSION || 'v23.0';
  const url = `https://graph.facebook.com/${version}/${encodeURIComponent(process.env.WHATSAPP_PHONE_NUMBER_ID)}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
    body: JSON.stringify(Object.assign({ messaging_product: 'whatsapp' }, payload)),
    signal: AbortSignal.timeout(20000)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (body && body.error) || {};
    const e = new Error(err.message || `WhatsApp API returned ${res.status}`);
    e.code = 'whatsapp_error';
    e.detail = { status: res.status, code: err.code, subcode: err.error_subcode };
    throw e;
  }
  return { id: body.messages && body.messages[0] && body.messages[0].id };
}

async function sendText(to, text) {
  return graph({ to: normalizePhone(to), type: 'text', text: { preview_url: false, body: String(text).slice(0, 4000) } });
}

// Sends the opening template. Settings:
//   WHATSAPP_TEMPLATE          template name (default hello_world)
//   WHATSAPP_TEMPLATE_LANG     language code exactly as in WhatsApp Manager (e.g. en, en_US)
//   WHATSAPP_TEMPLATE_PARAMS   body variables in order, from: first, name, company, role, doj, agent
//   WHATSAPP_TEMPLATE_HEADER   "document" when the template's header is a document (the offer letter)
async function sendTemplate(to, values, doc) {
  const name = (process.env.WHATSAPP_TEMPLATE || 'hello_world').trim();
  const lang = (process.env.WHATSAPP_TEMPLATE_LANG || 'en_US').trim();
  const keys = (process.env.WHATSAPP_TEMPLATE_PARAMS || '').split(',').map(s => s.trim()).filter(Boolean);
  const wantsDoc = /^document$/i.test((process.env.WHATSAPP_TEMPLATE_HEADER || '').trim());
  const template = { name, language: { code: lang } };
  const components = [];
  if (wantsDoc) {
    if (!doc || !doc.id) { const e = new Error('The opening template needs the offer letter PDF, but none is available'); e.code = 'no_offer_letter'; throw e; }
    components.push({ type: 'header', parameters: [{ type: 'document', document: { id: doc.id, filename: String(doc.filename || 'Offer_Letter.pdf').slice(0, 200) } }] });
  }
  if (keys.length) components.push({ type: 'body', parameters: keys.map(k => ({ type: 'text', text: String((values && values[k]) || '-').slice(0, 200) })) });
  if (components.length) template.components = components;
  const sent = await graph({ to: normalizePhone(to), type: 'template', template });
  return Object.assign({ template: name, withDocument: wantsDoc }, sent);
}

// Any approved template by name, with body values in order ({{1}}, {{2}}, ...).
async function sendNamedTemplate(to, name, lang, bodyValues) {
  const template = { name, language: { code: lang || 'en' } };
  if (bodyValues && bodyValues.length) template.components = [{ type: 'body', parameters: bodyValues.map(v => ({ type: 'text', text: String(v || '-').replace(/\s+/g, ' ').slice(0, 200) })) }];
  return graph({ to: normalizePhone(to), type: 'template', template });
}

function templateWantsDocument() { return /^document$/i.test((process.env.WHATSAPP_TEMPLATE_HEADER || '').trim()); }

async function uploadMedia(buffer, mime, filename) {
  const version = process.env.WHATSAPP_GRAPH_VERSION || 'v23.0';
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mime);
  form.append('file', new Blob([buffer], { type: mime }), filename);
  const res = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(process.env.WHATSAPP_PHONE_NUMBER_ID)}/media`, {
    method: 'POST', headers: { authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }, body: form, signal: AbortSignal.timeout(30000)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.id) { const e = new Error((body.error && body.error.message) || `Media upload returned ${res.status}`); e.code = 'whatsapp_error'; throw e; }
  return body.id;
}

async function sendDocument(to, mediaId, filename, caption) {
  return graph({ to: normalizePhone(to), type: 'document', document: { id: mediaId, filename: String(filename || 'Offer_Letter.pdf').slice(0, 200), caption: String(caption || '').slice(0, 1000) } });
}

// Text with up to 3 tappable reply buttons (WhatsApp limit: 3 buttons, 20 characters each).
async function sendButtons(to, text, titles) {
  const buttons = (titles || []).slice(0, 3).map((t, i) => ({ type: 'reply', reply: { id: 'b' + i, title: String(t).slice(0, 20) } }));
  return graph({ to: normalizePhone(to), type: 'interactive', interactive: { type: 'button', body: { text: String(text).slice(0, 1024) }, action: { buttons } } });
}

// Downloads a file the candidate sent (Meta keeps it for about 30 days).
async function downloadMedia(mediaId, maxBytes = 15000000) {
  const version = process.env.WHATSAPP_GRAPH_VERSION || 'v23.0';
  const auth = { authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` };
  const meta = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(mediaId)}`, { headers: auth, signal: AbortSignal.timeout(15000) });
  const info = await meta.json().catch(() => ({}));
  if (!meta.ok || !info.url) { const e = new Error((info.error && info.error.message) || `Media lookup returned ${meta.status}`); e.code = 'whatsapp_error'; throw e; }
  if (info.file_size && info.file_size > maxBytes) { const e = new Error('File too large'); e.code = 'file_too_large'; throw e; }
  const res = await fetch(info.url, { headers: auth, signal: AbortSignal.timeout(30000) });
  if (!res.ok) { const e = new Error(`Media download returned ${res.status}`); e.code = 'whatsapp_error'; throw e; }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > maxBytes) { const e = new Error('File too large'); e.code = 'file_too_large'; throw e; }
  return { buffer, mime: info.mime_type || res.headers.get('content-type') || 'application/octet-stream' };
}

module.exports = { sendNamedTemplate, downloadMedia, templateWantsDocument, sendButtons, uploadMedia, sendDocument, waConfigured, webhookConfigured, normalizePhone, candidateIdFor, verifySignature, parseInbound, sendText, sendTemplate };
