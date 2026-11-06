'use strict';
// Runs induction: sends what is due (called by the scheduler), HR "Send now", content uploads,
// and delivers messages (text, buttons, files) with the 24-hour-window fallback.

const crypto = require('node:crypto');
const wa = require('./whatsapp');
const blob = require('./blob');
const induction = require('./induction');
const readiness = require('./readiness');
const notify = require('./notify');
const links = require('./links');
const emailLib = require('./email');
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
async function deliver(store, candidateId, cand, msgs, by, about, source = 'induction') {
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
      await saveOut(store, candidateId, text, waId, '', by, r.file ? 'document' : r.buttons ? 'interactive' : 'text', source);
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

async function saveOut(store, candidateId, text, waId, error, by, kind, source = 'induction') {
  await store.put('messages', newId('o'), { candidateId, direction: 'out', text, waId, error, source, kind, at: new Date().toISOString() }, by || SYSTEM);
}

// The candidate's own clock: real time, or moved by the Walkthrough clock (clockOffsetMs) for demos.
const nowFor = (cand, now = Date.now()) => now + (+cand.clockOffsetMs || 0);
const IST = 330 * 60000;
const atIst = (iso, hh = 10) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], hh) - IST : null; };

// Everything due for one candidate at its (possibly simulated) time. Mutates cand; returns the number of sends.
async function runCandidate(store, id, cand, plans, realNow = Date.now()) {
  const clientId = cand.profile && cand.profile.client;
  if (!clientId || !cand.phone) return 0;
  if (!(clientId in plans)) plans[clientId] = await planFor(store, clientId);
  const now = nowFor(cand, realNow);
  let sends = 0;
  // 1. WhatsApp: Day-1 readiness checks first (time-critical), then induction.
  let due = readiness.due(cand, now);
  if (!due.length && plans[clientId]) due = induction.due(cand, plans[clientId], now);
  const norm = plans[clientId] ? induction.normalizePlan(plans[clientId]) : { items: [] };
  for (const g of due) {
    await deliver(store, id, cand, g.msgs, SYSTEM, g.msgs[0] && (g.msgs[0].caption || String(g.msgs[0].text || '').split('\n')[0]));
    sends++;
    // A meeting's "did it happen?" also goes to its owner by email, with one-click answers.
    const it = norm.items.find(x => x.id === g.id);
    const ownerTo = it && it.kind === 'session' && g.pending && g.pending.type === 'check' ? emailLib.addresses(it.owner) : [];
    const st = it && (cand.induction.items || {})[it.id];
    if (ownerTo.length && st && !st.ownerAskedAt) {
      const ok = await notify.auto(store, id, cand, {
        to: ownerTo, kind: 'induction-owner', k: it.id,
        subject: `Did "${it.title}" with ${cand.name} happen?`,
        text: `Hello,\n\n"${it.title}" with ${cand.name} was planned for this time. Please let us know if it happened.`,
        buttons: [{ label: 'Yes, it happened', url: links.link({ c: id, k: it.id, a: 'ind-yes', t: it.title }) }, { label: 'Not yet', url: links.link({ c: id, k: it.id, a: 'ind-no', t: it.title }), secondary: true }].filter(b => b.url)
      });
      if (ok) st.ownerAskedAt = new Date(now).toISOString();
    }
  }
  // 2. Owners: reminder the day before the due date, escalation to HR the day after.
  const r = cand.readiness && cand.readiness.items;
  if (r) {
    const st = await notify.settings(store, clientId);
    for (const [k, it] of Object.entries(r)) {
      if (it.status === 'done' || !it.ownerEmail || !it.dueDate) continue;
      const dueAt = atIst(it.dueDate, 10);
      if (!dueAt) continue;
      if (!it.reminderAt && now >= dueAt - 864e5 && now < dueAt + 864e5 && it.status !== 'issue') {
        const ok = await notify.auto(store, id, cand, {
          to: it.ownerEmail, cc: it.cc, kind: 'owner-reminder', k,
          subject: `Reminder: ${it.task || k} for ${cand.name} is due ${it.dueDate}`,
          text: `Hello,\n\nA reminder that "${it.task || k}" for ${cand.name} is due on ${it.dueDate}. If it is already done, please click below.`,
          buttons: [{ label: 'Mark as done', url: links.link({ c: id, k, a: 'done' }) }, { label: 'Report a problem', url: links.link({ c: id, k, a: 'issue' }), secondary: true }].filter(b => b.url)
        });
        if (ok) { it.reminderAt = new Date(now).toISOString(); sends++; }
      }
      if (!it.escalatedAt && now >= dueAt + 864e5) {
        const hr = notify.hrAddress(st);
        it.escalatedAt = new Date(now).toISOString();
        cand.handovers = (cand.handovers || []).concat([{ why: `Day-1 readiness overdue: "${it.task || k}" (owner ${it.ownerEmail})`, at: it.escalatedAt, open: true }]);
        if (hr) {
          const ok = await notify.auto(store, id, cand, {
            to: hr, cc: it.ownerEmail, kind: 'owner-escalation', k,
            subject: `Overdue for ${cand.name}: ${it.task || k}`,
            text: `"${it.task || k}" for ${cand.name} was due on ${it.dueDate} and is still not marked done by ${it.ownerEmail}.`,
            buttons: [{ label: 'Mark as done', url: links.link({ c: id, k, a: 'done' }) }].filter(b => b.url)
          });
          if (ok) sends++;
        }
      }
    }
  }
  if (sends) cand.lastMessageAt = new Date().toISOString();
  return sends;
}

