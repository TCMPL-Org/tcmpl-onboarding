'use strict';
// Emails to owners (IT, Admin, Security, manager, payroll), to the candidate, and the one-click
// confirmations they click ("Mark as done", "Yes, it happened"). Settings per client: journeys/<client>.email
// = { replyTo, cc } (reply-to is usually the HR person; cc is added to every owner email).

const email = require('./email');
const links = require('./links');
const { getStore } = require('./store');

const SYSTEM = { name: 'onboarding-agent' };
const nowIso = () => new Date().toISOString();
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

async function settings(store, client) {
  if (!client) return {};
  const r = await store.get('journeys', String(client)).catch(() => null);
  return (r && r.data && r.data.email) || {};
}

function logEmail(cand, entry) {
  cand.emails = (cand.emails || []).concat([Object.assign({ at: nowIso() }, entry)]).slice(-60);
}

// HR sends one Day-1 readiness task to its owner (with Mark as done / Report a problem links).
async function ownerTask(p, user) {
  const store = getStore();
  if (!store) return { status: 503, body: { error: 'database_not_configured' } };
  if (!email.emailConfigured()) return { status: 503, body: { error: 'email_not_configured' } };
  const candidateId = str(p && p.candidateId, 40);
  const rec = /^wa-\d{11,15}$/.test(candidateId) ? await store.get('candidates', candidateId) : null;
  if (!rec) return { status: 404, body: { error: 'candidate_not_found' } };
  const cand = Object.assign({}, rec.data);
  const k = str(p.k, 40).replace(/[^\w:-]/g, '');
  const to = email.addresses(p.to || p.owner);
  if (!k || !to.length) return { status: 400, body: { error: 'owner_email_required', detail: 'Add the owner\'s email in Client setup → People, e.g. Rohit Verma, IT <rohit@company.com>' } };
  const st = await settings(store, cand.profile && cand.profile.client);
  const cc = email.addresses([].concat(email.addresses(p.cc), email.addresses(st.cc)));
  const buttons = [
    { label: 'Mark as done', url: links.link({ c: candidateId, k, a: 'done' }) },
    { label: 'Report a problem', url: links.link({ c: candidateId, k, a: 'issue' }), secondary: true }
  ].filter(b => b.url);
  try {
    const r = await email.send({ to, cc, subject: str(p.subject, 250), text: str(p.body, 8000), buttons, replyTo: st.replyTo });
    const r2 = cand.readiness = Object.assign({ items: {}, asks: {} }, cand.readiness);
    const it = r2.items[k] = Object.assign({}, r2.items[k]);
    if (it.status !== 'done') it.status = 'requested';
    it.requestedAt = it.requestedAt || nowIso(); it.emailedAt = nowIso(); it.ownerEmail = to[0]; it.cc = cc;
    it.task = str(p.task, 160) || it.task; it.dueDate = str(p.dueDate, 10) || it.dueDate; it.by = user.name;
    logEmail(cand, { kind: 'owner', k, to: r.to, cc: r.cc, subject: str(p.subject, 250), by: user.name });
    await store.put('candidates', candidateId, cand, user);
    return { status: 200, body: { sent: true, to: r.to, cc: r.cc, readiness: cand.readiness } };
  } catch (e) {
    return { status: 502, body: { error: e.code || 'email_failed', detail: e.message } };
  }
}

// HR (or a journey step) emails the candidate.
async function candidateEmail(p, user) {
  const store = getStore();
  if (!store) return { status: 503, body: { error: 'database_not_configured' } };
  if (!email.emailConfigured()) return { status: 503, body: { error: 'email_not_configured' } };
  const candidateId = str(p && p.candidateId, 40);
  const rec = /^wa-\d{11,15}$/.test(candidateId) ? await store.get('candidates', candidateId) : null;
  if (!rec) return { status: 404, body: { error: 'candidate_not_found' } };
  const cand = Object.assign({}, rec.data);
  const to = email.addresses(cand.email || (cand.profile && cand.profile.email));
  if (!to.length) return { status: 400, body: { error: 'candidate_email_missing', detail: 'Add the candidate\'s email on the Offer desk.' } };
  const st = await settings(store, cand.profile && cand.profile.client);
  try {
    const r = await email.send({ to, cc: [].concat(email.addresses(p.cc), email.addresses(st.cc)), subject: str(p.subject, 250), text: str(p.body, 8000), replyTo: st.replyTo });
    logEmail(cand, { kind: 'candidate', key: str(p.key, 60), to: r.to, cc: r.cc, subject: str(p.subject, 250), by: user.name });
    await store.put('candidates', candidateId, cand, user);
    return { status: 200, body: { sent: true, to: r.to, cc: r.cc } };
  } catch (e) {
    return { status: 502, body: { error: e.code || 'email_failed', detail: e.message } };
  }
}

