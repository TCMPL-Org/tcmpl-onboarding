'use strict';
// Walkthrough tools for demos: move one candidate's clock to any day of the journey, run what is due at that
// moment, go back to real time, or reset the candidate to "offer sent" and start again.

const induction = require('./induction');
const run = require('./induction-run');
const { getStore } = require('./store');

const KEEP = ['phone', 'name', 'first', 'email', 'role', 'doj', 'client', 'clientLabel', 'company', 'agentName', 'profile', 'offerId',
  'releasedAt', 'facts', 'faq', 'letterFile', 'letterProtected', 'hasLetter', 'letterMediaId', 'letterUploadedAt'];
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

async function load(store, p) {
  const id = str(p && p.candidateId, 40);
  if (!/^wa-\d{11,15}$/.test(id)) return null;
  const rec = await store.get('candidates', id);
  return rec ? { id, cand: Object.assign({}, rec.data) } : null;
}

async function action(name, p, user) {
  const store = getStore();
  if (!store) return { status: 503, body: { error: 'database_not_configured' } };
  const x = await load(store, p);
  if (!x) return { status: 404, body: { error: 'candidate_not_found' } };
  const { id, cand } = x;
  const doj = cand.profile && cand.profile.doj;

  if (name === 'jump') {
    const day = Math.max(-60, Math.min(120, parseInt(p.day, 10) || 0));
    const time = /^\d{1,2}:\d{2}$/.test(p.time || '') ? p.time : '10:30';
    const t = induction.at(doj, day, time);
    if (t == null) return { status: 400, body: { error: 'no_joining_date' } };
    cand.clockOffsetMs = t - Date.now();
    cand.walkthrough = true;
    await store.put('candidates', id, cand, user);
    return { status: 200, body: { clockOffsetMs: cand.clockOffsetMs, now: new Date(t).toISOString() } };
  }
  if (name === 'realtime') {
    cand.clockOffsetMs = 0;
    await store.put('candidates', id, cand, user);
    return { status: 200, body: { clockOffsetMs: 0 } };
  }
  if (name === 'run') {
    const sent = await run.runCandidate(store, id, cand, {}, Date.now());
    await store.put('candidates', id, cand, user);
    return { status: 200, body: { sent } };
  }
  if (name === 'reset') {
    const fresh = {};
    for (const k of KEEP) if (cand[k] !== undefined) fresh[k] = cand[k];
    fresh.stage = 'Offer sent'; fresh.walkthrough = true; fresh.clockOffsetMs = 0; fresh.resetAt = new Date().toISOString(); fresh.resetBy = user.name;
    await store.put('candidates', id, fresh, user);
    let removed = 0;
    if (p.clearChat !== false) {
      for (const m of await store.list('messages')) if (m.data && m.data.candidateId === id) { await store.remove('messages', m.id, user); removed++; }
    }
    for (const t of ['aadhaar', 'pan', 'bank']) await store.remove('documents', `${id}.${t}`, user);
    return { status: 200, body: { reset: true, messagesRemoved: removed } };
  }
  return { status: 404, body: { error: 'unknown_action' } };
}

module.exports = { action };
