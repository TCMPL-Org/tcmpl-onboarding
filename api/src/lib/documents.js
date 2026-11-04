'use strict';
// Candidate documents on WhatsApp: consent, collection, OCR, Aadhaar masking, checks,
// candidate confirmation and HR review.
//
// Stored:
//   candidates/<id>.docs   -> consent, what we are waiting for, a status per document
//   candidates/<id>.kyc    -> confirmed values used to fill the joining forms
//   documents/<id>.<type>  -> fields, checks and confidence per document (HR only)
//   Blob candidate-docs/<id>/<type>-<time>.<ext> -> the file (Aadhaar: masked photo only)
// The full Aadhaar number is never stored.

const ocr = require('./ocr');
const deps = {
  wa: require('./whatsapp'),
  docintel: require('./docintel'),
  blob: require('./blob'),
  mask: require('./mask')
};

const SYSTEM = { name: 'onboarding-agent' };
const ORDER = ['aadhaar', 'pan', 'bank'];
const DOCS = {
  aadhaar: { label: 'Aadhaar card', ask: 'Please send a clear photo of the *front* of your Aadhaar card (the side with your photo). A photo or screenshot works. Please don\'t send the password-protected e-Aadhaar PDF.' },
  pan: { label: 'PAN card', ask: 'Next, please send a clear photo of your *PAN card*.' },
  bank: { label: 'bank proof', ask: 'Last one: please send a photo of a *cancelled cheque* or the *first page of your bank passbook*. It should show your name, account number and IFSC.' }
};
const CONSENT_VERSION = 'docs-v1';
const DONE = ['confirmed', 'needs_review'];

const nowIso = () => new Date().toISOString();
const docId = (candidateId, type) => `${candidateId}.${type}`;

function consentText(cand) {
  const co = cand.company || cand.clientLabel || 'The hiring team';
  return `Before you share documents: ${co} will use your Aadhaar, PAN and bank details only for your joining forms (PF, ESIC, gratuity) and payroll.\n\n` +
    'Your Aadhaar is saved with the first 8 digits hidden, in a private store in India. You can ask us to delete your documents at any time.\n\nTap *I agree* to continue.';
}

function nextMissing(d) {
  const items = d.items || {};
  return ORDER.find(t => !items[t] || !DONE.includes(items[t].status)) || null;
}

function askNext(cand) {
  const d = cand.docs;
  const t = nextMissing(d);
  d.awaiting = t;
  if (!t) {
    d.completedAt = d.completedAt || nowIso();
    cand.stage = 'Documents submitted';
    return { text: 'That\'s everything for now, thank you! HR will review your documents and get back to you if anything else is needed.' };
  }
  return { text: DOCS[t].ask };
}