// Automatic emails from the scheduler (reminders, escalations, "did it happen?" to owners).
async function auto(store, candidateId, cand, { to, cc, subject, text, buttons, kind, k, replyTo }) {
  if (!email.emailConfigured()) return false;
  const st = await settings(store, cand.profile && cand.profile.client);
  try {
    const r = await email.send({ to, cc: [].concat(email.addresses(cc), email.addresses(st.cc)), subject, text, buttons, replyTo: (replyTo && email.addresses(replyTo).length) ? replyTo : st.replyTo });
    logEmail(cand, { kind, k, to: r.to, cc: r.cc, subject, by: 'onboarding-agent' });
    return true;
  } catch (e) { console.error('auto email failed', e && e.message); return false; }
}

// A copy of what the candidate gets on WhatsApp, by email, with the same files attached and the client's CC.
// Client setting journeys/<client>.email.mirror (default on). options = the WhatsApp reply buttons.
// offer: true adds one-click Accept / I have questions / Decline links.
async function toCandidate(store, candidateId, cand, { subject, text, options, attachments, kind, key, offer }) {
  if (!email.emailConfigured()) return false;
  const to = email.addresses(cand.email || (cand.profile && cand.profile.email));
  if (!to.length) return false;
  const st = await settings(store, cand.profile && cand.profile.client);
  if (st.mirror === false) return false;
  let body = String(text || '').replace(/\*([^*\n]+)\*/g, '$1').replace(/\[Buttons:[^\]]*\]/g, '').trim();
  let buttons = [];
  if (offer) buttons = [['Accept offer', 'accept'], ['I have questions', 'questions'], ['Decline', 'decline']].map(([label, v], i) => ({ label, url: links.link({ c: candidateId, a: 'offer', v }), secondary: i > 0 })).filter(b => b.url);
  else if (options && options.length) body += `\n\nPlease answer on WhatsApp: ${options.join(' / ')}`;
  try {
    const r = await email.send({ to, cc: st.cc, subject, text: body, buttons, replyTo: st.replyTo, attachments });
    logEmail(cand, { kind: kind || 'candidate-copy', k: key || '', to: r.to, cc: r.cc, subject, files: (attachments || []).map(a => a.name), by: 'onboarding-agent' });
    return true;
  } catch (e) { console.error('candidate email failed', e && e.message); cand.lastEmailError = e.message; return false; }
}

// Every new red item (handover) is emailed to HR straight away: the client's HR contact from Journey setup, else
// the Reply-to; the client's CC and, if set, the candidate's manager are copied (journeys/<client>.email.alertManager).
async function alertHandovers(store, candidateId, cand) {
  const fresh = (cand.handovers || []).filter(h => h && h.open && !h.alertedAt);
  if (!fresh.length || !email.emailConfigured()) return 0;
  const clientId = cand.profile && cand.profile.client;
  const st = await settings(store, clientId);
  const jr = clientId ? await store.get('journeys', String(clientId)).catch(() => null) : null;
  const ck = (jr && jr.data && jr.data.checkins) || {};
  const hr = email.addresses((ck.contacts && ck.contacts.hr) || '').concat(email.addresses(st.replyTo));
  if (!hr.length) return 0;
  const mgr = st.alertManager ? email.addresses((cand.contacts && cand.contacts.manager) || (ck.contacts && ck.contacts.manager) || '') : [];
  const app = (process.env.APP_URL || 'https://lively-island-0f17b1b00.3.azurestaticapps.net').replace(/\/$/, '');
  const p = cand.profile || {};
  const text = `${cand.name || 'A candidate'}${cand.clientLabel ? ' (' + cand.clientLabel + ')' : ''}${p.doj ? ', joining ' + p.doj : ''}, needs attention:\n\n${fresh.map(h => '• ' + h.why).join('\n')}\n\nOpen Candidate journey to act: ${app}\n\nMobile: +${cand.phone || ''}${cand.email ? ' · ' + cand.email : ''}`;
  try {
    const r = await email.send({ to: hr[0], cc: [].concat(hr.slice(1), mgr, email.addresses(st.cc)), subject: `Action needed: ${cand.name || 'candidate'} · ${fresh[0].why.slice(0, 70)}`, text, buttons: [{ label: 'Open the tool', url: app }] });
    const now = nowIso();
    fresh.forEach(h => { h.alertedAt = now; });
    logEmail(cand, { kind: 'hr-alert', to: r.to, cc: r.cc, subject: 'Action needed', by: 'onboarding-agent' });
    return 1;
  } catch (e) { console.error('hr alert failed', e && e.message); return 0; }
}

function hrAddress(st) { return email.addresses(st.replyTo)[0] || ''; }

