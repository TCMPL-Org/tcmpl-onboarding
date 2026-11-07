'use strict';
// Candidate conversations: links offers, candidates, messages and the agent.
// Stored in the same database as everything else:
//   candidates/wa-<phone>  -> who the candidate is, the client facts the agent may use, risk, handovers
//   messages/<id>          -> every inbound/outbound message, any channel

const crypto = require('node:crypto');
const { getStore } = require('./store');
const wa = require('./whatsapp');
const agent = require('./agent');
const documents = require('./documents');
const profile = require('./profile');
const induction = require('./induction');
const inductionRun = require('./induction-run');
const readiness = require('./readiness');
const checkins = require('./checkins');
const notify = require('./notify');

const SYSTEM = { name: 'onboarding-agent' };

function msgId(prefix, seed) {
  return prefix + '-' + crypto.createHash('sha1').update(String(seed)).digest('hex').slice(0, 24);
}
function newId(prefix) {
  return prefix + '-' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

async function history(store, candidateId) {
  const all = await store.list('messages');
  return all.map(r => r.data).filter(m => m && m.candidateId === candidateId).sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

async function saveMessage(store, id, m, user) {
  await store.put('messages', id, Object.assign({ at: new Date().toISOString(), channel: 'whatsapp' }, m), user || SYSTEM);
}

function str(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }

function niceDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return iso || '';
  return `${m[3]} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1]} ${m[1]}`;
}

const MAX_PDF_B64 = 1300000; // ~1 MB PDF; fits in one database record
const MEDIA_MAX_AGE_MS = 25 * 24 * 3600 * 1000; // WhatsApp keeps uploaded media for 30 days

// Returns a WhatsApp media id for the candidate's offer letter, re-uploading the PDF
// saved in the database when there is none yet or the upload is getting old.
async function letterMedia(store, candidateId, cand) {
  const fresh = cand.letterMediaId && cand.letterUploadedAt && (Date.now() - Date.parse(cand.letterUploadedAt)) < MEDIA_MAX_AGE_MS;
  if (fresh) return cand.letterMediaId;
  const rec = await store.get('letters', candidateId);
  if (!rec || !rec.data || !rec.data.pdfBase64) return cand.letterMediaId || '';
  cand.letterFile = rec.data.filename || cand.letterFile || 'Offer_Letter.pdf';
  cand.letterMediaId = await wa.uploadMedia(Buffer.from(rec.data.pdfBase64, 'base64'), 'application/pdf', cand.letterFile);
  cand.letterUploadedAt = new Date().toISOString();
  cand.hasLetter = true;
  return cand.letterMediaId;
}

// The offer details the journey needs to rebuild each touchpoint's standard message later.
function cleanProfile(p) {
  if (!p || typeof p !== 'object') return null;
  const out = {};
  for (const k of ['name', 'first', 'mobile', 'email', 'role', 'dept', 'grade', 'state', 'doj', 'mgr', 'client']) out[k] = str(p[k], 200);
  for (const k of ['ctc', 'monthly', 'gross']) out[k] = Number.isFinite(+p[k]) ? Math.round(+p[k]) : 0;
  out.isMgr = Boolean(p.isMgr); out.esic = Boolean(p.esic);
  return out;
}

// HR released an offer: register the candidate and send the opening template.
async function startForOffer(p, user) {
  const store = getStore();
  if (!store) return { status: 503, body: { error: 'database_not_configured' } };
  const phone = wa.normalizePhone(p && p.mobile);
  if (!phone) return { status: 400, body: { error: 'valid_mobile_required' } };
  const candidateId = wa.candidateIdFor(phone);
  const existing = await store.get('candidates', candidateId);
  const prev = (existing && existing.data) || {};
  const cand = {
    phone, name: str(p.name, 120), first: str(p.first, 60) || str(p.name, 120).split(' ')[0],
    email: str(p.email, 200), role: str(p.role, 200), client: str(p.client, 100), clientLabel: str(p.clientLabel, 200),
    company: str(p.company, 200), agentName: str(p.agentName, 60), recruiter: str(p.recruiter, 120), doj: str(p.doj, 40),
    facts: str(p.facts, 12000), faq: str(p.faq, 6000), offerId: str(p.offerId, 100),
    stage: 'Offer released', risk: prev.risk || [], riskScore: prev.riskScore || 0, handovers: prev.handovers || [],
    profile: cleanProfile(p.profile), releasedAt: new Date().toISOString(), touchpoints: prev.touchpoints || {},
    lastMessageAt: new Date().toISOString()
  };
  const pdf = typeof p.letterPdfBase64 === 'string' && p.letterPdfBase64.length > 100 && p.letterPdfBase64.length < MAX_PDF_B64 ? p.letterPdfBase64 : '';
  if (pdf) {
    cand.letterFile = str(p.letterFile, 150) || 'Offer_Letter.pdf';
    cand.letterProtected = Boolean(p.letterProtected);
    cand.letterSent = false;
    cand.letterMediaId = '';
    cand.hasLetter = true;
    await store.put('letters', candidateId, { pdfBase64: pdf, filename: cand.letterFile }, user);
    if (wa.waConfigured()) {
      try { cand.letterMediaId = await wa.uploadMedia(Buffer.from(pdf, 'base64'), 'application/pdf', cand.letterFile); cand.letterUploadedAt = new Date().toISOString(); }
      catch (e) { cand.letterError = e.message; }
    }
  }
  await store.put('candidates', candidateId, cand, user);
  // The same offer by email, with the letter attached and one-click Accept / Questions / Decline.
  if (await notify.toCandidate(store, candidateId, cand, {
    subject: `Your offer from ${cand.company || cand.clientLabel || 'us'}`, offer: true, kind: 'offer', key: 'offer',
    text: `Dear ${cand.first || cand.name || 'candidate'},\n\nCongratulations! Please find your offer letter for the role of ${cand.role || 'the position'} attached${cand.doj ? ', with joining on ' + niceDate(cand.doj) : ''}.${letterNote(cand)}\n\nWe have also sent it to you on WhatsApp, where our onboarding assistant can answer your questions.`,
    attachments: pdf ? [{ name: cand.letterFile, contentType: 'application/pdf', base64: pdf }] : []
  })) await store.put('candidates', candidateId, cand, user);
  if (!wa.waConfigured()) return { status: 200, body: { candidateId, sent: false, reason: 'whatsapp_not_configured' } };
  try {
    const doc = wa.templateWantsDocument() ? { id: await letterMedia(store, candidateId, cand), filename: cand.letterFile } : null;
    const sent = await wa.sendTemplate(phone, { first: cand.first, name: cand.name, company: cand.company || cand.clientLabel, role: cand.role, doj: niceDate(cand.doj), agent: cand.agentName }, doc);
    if (sent.withDocument) { cand.letterSent = true; }
    await store.put('candidates', candidateId, cand, user);
    await saveMessage(store, newId('o'), { candidateId, direction: 'out', text: `[Template: ${sent.template}]${sent.withDocument ? ' with offer letter PDF' : ''}`, waId: sent.id || '', by: user.name, kind: 'template' }, user);
    return { status: 200, body: { candidateId, sent: true } };
  } catch (e) {
    await saveMessage(store, newId('o'), { candidateId, direction: 'out', text: '[Template not sent]', error: e.message, kind: 'template' }, user);
    return { status: 502, body: { candidateId, sent: false, error: 'whatsapp_send_failed', detail: e.message } };
  }
}

// A candidate wrote to the WhatsApp number.
// Offer replies (the offer step's buttons are Accept offer / I have questions / Decline).
const ACCEPT = /^\s*(yes,? and )?i? ?accept/i;
const DECLINE = /^\s*(i )?(decline|want to decline|reject)\b/i;

// The letter is locked with the joining date (MMDDYYYY); the caption says how, never the password itself.
function letterNote(cand) {
  return cand.letterProtected ? '\n\nThe PDF is password-protected: the password is your joining date as MMDDYYYY (for example, 15 January 2027 would be 01152027).' : '';
}

async function handleInboundCore(m) {
  const store = getStore();
  if (!store || !m || !m.from) return;
  const id = msgId('m', m.id || (m.from + m.timestamp));
  if (await store.get('messages', id)) return; // Meta retries: handle each message once
  const candidateId = wa.candidateIdFor(m.from);
  const rec = await store.get('candidates', candidateId);
  const cand = rec ? rec.data : { phone: wa.normalizePhone(m.from), name: m.name || '', first: (m.name || '').split(' ')[0], stage: 'Unknown contact', risk: [], riskScore: 0, handovers: [] };
  const who = { name: 'whatsapp:' + cand.phone };
  const text = m.media ? `[${m.type === 'image' ? 'Photo' : 'File'}${m.media.filename ? ': ' + m.media.filename : ''}]${m.text ? ' ' + m.text : ''}` : (m.text || `[${m.type || 'message'} received]`);
  await saveMessage(store, id, { candidateId, direction: 'in', text, waId: m.id || '', kind: m.type || 'text' }, who);

  // Documents (photos, PDFs, consent and confirmation replies) are handled before the agent.
  if (rec) {
    let d = await documents.onInbound(store, candidateId, cand, m);
    if (!d.handled) d = profile.onInbound(cand, m);
    // Journey check-ins: whichever question was asked last gets the answer first.
    const ckp = cand.checkins && cand.checkins.pending;
    const ckFirst = ckp && [cand.readiness && cand.readiness.pending, cand.induction && cand.induction.pending].every(x => !x || !x.at || x.at <= ckp.at);
    const ck = async () => checkins.onInbound(cand, await inductionRun.setupFor(store, cand.profile && cand.profile.client), m);
    if (!d.handled && ckp && ckFirst) d = await ck();
    if (!d.handled && cand.readiness) d = readiness.onInbound(cand, m);
    if (!d.handled && cand.induction) d = induction.onInbound(cand, await inductionRun.planFor(store, cand.profile && cand.profile.client), m);
    if (!d.handled && ckp && !ckFirst) d = await ck();
    if (d.handled) {
      await inductionRun.deliver(store, candidateId, cand, d.replies, SYSTEM, '', 'agent');
      const now = new Date().toISOString();
      await store.put('candidates', candidateId, Object.assign({}, cand, { lastMessageAt: now, lastInboundAt: now }), SYSTEM);
      return;
    }
  }

  let out;
  if (!rec) {
    out = { source: 'system', reply: "Hello! This number sends onboarding updates for candidates with an offer. We couldn't find your offer yet, so we've told the hiring team.", handover: true, handoverReason: 'Message from a number with no offer on file.', riskSignals: [] };
  } else if (m.type !== 'text' && !m.text) {
    out = { source: 'system', reply: "Thanks, I've received it. The hiring team will review it.", handover: false, riskSignals: [] };
  } else {
    out = await agent.reply(await withLatestFacts(store, cand), await history(store, candidateId), text);
  }

  let waId = '', error = '';
  try { waId = (await wa.sendText(cand.phone, out.reply)).id || ''; } catch (e) { error = e.message; }
  await saveMessage(store, newId('o'), { candidateId, direction: 'out', text: out.reply, waId, error, source: out.source, kind: 'text' }, SYSTEM);

  // WhatsApp allows files once the candidate has written to us: send the offer letter now, once.
  let letterSent = Boolean(cand.letterSent);
  if (rec && (cand.letterMediaId || cand.hasLetter) && !letterSent) {
    const caption = `Your offer letter from ${cand.company || cand.clientLabel || 'us'}. Ask me anything about it here.${letterNote(cand)}`;
    let lid = '', lerr = '';
    try { const mid = await letterMedia(store, candidateId, cand); if (mid) { lid = (await wa.sendDocument(cand.phone, mid, cand.letterFile, caption)).id || ''; letterSent = !!lid; } } catch (e) { lerr = e.message; }
    await saveMessage(store, newId('o'), { candidateId, direction: 'out', text: `[Offer letter PDF] ${caption}`, waId: lid, error: lerr, source: 'agent', kind: 'document' }, SYSTEM);
  }

  const now = new Date().toISOString();
  const risk = Array.isArray(cand.risk) ? cand.risk.slice() : [];
  for (const s of (out.riskSignals || [])) if (!risk.some(r => r.label === s)) risk.push({ label: s, weight: agent.riskWeight(s), at: now });
  const handovers = Array.isArray(cand.handovers) ? cand.handovers.slice() : [];
  if (out.handover) handovers.push({ why: out.handoverReason || 'Needs a person', at: now, open: true });
  if (out.callback) handovers.push({ why: 'Call-back requested: ' + out.callback, at: now, open: true });
  if (DECLINE.test(text)) handovers.push({ why: 'Candidate wants to decline the offer: call them today', at: now, open: true });
  await store.put('candidates', candidateId, Object.assign({}, cand, {
    risk, riskScore: Math.min(100, risk.reduce((a, r) => a + (r.weight || 0), 0)), handovers,
    lastMessageAt: now, lastInboundAt: now, name: cand.name || m.name || '', letterSent,
    letterMediaId: cand.letterMediaId || '', letterUploadedAt: cand.letterUploadedAt, letterFile: cand.letterFile,
    stage: ACCEPT.test(text) ? 'Offer accepted' : DECLINE.test(text) ? 'Offer declined' : cand.stage,
    acceptedAt: ACCEPT.test(text) ? (cand.acceptedAt || now) : cand.acceptedAt,
    declinedAt: DECLINE.test(text) ? now : cand.declinedAt
  }), SYSTEM);
}

// HR replies by hand from the inbox.
async function sendManual(p, user) {
  const store = getStore();
  if (!store) return { status: 503, body: { error: 'database_not_configured' } };
  const candidateId = str(p && p.candidateId, 40);
  const text = str(p && p.text, 4000).trim();
  if (!/^wa-\d{11,15}$/.test(candidateId) || !text) return { status: 400, body: { error: 'candidate_and_text_required' } };
  const rec = await store.get('candidates', candidateId);
  if (!rec) return { status: 404, body: { error: 'candidate_not_found' } };
  if (!wa.waConfigured()) return { status: 503, body: { error: 'whatsapp_not_configured' } };
  try {
    const sent = await wa.sendText(rec.data.phone, text);
    await saveMessage(store, newId('o'), { candidateId, direction: 'out', text, waId: sent.id || '', by: user.name, source: 'hr', kind: 'text' }, user);
    return { status: 200, body: { sent: true } };
  } catch (e) {
    const w = windowError(e); w.body.sent = false;
    return w;
  }
}

// HR sends a prepared journey touchpoint (or the offer letter again) from the app.
// items: [{type:'text', text, buttons?:[..]}, {type:'letter', pdfBase64?, filename?}]
async function pushItems(p, user) {
  const store = getStore();
  if (!store) return { status: 503, body: { error: 'database_not_configured' } };
  const viaWa = p.wa !== false;
  if (viaWa && !wa.waConfigured()) return { status: 503, body: { error: 'whatsapp_not_configured' } };
  const candidateId = str(p && p.candidateId, 40);
  if (!/^wa-\d{11,15}$/.test(candidateId)) return { status: 400, body: { error: 'candidate_required' } };
  const items = Array.isArray(p.items) ? p.items.slice(0, 10) : [];
  if (!items.length) return { status: 400, body: { error: 'nothing_to_send' } };
  const rec = await store.get('candidates', candidateId);
  if (!rec) return { status: 404, body: { error: 'candidate_not_found' } };
  const cand = Object.assign({}, rec.data);
  const label = str(p.touchpoint, 120);
  let sent = 0, emailed = false;
  // Email copy first (once; a held WhatsApp send is replayed later without emailing again).
  if (p.email !== false && !p.emailed) {
    const lt = items.find(it => it && it.type === 'letter');
    let att = [];
    if (lt) {
      const fresh = typeof lt.pdfBase64 === 'string' && lt.pdfBase64.length > 100 && lt.pdfBase64.length < MAX_PDF_B64 ? lt.pdfBase64 : '';
      const saved = fresh ? null : await store.get('letters', candidateId);
      const b64 = fresh || (saved && saved.data && saved.data.pdfBase64) || '';
      if (b64) att = [{ name: str(lt.filename, 150) || cand.letterFile || 'Offer_Letter.pdf', contentType: 'application/pdf', base64: b64 }];
    }
    const texts = items.filter(it => it && it.type === 'text' && typeof it.text === 'string').map(it => it.text.trim());
    const opts = items.filter(it => it && Array.isArray(it.buttons)).flatMap(it => it.buttons);
    const isOffer = str(p.touchpointKey, 60) === 'offer' || (lt && opts.some(b => /accept/i.test(b)));
    emailed = await notify.toCandidate(store, candidateId, cand, {
      subject: `${label || 'Onboarding update'} · ${cand.company || cand.clientLabel || ''}`.replace(/ · $/, ''), kind: 'journey', key: str(p.touchpointKey, 60),
      text: texts.join('\n\n') + (lt ? (texts.length ? '\n\n' : '') + `Your offer letter is attached.${letterNote(cand)}` : ''),
      options: isOffer ? [] : opts, offer: Boolean(isOffer), attachments: att
    });
  }
  for (const it of (viaWa ? items : [])) {
    try {
      if (it && it.type === 'letter') {
        if (typeof it.pdfBase64 === 'string' && it.pdfBase64.length > 100 && it.pdfBase64.length < MAX_PDF_B64) {
          cand.letterFile = str(it.filename, 150) || cand.letterFile || 'Offer_Letter.pdf';
          cand.letterProtected = Boolean(it.protected);
          await store.put('letters', candidateId, { pdfBase64: it.pdfBase64, filename: cand.letterFile }, user);
          cand.letterMediaId = ''; cand.letterUploadedAt = ''; cand.hasLetter = true;
        }
        const mid = await letterMedia(store, candidateId, cand);
        if (!mid) return { status: 400, body: { sent, error: 'no_offer_letter' } };
        const caption = `Your offer letter from ${cand.company || cand.clientLabel || 'us'}.${letterNote(cand)}`;
        const r = await wa.sendDocument(cand.phone, mid, cand.letterFile, caption);
        cand.letterSent = true;
        await saveMessage(store, newId('o'), { candidateId, direction: 'out', text: `[Offer letter PDF] ${caption}`, waId: r.id || '', by: user.name, source: 'journey', touchpoint: label, kind: 'document' }, user);
      } else if (it && it.type === 'text' && typeof it.text === 'string' && it.text.trim()) {
        const text = it.text.trim().slice(0, 4000);
        const buttons = Array.isArray(it.buttons) ? it.buttons.filter(b => typeof b === 'string' && b.trim()).slice(0, 3) : [];
        const r = buttons.length && text.length <= 1024 ? await wa.sendButtons(cand.phone, text, buttons) : await wa.sendText(cand.phone, text);
        await saveMessage(store, newId('o'), { candidateId, direction: 'out', text: buttons.length ? `${text}\n[Buttons: ${buttons.join(' | ')}]` : text, waId: r.id || '', by: user.name, source: 'journey', touchpoint: label, kind: buttons.length ? 'interactive' : 'text' }, user);
      } else continue;
      sent++;
    } catch (e) {
      const code = e.detail && e.detail.code;
      // 131047: more than 24 hours since the candidate last wrote; only templates are allowed.
      const windowClosed = code === 131047 || /24 hours|re-engagement/i.test(e.message || '');
      return { status: windowClosed ? 409 : 502, body: { sent, error: windowClosed ? 'window_closed' : 'whatsapp_send_failed', detail: e.message } };
    }
  }
  cand.lastMessageAt = new Date().toISOString();
  if (!viaWa && !emailed) return { status: 502, body: { sent: 0, error: 'email_failed', detail: cand.lastEmailError || 'No candidate email, or email is switched off for this client.' } };
  if (label) cand.stage = label;
  const key = str(p.touchpointKey, 60);
  if (key) cand.touchpoints = Object.assign({}, cand.touchpoints, { [key]: { at: cand.lastMessageAt, by: user.name, label } });
  await store.put('candidates', candidateId, cand, user);
  return { status: 200, body: { sent, emailed } };
}

function windowError(e) {
  const code = e.detail && e.detail.code;
  const windowClosed = code === 131047 || /24 hours|re-engagement/i.test(e.message || '');
  return { status: windowClosed ? 409 : 502, body: { error: windowClosed ? 'window_closed' : 'whatsapp_send_failed', detail: e.message } };
}

async function loadCand(store, candidateId) {
  if (!/^wa-\d{11,15}$/.test(String(candidateId || ''))) return null;
  const rec = await store.get('candidates', candidateId);
  return rec ? Object.assign({}, rec.data) : null;
}

// HR asks the candidate the joining-form questions on WhatsApp.
async function askDetails(p, user) {
  const store = getStore();
  if (!store) return { status: 503, body: { error: 'database_not_configured' } };
  if (!wa.waConfigured()) return { status: 503, body: { error: 'whatsapp_not_configured' } };
  const candidateId = str(p && p.candidateId, 40);
  const cand = await loadCand(store, candidateId);
  if (!cand) return { status: 404, body: { error: 'candidate_not_found' } };
  const q = profile.start(cand, { full: Boolean(p.full), forms: Array.isArray(p.forms) ? p.forms.map(String).slice(0, 5) : undefined });
  if (!q) { await store.put('candidates', candidateId, cand, user); return { status: 200, body: { sent: 0, nothingMissing: true } }; }
  try {
    const r = q.buttons ? await wa.sendButtons(cand.phone, q.text, q.buttons) : await wa.sendText(cand.phone, q.text);
    await saveMessage(store, newId('o'), { candidateId, direction: 'out', text: q.buttons ? `${q.text}\n[Buttons: ${q.buttons.join(' | ')}]` : q.text, waId: r.id || '', by: user.name, source: 'journey', kind: q.buttons ? 'interactive' : 'text' }, user);
  } catch (e) { return windowError(e); }
  cand.lastMessageAt = new Date().toISOString();
  await store.put('candidates', candidateId, cand, user);
  return { status: 200, body: { sent: 1 } };
}

// HR saves corrections / confirmations made in the Joining forms tab.
async function saveForms(p, user) {
  const store = getStore();
  if (!store) return { status: 503, body: { error: 'database_not_configured' } };
  const candidateId = str(p && p.candidateId, 40);
  const cand = await loadCand(store, candidateId);
  if (!cand) return { status: 404, body: { error: 'candidate_not_found' } };
  const pick = (o, max) => { const out = {}; if (o && typeof o === 'object') for (const [k, v] of Object.entries(o).slice(0, 400)) if (/^[\w:.-]{1,80}$/.test(k) && typeof v === 'string') out[k] = v.slice(0, max); return out; };
  const f = Object.assign({}, cand.forms);
  f.vals = pick(p.vals, 1000);
  f.states = pick(p.states, 20);
  f.savedBy = user.name; f.savedAt = new Date().toISOString();
  if (p.approve === true) { f.approvedBy = user.name; f.approvedAt = f.savedAt; cand.stage = 'Forms approved by HR'; }
  if (p.approve === false) { f.approvedBy = ''; f.approvedAt = ''; }
  cand.forms = f;
  await store.put('candidates', candidateId, cand, user);
  return { status: 200, body: { ok: true, forms: f } };
}

// HR sends the filled forms (PDFs made in the browser) to the candidate to confirm.
async function sendForms(p, user) {
  const store = getStore();
  if (!store) return { status: 503, body: { error: 'database_not_configured' } };
  if (!wa.waConfigured()) return { status: 503, body: { error: 'whatsapp_not_configured' } };
  const candidateId = str(p && p.candidateId, 40);
  const cand = await loadCand(store, candidateId);
  if (!cand) return { status: 404, body: { error: 'candidate_not_found' } };
  const files = (Array.isArray(p.files) ? p.files : []).filter(x => x && typeof x.pdfBase64 === 'string' && x.pdfBase64.length > 100 && x.pdfBase64.length < 1500000).slice(0, 8);
  if (!files.length) return { status: 400, body: { error: 'no_forms' } };
  let sent = 0;
  if (!p.emailed) {
    await notify.toCandidate(store, candidateId, cand, {
      subject: `Your joining forms · ${cand.company || cand.clientLabel || ''}`.replace(/ · $/, ''), kind: 'forms', key: 'forms',
      text: (str(p.text, 1000) || 'These are your joining forms, filled from your documents and answers. Please check every detail, especially names, dates of birth and nominee shares.') ,
      options: ['All correct', 'Something is wrong'],
      attachments: files.map(x => ({ name: (str(x.filename, 120) || 'Joining_form.pdf').replace(/[^\w.-]+/g, '_'), contentType: 'application/pdf', base64: x.pdfBase64 }))
    });
  }
  try {
    for (const x of files) {
      const name = (str(x.filename, 120) || 'Joining_form.pdf').replace(/[^\w.-]+/g, '_');
      const mid = await wa.uploadMedia(Buffer.from(x.pdfBase64, 'base64'), 'application/pdf', name);
      const r = await wa.sendDocument(cand.phone, mid, name, str(x.caption, 200));
      await saveMessage(store, newId('o'), { candidateId, direction: 'out', text: `[Form PDF] ${name}`, waId: r.id || '', by: user.name, source: 'journey', kind: 'document' }, user);
      sent++;
    }
    const text = str(p.text, 1000) || `These are your joining forms, filled from your documents and answers. Please check every detail, especially names, dates of birth and nominee shares.\n\nIs everything correct?`;
    const r = await wa.sendButtons(cand.phone, text, ['All correct', 'Something is wrong']);
    await saveMessage(store, newId('o'), { candidateId, direction: 'out', text: `${text}\n[Buttons: All correct | Something is wrong]`, waId: r.id || '', by: user.name, source: 'journey', kind: 'interactive' }, user);
  } catch (e) { const w = windowError(e); w.body.sent = sent; return w; }
  const now = new Date().toISOString();
  cand.forms = Object.assign({}, cand.forms, { sentAt: now, sentBy: user.name, pendingConfirm: true, awaitNote: false, candidateConfirmedAt: '', candidateNote: '' });
  cand.lastMessageAt = now; cand.stage = 'Forms sent to candidate';
  await store.put('candidates', candidateId, cand, user);
  return { status: 200, body: { sent } };
}

// Which WhatsApp questions each form still needs (shown on the per-form buttons).
async function missingDetails(p) {
  const store = getStore();
  if (!store) return { status: 503, body: { error: 'database_not_configured' } };
  const cand = await loadCand(store, str(p && p.candidateId, 40));
  if (!cand) return { status: 404, body: { error: 'candidate_not_found' } };
  return { status: 200, body: { missing: profile.missingByForm(cand), inProgress: Boolean(cand.details && cand.details.step) } };
}

// The agent always answers with the client's latest facts (saved from Client setup); the candidate's own
// offer line (role, joining date, pay, manager) is kept from their offer.
async function withLatestFacts(store, cand) {
  const client = cand.profile && cand.profile.client;
  if (!client) return cand;
  const f = await store.get('facts', String(client)).catch(() => null);
  if (!f || !f.data || !f.data.facts) return cand;
  const offerLine = String(cand.facts || '').split('\n').find(l => /^offer:/.test(l)) || '';
  return Object.assign({}, cand, { facts: f.data.facts + (offerLine ? '\n' + offerLine : ''), faq: f.data.faq || cand.faq });
}

async function handleInbound(m) {
  await handleInboundCore(m);
  // The candidate just wrote, so the 24-hour window is open: send anything HR queued while it was closed.
  const store = getStore();
  if (store && m && m.from) await replayHeld(store, wa.candidateIdFor(m.from)).catch(e => console.error('replay failed', e && e.message));
}

/* ---------- messages held while the 24-hour window is closed ---------- */
const HOLDABLE = ['push', 'text', 'docs', 'details', 'forms'];

async function hold(candidateId, action, payload, user) {
  const store = getStore();
  if (!store || !HOLDABLE.includes(action)) return { status: 409, body: { error: 'window_closed' } };
  const rec = await store.get('candidates', candidateId);
  if (!rec) return { status: 404, body: { error: 'candidate_not_found' } };
  const cand = Object.assign({}, rec.data);
  const entry = { action, payload, by: user.name, at: new Date().toISOString() };
  if (JSON.stringify(entry).length > 900000) return { status: 409, body: { error: 'window_closed' } };
  cand.held = (cand.held || []).concat([entry]).slice(-10);
  let nudged = false;
  const tpl = (process.env.WHATSAPP_NUDGE_TEMPLATE || '').trim();
  if (tpl && (!cand.nudgedAt || Date.now() - Date.parse(cand.nudgedAt) > 12 * 3600000)) {
    try {
      const first = (cand.profile && cand.profile.first) || (cand.name || '').split(' ')[0] || 'there';
      const r = await wa.sendNamedTemplate(cand.phone, tpl, process.env.WHATSAPP_NUDGE_TEMPLATE_LANG || 'en', [first, 'your onboarding']);
      cand.nudgedAt = new Date().toISOString(); nudged = true;
      await saveMessage(store, newId('o'), { candidateId, direction: 'out', text: `[Template ${tpl}] reminder to reply`, waId: r.id || '', by: user.name, source: 'system', kind: 'template' }, user);
    } catch (e) { console.error('nudge failed', e && e.message); }
  }
  await store.put('candidates', candidateId, cand, user);
  return { status: 202, body: { held: true, nudged, waiting: cand.held.length } };
}

async function replayHeld(store, candidateId) {
  const rec = await store.get('candidates', candidateId);
  if (!rec || !Array.isArray(rec.data.held) || !rec.data.held.length) return 0;
  const held = rec.data.held;
  await store.put('candidates', candidateId, Object.assign({}, rec.data, { held: [] }), { name: 'onboarding-agent' });
  for (const h of held) {
    const user = { name: h.by || 'onboarding-agent' };
    const p = Object.assign({}, h.payload, { candidateId, emailed: true });
    if (h.action === 'push') await pushItems(p, user);
    else if (h.action === 'text') await sendManual(p, user);
    else if (h.action === 'docs') await documents.request(store, candidateId, user);
    else if (h.action === 'details') await askDetails(p, user);
    else if (h.action === 'forms') await sendForms(p, user);
  }
  return held.length;
}

module.exports = { hold, replayHeld, withLatestFacts, startForOffer, handleInbound, sendManual, pushItems, askDetails, saveForms, sendForms, missingDetails };