// Scheduler: everything due for every candidate. Stops before the function time limit.
async function tick(realNow = Date.now(), budgetMs = 35000) {
  const store = getStore();
  if (!store || !wa.waConfigured()) return { ok: false, reason: 'not_configured' };
  const started = Date.now();
  const plans = {};
  let candidates = 0, sent = 0;
  for (const rec of await store.list('candidates')) {
    if (Date.now() - started > budgetMs) break;
    const cand = Object.assign({}, rec.data);
    const before = JSON.stringify([cand.induction || null, cand.readiness || null, (cand.handovers || []).length]);
    const n = await runCandidate(store, rec.id, cand, plans, realNow);
    sent += n;
    if (n || JSON.stringify([cand.induction || null, cand.readiness || null, (cand.handovers || []).length]) !== before) { await store.put('candidates', rec.id, cand, SYSTEM); candidates++; }
  }
  return { ok: true, candidates, sent, ms: Date.now() - started };
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

// Day-1 readiness: HR updates a task, or sends a candidate check now.
async function readyAction(action, p, user) {
  const store = getStore();
  if (!store) return { status: 503, body: { error: 'database_not_configured' } };
  const candidateId = str(p && p.candidateId, 40);
  const rec = /^wa-\d{11,15}$/.test(candidateId) ? await store.get('candidates', candidateId) : null;
  if (!rec) return { status: 404, body: { error: 'candidate_not_found' } };
  const cand = Object.assign({}, rec.data);
  if (action === 'update') {
    const r = readiness.update(cand, p, user);
    if (r.error) return { status: 400, body: r };
    await store.put('candidates', candidateId, cand, user);
    return { status: 200, body: { item: r.item, readiness: cand.readiness } };
  }
  if (action === 'ask') {
    if (!wa.waConfigured()) return { status: 503, body: { error: 'whatsapp_not_configured' } };
    const q = readiness.sendNow(cand, str(p.qid, 20));
    if (!q) return { status: 404, body: { error: 'question_not_found' } };
    const d = await deliver(store, candidateId, cand, q.msgs, user, 'Day-1 check');
    cand.lastMessageAt = new Date().toISOString();
    await store.put('candidates', candidateId, cand, user);
    if (d.error) return { status: 502, body: { error: 'whatsapp_send_failed', detail: d.error } };
    return { status: 200, body: d };
  }
  return { status: 404, body: { error: 'unknown_action' } };
}

module.exports = { planFor, deliver, tick, runCandidate, nowFor, sendNow, uploadContent, contentFile, readyAction };