/* ---------- reading one file ---------- */
async function processMedia(store, candidateId, cand, media) {
  const d = cand.docs;
  const expected = d.awaiting || nextMissing(d);
  const isPdf = /pdf/i.test(media.mime || '') || /\.pdf$/i.test(media.filename || '');
  const isImage = /^image\//i.test(media.mime || '');
  if (!isPdf && !isImage) return [{ text: 'Please send the document as a photo or a PDF.' }];
  if (isPdf && expected === 'aadhaar') return [{ text: 'For Aadhaar, please send a *photo or screenshot* of the front of the card instead of the PDF. The e-Aadhaar PDF is password-protected, so I can\'t read it.' }];

  let file;
  try { file = await deps.wa.downloadMedia(media.id); }
  catch (e) { return [{ text: e.code === 'file_too_large' ? 'That file is too large. Please send a photo instead.' : 'I couldn\'t open that file. Please send it again.' }]; }
  let buffer = file.buffer;
  if (isImage) { try { buffer = await deps.mask.shrinkPhoto(buffer); } catch { return [{ text: 'I couldn\'t open that photo. Please send it again.' }]; } }
  else if (buffer.length > 3900000) return [{ text: 'That PDF is larger than 4 MB. Please send a photo of the page instead.' }];

  let result;
  try {
    const model = expected === 'bank' ? 'prebuilt-read' : 'prebuilt-idDocument';
    result = await deps.docintel.analyzeWithFallback(model, buffer, isImage && expected !== 'bank' ? ['barcodes'] : []);
  } catch (e) {
    if (/password/i.test(e.code + ' ' + e.message)) return [{ text: 'That PDF is password-protected. Please send a photo or screenshot instead.' }];
    console.error('docintel failed', e && e.message);
    return [{ text: 'Sorry, I couldn\'t read that just now. Please send it again in a minute.' }];
  }

  const kind = ocr.classify(result);
  if (kind === 'other' || !DOCS[kind]) {
    return [{ text: `This doesn't look like your ${DOCS[expected] ? DOCS[expected].label : 'document'}. Please send a clear, well-lit photo of it, with the whole card in the frame.` }];
  }
  const type = kind;
  const ex = ocr.extract(type, result);
  const checks = ex.checks.concat(ocr.crossChecks(type, ex.fields, cand.kyc));
  const low = ocr.lowConfidence(ex.confidence);

  // Save the file. Aadhaar: only a masked photo, and only if masking can be verified.
  let blobPath = '', contentType = '', fileNote = '';
  const stamp = Date.now();
  try {
    if (type === 'aadhaar') {
      const regions = isImage ? ocr.maskRegions(result, ex.secret.number) : [];
      const digitBoxes = regions.filter(r => r.kind === 'digits').length;
      if (!ex.secret.number || !digitBoxes) fileNote = 'Photo not saved: the Aadhaar number could not be located for masking.';
      else {
        const masked = await deps.mask.maskImage(buffer, regions);
        blobPath = `${candidateId}/aadhaar-${stamp}.jpg`; contentType = masked.contentType;
        await deps.blob.putFile(blobPath, masked.buffer, contentType);
        if (!regions.some(r => r.kind === 'qr')) checks.push({ key: 'qr', label: 'QR code found and masked', ok: false });
      }
    } else {
      contentType = isPdf ? 'application/pdf' : (isImage && buffer !== file.buffer ? 'image/jpeg' : file.mime);
      blobPath = `${candidateId}/${type}-${stamp}.${isPdf ? 'pdf' : 'jpg'}`;
      await deps.blob.putFile(blobPath, buffer, contentType);
    }
  } catch (e) {
    blobPath = '';
    fileNote = e.code === 'masking_unsafe' ? 'Photo not saved: masking could not be verified.' : 'File not saved: storage error.';
    console.error('document save failed', e && e.message);
  }

  const rec = {
    candidateId, type, status: 'read', receivedAt: nowIso(), fileStored: Boolean(blobPath), blobPath, contentType, fileNote,
    fields: ex.fields, account: type === 'bank' ? (ex.secret.account || '') : undefined,
    confidence: ex.confidence, low, checks, model: result.modelId || ''
  };
  await store.put('documents', docId(candidateId, type), rec, SYSTEM);
  d.items = Object.assign({}, d.items, { [type]: { status: 'read', at: rec.receivedAt } });
  d.pendingConfirm = type;
  d.pendingFix = null;
  d.awaiting = type;

  const sum = ocr.summaryText(type, ex.fields);
  const intro = type !== expected && expected ? `Got it, this is your ${DOCS[type].label}.` : `Thanks! Here's what I read from your ${DOCS[type].label}:`;
  let text = `${intro}\n\n${sum.shown.join('\n') || '(I could not read the details clearly)'}`;
  if (sum.missing.length) text += `\n\nI couldn't read: ${sum.missing.join(', ')}.`;
  if (low.length) text += '\n\nSome of this was hard to read, so please check it carefully.';
  text += '\n\nIs this correct?';
  return [{ text, buttons: ['Yes, correct', 'Fix something'] }];
}

/* ---------- confirmation ---------- */
async function confirm(store, candidateId, cand, type, by) {
  const rec = await store.get('documents', docId(candidateId, type));
  const data = rec ? Object.assign({}, rec.data) : { candidateId, type, fields: {}, checks: [] };
  const failed = (data.checks || []).some(c => !c.ok) || (data.low || []).length > 0 || !data.fileStored;
  data.status = failed ? 'needs_review' : 'confirmed';
  data.candidateConfirmedAt = nowIso();
  await store.put('documents', docId(candidateId, type), data, by || SYSTEM);
  cand.docs.items = Object.assign({}, cand.docs.items, { [type]: { status: data.status, at: data.candidateConfirmedAt } });
  applyKyc(cand, type, data.fields || {});
  return data.status;
}