// A click on a signed link in an email.
async function confirm(token) {
  const p = links.verify(token);
  if (!p) return page('This link has expired or is not valid.', false);
  const store = getStore();
  if (!store) return page('The onboarding system is not available right now. Please try again later.', false);
  const rec = await store.get('candidates', p.c);
  if (!rec) return page('This candidate is no longer in onboarding.', false);
  const cand = Object.assign({}, rec.data);
  const who = cand.name || 'the new joiner';
  let msg;
  if (p.a === 'done' || p.a === 'issue') {
    const r = cand.readiness = Object.assign({ items: {}, asks: {} }, cand.readiness);
    const it = r.items[p.k] = Object.assign({}, r.items[p.k]);
    if (p.a === 'done') { it.status = 'done'; it.doneAt = nowIso(); it.ownerConfirmedAt = nowIso(); msg = `Thank you. "${it.task || p.k}" for ${who} is marked as done.`; }
    else {
      it.status = 'issue'; it.issueAt = nowIso(); it.note = 'Owner reported a problem by email';
      cand.handovers = (cand.handovers || []).concat([{ why: `Day-1 readiness: owner reported a problem with "${it.task || p.k}"`, at: nowIso(), open: true }]);
      msg = 'Thank you. HR has been told there is a problem and will contact you.';
    }
  } else if (p.a === 'ind-yes' || p.a === 'ind-no') {
    const ind = cand.induction = Object.assign({ items: {} }, cand.induction);
    const st = ind.items[p.k] = Object.assign({}, ind.items[p.k]);
    st.ownerAnswer = p.a === 'ind-yes' ? 'yes' : 'not_yet'; st.ownerAnsweredAt = nowIso();
    if (p.a === 'ind-yes' && st.status !== 'done') { st.status = 'done'; st.doneAt = nowIso(); st.confirmedBy = 'owner'; }
    if (p.a === 'ind-no') cand.handovers = (cand.handovers || []).concat([{ why: `Induction: owner says "${p.t || p.k}" has not happened yet`, at: nowIso(), open: true }]);
    msg = p.a === 'ind-yes' ? 'Thank you, noted that it happened.' : 'Thank you. HR will follow up to set a new time.';
  } else if (p.a === 'offer') {
    const now = nowIso();
    if (p.v === 'accept') { cand.acceptedAt = cand.acceptedAt || now; cand.stage = 'Offer accepted'; msg = `Thank you${cand.first ? ', ' + cand.first : ''}! Your acceptance is recorded. We will be in touch on WhatsApp for the next steps.`; }
    else if (p.v === 'decline') { cand.declinedAt = now; cand.stage = 'Offer declined'; cand.handovers = (cand.handovers || []).concat([{ why: 'Candidate clicked Decline in the offer email: call them today', at: now, open: true }]); msg = 'Thank you for letting us know. Someone from HR will call you shortly.'; }
    else if (p.v === 'questions') { cand.handovers = (cand.handovers || []).concat([{ why: 'Candidate has questions about the offer (from email)', at: now, open: true }]); msg = 'Thank you. HR will contact you to answer your questions. You can also type them on WhatsApp.'; }
    else return page('Unknown answer.', false);
  } else if (p.a === 'ck') {
    const run = require('./induction-run');
    const checkins = require('./checkins');
    const setup = await run.setupFor(store, cand.profile && cand.profile.client);
    const o = checkins.occurrences(setup).find(x => x.key === p.k);
    if (!o) return page('This question is no longer part of the onboarding plan.', false);
    const value = /^r[1-5]$/.test(String(p.v)) ? String(p.v).slice(1) : o.item.options[+p.v];
    if (!value) return page('Unknown answer.', false);
    const res = checkins.record(cand, setup, p.k, value, o.item.to === 'candidate' ? 'candidate (email)' : o.item.to + ' (email)');
    msg = res.flagged ? `Thank you. Your answer "${value}" has been sent to HR, who will follow up.` : `Thank you, your answer "${value}" is recorded.`;
  } else return page('Unknown action.', false);
  await alertHandovers(store, p.c, cand);
  await store.put('candidates', p.c, cand, SYSTEM);
  return page(msg, true);
}

function page(text, ok) {
  const body = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Onboarding</title></head><body style="font-family:Segoe UI,Arial,sans-serif;background:#f4f7f7;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center"><div style="background:#fff;border-radius:12px;padding:28px 32px;max-width:440px;box-shadow:0 2px 12px rgba(0,0,0,.08)"><div style="font-size:32px">${ok ? '✓' : '!'}</div><p style="font-size:16px;color:#1d2a30">${text.replace(/[<>&]/g, '')}</p><p style="font-size:12px;color:#667">TCMPL AI Onboarding Agent</p></div></body></html>`;
  return { status: ok ? 200 : 400, body, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } };
}

// Client email settings (reply-to, CC), saved from Client setup.
async function saveSettings(p, user) {
  const store = getStore();
  if (!store) return { status: 503, body: { error: 'database_not_configured' } };
  const client = str(p && p.client, 60).replace(/[^\w-]/g, '');
  if (!client) return { status: 400, body: { error: 'client_required' } };
  const rec = await store.get('journeys', client);
  const data = Object.assign({}, rec && rec.data, { client, email: { replyTo: email.addresses(p.replyTo).join(', '), cc: email.addresses(p.cc).join(', '), mirror: p.mirror !== false, alertManager: Boolean(p.alertManager) }, updated: nowIso() });
  await store.put('journeys', client, data, user);
  return { status: 200, body: { email: data.email, configured: email.emailConfigured(), sender: process.env.ACS_SENDER || '' } };
}

module.exports = { alertHandovers, toCandidate, ownerTask, candidateEmail, auto, confirm, settings, saveSettings, hrAddress };
