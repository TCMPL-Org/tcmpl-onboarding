'use strict';
// Candidate conversations: links offers, candidates, messages and the agent.
// Stored in the same database as everything else:
//   candidates/wa-<phone>  -> who the candidate is, the client facts the agent may use, risk, handovers
//   messages/<id>          -> every inbound/outbound message, any channel

const crypto = require('node:crypto');
const { getStore } = require('./store');
const wa = require('./whatsapp');
const agent = require('./agent');

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
    lastMessageAt: new Date().toISOString()
  };
  if (wa.waConfigured() && typeof p.letterPdfBase64 === 'string' && p.letterPdfBase64.length > 100 && p.letterPdfBase64.length < 7000000) {
    try {
      cand.letterMediaId = await wa.uploadMedia(Buffer.from(p.letterPdfBase64, 'base64'), 'application/pdf', str(p.letterFile, 150) || 'Offer_Letter.pdf');
      cand.letterFile = str(p.letterFile, 150) || 'Offer_Letter.pdf';
      cand.letterSent = false;
    } catch (e) { cand.letterError = e.message; }
  }
  await store.put('candidates', candidateId, cand, user);
  if (!wa.waConfigured()) return { status: 200, body: { candidateId, sent: false, reason: 'whatsapp_not_configured' } };
  try {
    const sent = await wa.sendTemplate(phone, { first: cand.first, name: cand.name, company: cand.company || cand.clientLabel, role: cand.role, doj: cand.doj, agent: cand.agentName });
    await saveMessage(store, newId('o'), { candidateId, direction: 'out', text: `[Template: ${sent.template}]`, waId: sent.id || '', by: user.name, kind: 'template' }, user);
    return { status: 200, body: { candidateId, sent: true } };
  } catch (e) {
    await saveMessage(store, newId('o'), { candidateId, direction: 'out', text: '[Template not sent]', error: e.message, kind: 'template' }, user);
    return { status: 502, body: { candidateId, sent: false, error: 'whatsapp_send_failed', detail: e.message } };
  }
}

// A candidate wrote to the WhatsApp number.
async function handleInbound(m) {
  const store = getStore();
  if (!store || !m || !m.from) return;
  const id = msgId('m', m.id || (m.from + m.timestamp));
  if (await store.get('messages', id)) return; // Meta retries: handle each message once
  const candidateId = wa.candidateIdFor(m.from);
  const rec = await store.get('candidates', candidateId);
  const cand = rec ? rec.data : { phone: wa.normalizePhone(m.from), name: m.name || '', first: (m.name || '').split(' ')[0], stage: 'Unknown contact', risk: [], riskScore: 0, handovers: [] };
  const who = { name: 'whatsapp:' + cand.phone };
  const text = m.text || `[${m.type || 'message'} received]`;
  await saveMessage(store, id, { candidateId, direction: 'in', text, waId: m.id || '', kind: m.type || 'text' }, who);

  let out;
  if (!rec) {
    out = { source: 'system', reply: "Hello! This number sends onboarding updates for candidates with an offer. We couldn't find your offer yet, so we've told the hiring team.", handover: true, handoverReason: 'Message from a number with no offer on file.', riskSignals: [] };
  } else if (m.type !== 'text' && !m.text) {
    out = { source: 'system', reply: "Thanks, I've received it. The hiring team will review it.", handover: false, riskSignals: [] };
  } else {
    out = await agent.reply(cand, await history(store, candidateId), text);
  }

  let waId = '', error = '';
  try { waId = (await wa.sendText(cand.phone, out.reply)).id || ''; } catch (e) { error = e.message; }
  await saveMessage(store, newId('o'), { candidateId, direction: 'out', text: out.reply, waId, error, source: out.source, kind: 'text' }, SYSTEM);

  // WhatsApp allows files once the candidate has written to us: send the offer letter now, once.
  let letterSent = Boolean(cand.letterSent);
  if (rec && cand.letterMediaId && !letterSent) {
    const caption = `Your offer letter from ${cand.company || cand.clientLabel || 'us'}. Ask me anything about it here.`;
    let lid = '', lerr = '';
    try { lid = (await wa.sendDocument(cand.phone, cand.letterMediaId, cand.letterFile, caption)).id || ''; letterSent = !!lid; } catch (e) { lerr = e.message; }
    await saveMessage(store, newId('o'), { candidateId, direction: 'out', text: `[Offer letter PDF] ${caption}`, waId: lid, error: lerr, source: 'agent', kind: 'document' }, SYSTEM);
  }

  const now = new Date().toISOString();
  const risk = Array.isArray(cand.risk) ? cand.risk.slice() : [];
  for (const s of (out.riskSignals || [])) if (!risk.some(r => r.label === s)) risk.push({ label: s, weight: agent.riskWeight(s), at: now });
  const handovers = Array.isArray(cand.handovers) ? cand.handovers.slice() : [];
  if (out.handover) handovers.push({ why: out.handoverReason || 'Needs a person', at: now, open: true });
  if (out.callback) handovers.push({ why: 'Call-back requested: ' + out.callback, at: now, open: true });
  await store.put('candidates', candidateId, Object.assign({}, cand, {
    risk, riskScore: Math.min(100, risk.reduce((a, r) => a + (r.weight || 0), 0)), handovers,
    lastMessageAt: now, lastInboundAt: now, name: cand.name || m.name || '', letterSent
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
    return { status: 502, body: { sent: false, error: 'whatsapp_send_failed', detail: e.message } };
  }
}

module.exports = { startForOffer, handleInbound, sendManual };