function applyKyc(cand, type, f) {
  const k = Object.assign({}, cand.kyc);
  if (type === 'aadhaar') {
    if (f.name) { k.name = f.name; k.nameFrom = 'Aadhaar'; }
    if (f.dob) { k.dob = f.dob; k.dobFrom = 'Aadhaar'; }
    if (f.gender) k.gender = f.gender;
    if (f.aadhaarLast4) k.aadhaarLast4 = f.aadhaarLast4;
    if (f.address) k.address = f.address;
  } else if (type === 'pan') {
    if (f.pan) k.pan = f.pan;
    if (f.father) k.father = f.father;
    if (f.name && !k.name) { k.name = f.name; k.nameFrom = 'PAN'; }
    if (f.dob && !k.dob) { k.dob = f.dob; k.dobFrom = 'PAN'; }
  } else if (type === 'bank') {
    k.bank = { holder: f.holder || '', accountLast4: f.accountLast4 || '', ifsc: f.ifsc || '', bank: f.bank || '' };
  }
  cand.kyc = k;
}

/* ---------- inbound messages ---------- */
// Returns { handled, replies } — when handled, the agent does not answer this message.
async function onInbound(store, candidateId, cand, m) {
  const d = cand.docs = Object.assign({ items: {} }, cand.docs);
  const text = String(m.text || '').trim();

  if (m.media && m.media.id) {
    if (!d.consentAt) {
      d.requestedAt = d.requestedAt || nowIso();
      d.held = (d.held || []).concat([m.media]).slice(-3);
      return { handled: true, replies: [{ text: consentText(cand), buttons: ['I agree', 'Not now'] }] };
    }
    return { handled: true, replies: await processMedia(store, candidateId, cand, m.media) };
  }

  if (d.requestedAt && !d.consentAt) {
    if (/^(yes,?\s*)?i\s*agree\b|^agree$/i.test(text)) {
      d.consentAt = nowIso(); d.consentVersion = CONSENT_VERSION; d.declinedAt = null;
      const held = d.held || []; d.held = [];
      if (held.length) {
        const replies = [{ text: 'Thank you. Reading your document now…' }];
        for (const h of held.slice(-1)) replies.push(...await processMedia(store, candidateId, cand, h));
        return { handled: true, replies };
      }
      return { handled: true, replies: [{ text: 'Thank you.' }, askNext(cand)] };
    }
    if (/^not\s*now\b/i.test(text)) {
      d.declinedAt = nowIso(); d.held = [];
      cand.handovers = (cand.handovers || []).concat([{ why: 'Candidate did not agree to share documents yet', at: nowIso(), open: true }]);
      return { handled: true, replies: [{ text: 'No problem. When you\'re ready, just send *documents* here and we\'ll continue.' }] };
    }
  }

  if (d.pendingConfirm) {
    const type = d.pendingConfirm;
    if (/^(yes|correct|yes,?\s*correct|ok|okay|right)\b/i.test(text)) {
      d.pendingConfirm = null;
      await confirm(store, candidateId, cand, type);
      return { handled: true, replies: [{ text: 'Saved, thank you.' }, askNext(cand)] };
    }
    if (/^(fix|no|wrong|incorrect|change)/i.test(text)) {
      d.pendingConfirm = null; d.pendingFix = type;
      return { handled: true, replies: [{ text: 'Please type what\'s wrong and the correct value. For example: *Date of birth is 12/03/1995*.' }] };
    }
  }

  if (d.pendingFix && text) {
    const type = d.pendingFix; d.pendingFix = null;
    const rec = await store.get('documents', docId(candidateId, type));
    const data = rec ? Object.assign({}, rec.data) : { candidateId, type, fields: {}, checks: [] };
    data.candidateCorrection = text.slice(0, 500);
    data.status = 'needs_review';
    data.candidateConfirmedAt = nowIso();
    await store.put('documents', docId(candidateId, type), data, SYSTEM);
    d.items = Object.assign({}, d.items, { [type]: { status: 'needs_review', at: data.candidateConfirmedAt } });
    applyKyc(cand, type, data.fields || {});
    return { handled: true, replies: [{ text: 'Thanks, I\'ve noted that for HR to correct.' }, askNext(cand)] };
  }

  if (/^(documents?|docs?|upload)$/i.test(text)) {
    if (!d.consentAt) { d.requestedAt = d.requestedAt || nowIso(); return { handled: true, replies: [{ text: consentText(cand), buttons: ['I agree', 'Not now'] }] }; }
    return { handled: true, replies: [askNext(cand)] };
  }

  return { handled: false, replies: [] };
}

