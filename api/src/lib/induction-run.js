'use strict';
// Runs induction: sends what is due (called by the scheduler), HR "Send now", content uploads,
// and delivers messages (text, buttons, files) with the 24-hour-window fallback.

const crypto = require('node:crypto');
const wa = require('./whatsapp');
const blob = require('./blob');
const induction = require('./induction');
const { getStore } = require('./store');

const SYSTEM = { name: 'onboarding-agent' };
const newId = p => `${p}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

async function planFor(store, clientId) {
  if (!clientId) return null;
  const rec = await store.get('plans', String(clientId));
  return rec ? rec.data : null;
}

// WhatsApp media id for an uploaded content file (re-uploaded to Meta when older than 25 days).
async function contentMedia(store, file) {
  const rec = await store.get('content', file.id);
  if (!rec) throw Object.assign(new Error('Content file not found'), { code: 'content_missing' });
  const c = Object.assign({}, rec.data);
  if (c.waMediaId && c.waUploadedAt && Date.now() - Date.parse(c.waUploadedAt) < 25 * 864e5) return { id: c.waMediaId, name: c.name };
  const f = await blob.getFile(c.blobPath);
  c.waMediaId = await wa.uploadMedia(f.buffer, c.mime || f.contentType, c.name);
  c.waUploadedAt = new Date().toISOString();
  await store.put('content', file.id, c, SYSTEM);
  return { id: c.waMediaId, name: c.name };
}

function windowClosed(e) {
  const code = e && e.detail && e.detail.code;
  return code === 131047 || /24 hours|re-engagement/i.test((e && e.message) || '');
}

// Sends messages in order. If WhatsApp refuses because the 24-hour window is closed, the rest are held on the
// candidate (induction.waiting) and go out when the candidate next writes; an approved "nudge" template
// (WHATSAPP_NUDGE_TEMPLATE, body {{1}} = first name, {{2}} = what it's about) asks them to reply.
async function deliver(store, candidateId, cand, msgs, by, about) {
  let sent = 0;
  for (let i = 0; i < msgs.length; i++) {
    const r = msgs[i];
    let waId, text;
    try {
      if (r.file) {
        const media = await contentMedia(store, r.file);
        waId = (await wa.sendDocument(cand.phone, media.id, media.name, r.caption || '')).id || '';
        text = `[File] ${media.name}`;
      } else if (r.buttons && r.buttons.length) {
        waId = (await wa.sendButtons(cand.phone, r.text, r.buttons)).id || '';
        text = `${r.text}\n[Buttons: ${r.buttons.join(' | ')}]`;
      } else {
        waId = (await wa.sendText(cand.phone, r.text)).id || '';
        text = r.text;
      }
      sent++;
      await saveOut(store, candidateId, text, waId, '', by, r.file ? 'document' : r.buttons ? 'interactive' : 'text');
    } catch (e) {
      if (windowClosed(e)) {
        const ind = cand.induction = Object.assign({ items: {} }, cand.induction);
        ind.waiting = (ind.waiting || []).concat(msgs.slice(i)).slice(-10);
        const tpl = (process.env.WHATSAPP_NUDGE_TEMPLATE || '').trim();
        let note = 'Held until the candidate next writes (24-hour window closed).';
        if (tpl) {
          try {
            const first = (cand.profile && cand.profile.first) || (cand.name || '').split(' ')[0] || 'there';
            const t = await wa.sendNamedTemplate(cand.phone, tpl, process.env.WHATSAPP_NUDGE_TEMPLATE_LANG || 'en', [first, about || 'your onboarding']);
            note = 'Sent a reminder template; the message goes out when the candidate replies.';
            await saveOut(store, candidateId, `[Template ${tpl}] ${about || ''}`, t.id || '', '', by, 'template');
          } catch (te) { note += ' Template failed: ' + te.message; }
        }
        await saveOut(store, candidateId, r.text || (r.file && r.file.name) || '', '', note, by, 'held');
        return { sent, held: msgs.length - i };
      }
      await saveOut(store, candidateId, r.text || (r.file && `[File] ${r.file.name}`) || '', '', e.message, by, 'text');
      return { sent, error: e.message };
    }
  }
  return { sent };
}

async function saveOut(store, candidateId, text, waId, error, by, kind) {
  await store.put('messages', newId('o'), { candidateId, direction: 'out', text, waId, error, source: 'induction', kind, at: new Date().toISOString() }, by || SYSTEM);
}

// Scheduler: send everything that is due, for every candidate. Stops before the function time limit.
async function tick(now = Date.now(), budgetMs = 35000) {
  const store = getStore();
  if (!store || !wa.waConfigured()) return { ok: false, reason: 'not_configured' };
  const started = Date.now();
  const plans = {};
  let candidates = 0, groups = 0;
  for (const rec of await store.list('candidates')) {
    if (Date.now() - started > budgetMs) break;
    const cand = Object.assign({}, rec.data);
    const clientId = cand.profile && cand.profile.client;
    if (!clientId || !cand.phone) continue;
    if (!(clientId in plans)) plans[clientId] = await planFor(store, clientId);
    if (!plans[clientId]) continue;
    const before = JSON.stringify(cand.induction || null);
    const due = induction.due(cand, plans[clientId], now);
    for (const g of due) { await deliver(store, rec.id, cand, g.msgs, SYSTEM, g.msgs[0] && (g.msgs[0].caption || String(g.msgs[0].text || '').split('\n')[0])); groups++; }
    if (due.length || JSON.stringify(cand.induction || null) !== before) {
      if (due.length) cand.lastMessageAt = new Date().toISOString();
      await store.put('candidates', rec.id, cand, SYSTEM);
      candidates++;
    }
  }
  return { ok: true, candidates, sent: groups, ms: Date.now() - started };
}

// HR: send one milestone now (for testing, or to resend).
async function sendNow(p, user) {
  const store = getStore();
  if (!store) return { status: 503, body: { error: 'database_not_configured' } };
  if (!wa.waConfigured()) return { status: 503, body: { error: 'whatsapp_not_configured' } };
  const candidateId = str(p && p.candidateId, 40);
  const rec = /^wa-\d{11,15}$/.test(candidateId) ? await store.get('candidates', candidateId) : null;
  if (!rec) return { status: 404, body: { error: 'candidate_not_found' } };
  const cand = Object.assign({}, rec.data);
  const plan = await planFor(store, cand.profile && cand.profile.client);
  if (!plan) return { status: 404, body: { error: 'no_induction_plan' } };
  const r = induction.sendNow(cand, plan, str(p.itemId, 80));
  if (!r) return { status: 404, body: { error: 'milestone_not_found' } };
  if (r.error) return { status: 400, body: { error: r.error } };
  const d = await deliver(store, candidateId, cand, r.msgs, user, '');
  cand.lastMessageAt = new Date().toISOString();
  await store.put('candidates', candidateId, cand, user);
  if (d.error) return { status: 502, body: { error: 'whatsapp_send_failed', detail: d.error } };
  return { status: 200, body: d };
}

// HR uploads a deck / policy PDF for a client's induction.
const MIMES = /^(application\/pdf|application\/vnd\.openxmlformats-officedocument\.(presentationml\.presentation|wordprocessingml\.document)|application\/vnd\.ms-powerpoint|application\/msword|image\/(jpeg|png)|video\/mp4)$/;
async function uploadContent(p, user) {
  const store = getStore();
  if (!store || !blob.storageConfigured()) return { status: 503, body: { error: 'storage_not_configured' } };
  const client = str(p && p.client, 60).replace(/[^\w-]/g, '');
  const name = (str(p && p.filename, 120) || 'file').replace(/[^\w.() -]+/g, '_');
  const mime = str(p && p.mime, 120);
  if (!client) return { status: 400, body: { error: 'client_required' } };
  if (!MIMES.test(mime)) return { status: 400, body: { error: 'file_type_not_allowed', detail: 'PDF, PowerPoint, Word, JPG, PNG or MP4' } };
  const buf = Buffer.from(str(p && p.data, 30000000), 'base64');
  if (buf.length < 50) return { status: 400, body: { error: 'empty_file' } };
  if (buf.length > 16 * 1024 * 1024) return { status: 413, body: { error: 'file_too_large', detail: 'Max 16 MB. For larger videos, use a link.' } };
  const id = newId('c');
  const blobPath = `content/${client}/${id}-${name}`;
  await blob.putFile(blobPath, buf, mime);
  const meta = { client, name, mime, size: buf.length, blobPath, uploadedBy: user.name, uploadedAt: new Date().toISOString() };
  await store.put('content', id, meta, user);
  return { status: 200, body: { id, name, mime, size: buf.length } };
}

async function contentFile(id) {
  const store = getStore();
  if (!store || !blob.storageConfigured()) return { status: 503 };
  const rec = /^c-[\w-]{6,40}$/.test(String(id || '')) ? await store.get('content', id) : null;
  if (!rec) return { status: 404 };
  const f = await blob.getFile(rec.data.blobPath);
  return { status: 200, buffer: f.buffer, contentType: rec.data.mime || f.contentType, name: rec.data.name };
}

module.exports = { planFor, deliver, tick, sendNow, uploadContent, contentFile };