/* ---------- HR actions ---------- */
async function sendReplies(phone, replies) {
  const ids = [];
  for (const r of replies) {
    const out = r.buttons && r.buttons.length ? await deps.wa.sendButtons(phone, r.text, r.buttons) : await deps.wa.sendText(phone, r.text);
    ids.push(out.id || '');
  }
  return ids;
}

// HR asks the candidate for documents (consent first if not given yet).
async function request(store, candidateId, user) {
  const rec = await store.get('candidates', candidateId);
  if (!rec) return { status: 404, body: { error: 'candidate_not_found' } };
  const cand = Object.assign({}, rec.data);
  const d = cand.docs = Object.assign({ items: {} }, cand.docs);
  d.requestedAt = nowIso(); d.requestedBy = user.name; d.declinedAt = null;
  const replies = d.consentAt ? [askNext(cand)] : [{ text: consentText(cand), buttons: ['I agree', 'Not now'] }];
  try { await sendReplies(cand.phone, replies); }
  catch (e) {
    const code = e.detail && e.detail.code;
    const windowClosed = code === 131047 || /24 hours|re-engagement/i.test(e.message || '');
    return { status: windowClosed ? 409 : 502, body: { error: windowClosed ? 'window_closed' : 'whatsapp_send_failed', detail: e.message } };
  }
  cand.lastMessageAt = nowIso();
  await store.put('candidates', candidateId, cand, user);
  return { status: 200, body: { sent: replies.length, replies } };
}

// HR approves (optionally correcting fields) or rejects a document.
const EDITABLE = { aadhaar: ['name', 'dob', 'gender', 'address'], pan: ['pan', 'name', 'father', 'dob'], bank: ['holder', 'ifsc', 'bank', 'accountLast4'] };
async function review(store, p, user) {
  const candidateId = String((p && p.candidateId) || ''), type = String((p && p.type) || '');
  if (!/^wa-\d{11,15}$/.test(candidateId) || !EDITABLE[type]) return { status: 400, body: { error: 'candidate_and_type_required' } };
  const [crec, drec] = await Promise.all([store.get('candidates', candidateId), store.get('documents', docId(candidateId, type))]);
  if (!crec || !drec) return { status: 404, body: { error: 'not_found' } };
  const cand = Object.assign({}, crec.data); cand.docs = Object.assign({ items: {} }, cand.docs);
  const data = Object.assign({}, drec.data);
  const action = p.action === 'reject' ? 'reject' : 'approve';
  if (action === 'approve') {
    const f = Object.assign({}, data.fields);
    const edits = (p.fields && typeof p.fields === 'object') ? p.fields : {};
    const changed = [];
    for (const k of EDITABLE[type]) if (typeof edits[k] === 'string' && edits[k].trim() !== (f[k] || '')) { f[k] = edits[k].trim().slice(0, 300); changed.push(k); }
    if (type === 'bank' && typeof edits.account === 'string' && /^\d{9,18}$/.test(edits.account)) { data.account = edits.account; f.accountLast4 = edits.account.slice(-4); changed.push('account'); }
    data.fields = f;
    data.status = 'confirmed';
    data.history = (data.history || []).concat([{ at: nowIso(), by: user.name, action: 'approved', changed }]);
    applyKyc(cand, type, f);
  } else {
    data.status = 'rejected';
    data.history = (data.history || []).concat([{ at: nowIso(), by: user.name, action: 'rejected', note: String(p.note || '').slice(0, 300) }]);
  }
  data.reviewedBy = user.name; data.reviewedAt = nowIso();
  cand.docs.items = Object.assign({}, cand.docs.items, { [type]: { status: data.status, at: data.reviewedAt } });
  await store.put('documents', docId(candidateId, type), data, user);
  await store.put('candidates', candidateId, cand, user);
  return { status: 200, body: { status: data.status } };
}

async function file(store, candidateId, type) {
  if (!/^wa-\d{11,15}$/.test(String(candidateId)) || !DOCS[type]) return { status: 400 };
  const rec = await store.get('documents', docId(candidateId, type));
  if (!rec || !rec.data.blobPath) return { status: 404 };
  const f = await deps.blob.getFile(rec.data.blobPath);
  return { status: 200, buffer: f.buffer, contentType: f.contentType };
}

module.exports = { onInbound, request, review, file, sendReplies, nextMissing, ORDER, DOCS, _deps: deps };
