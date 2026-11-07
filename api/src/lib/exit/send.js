'use strict';
// Exit messaging: sends a case's steps on WhatsApp and/or email, runs approval chains and clearances
// with one-click email links, and answers those links. Mutates the case object; the caller saves it.
//
// WhatsApp goes only to the employee. A free-form WhatsApp message is accepted by Meta only within 24 hours of the
// employee's last message: otherwise it is held on the case and sent when the employee next writes (and the
// nudge template, if configured, asks them to reply). Everyone else is reached by email.

const crypto = require('node:crypto');
const wa = require('../whatsapp');
const email = require('../email');
const links = require('../links');
const R = require('./rules');

const nowIso = () => new Date().toISOString();
const IST = 330 * 60000;
const QUIET = { from: 8, to: 21 }; // IST hours when the agent may message

const stepTime = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.date || ''); const t = /^(\d{1,2}):(\d{2})$/.exec(s.time || '11:00') || [0, 11, 0]; return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +t[1], +t[2]) - IST : NaN; };
const hourIst = ms => new Date(ms + IST).getUTCHours();
const inQuietHours = ms => { const h = hourIst(ms); return h < QUIET.from || h >= QUIET.to; };
const caseNow = (k, real = Date.now()) => real + (+k.clockOffsetMs || 0);

function windowClosed(e) {
  const code = e && e.detail && e.detail.code;
  return code === 131047 || /24 hours|re-engagement/i.test((e && e.message) || '');
}

function log(k, text, by) { k.log = (k.log || []).concat([{ at: nowIso(), by: (by && by.name) || 'exit-agent', text }]).slice(-300); }
function alert(k, why) {
  if ((k.alerts || []).some(a => a.open && a.why === why)) return;
  k.alerts = (k.alerts || []).concat([{ why, at: nowIso(), open: true }]).slice(-50);
}
function newMsgId(p) { return p + '-' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'); }
async function saveMsg(store, m) { await store.put('exit_messages', newMsgId('xo'), Object.assign({ at: nowIso(), direction: 'out' }, m), { name: 'exit-agent' }); }

const company = (setup, k) => (setup.contacts && setup.contacts.company) || k.clientLabel || 'the company';
const contactEmail = v => email.addresses(v)[0] || '';
const contactName = v => String(v || '').replace(/<[^>]*>/g, '').replace(/[,;].*$/, '').trim();
function roleContact(setup, k, role) {
  if (role === 'Manager') return { name: k.employee.manager || 'Reporting manager', email: k.employee.managerEmail };
  const p = (setup.people || []).find(x => x.role === role);
  return { name: contactName(p && p.contact) || role, email: contactEmail(p && p.contact) };
}
function ownerContact(k, o) {
  if (o.area === 'Manager' && !contactEmail(o.contact)) return { name: k.employee.manager || o.owner, email: k.employee.managerEmail };
  return { name: contactName(o.contact) || o.owner || o.area, email: contactEmail(o.contact) };
}
const link = (k, p) => links.link(Object.assign({ m: 'exit', c: k.id }, p), 90);

async function mail(setup, k, { to, subject, text, buttons }) {
  if (!email.emailConfigured()) return { ok: false, note: 'email is not connected' };
  if (!email.addresses(to).length) return { ok: false, note: 'no email address' };
  try {
    await email.send({ to, cc: setup.contacts.cc, replyTo: setup.contacts.replyTo || setup.contacts.hr, subject: `${subject} · ${company(setup, k)}`, text, buttons });
    return { ok: true };
  } catch (e) { return { ok: false, note: e.message }; }
}

// WhatsApp to the employee; held when the 24-hour window is closed.
async function whatsappEmployee(store, k, text, by, about) {
  const phone = k.employee.phone;
  if (!phone) return { ok: false, note: 'no mobile number' };
  if (!wa.waConfigured()) return { ok: false, note: 'WhatsApp is not connected' };
  try {
    const r = await wa.sendText(phone, text);
    await saveMsg(store, { caseId: k.id, text, waId: r.id || '', by: by.name, source: about, kind: 'text' });
    return { ok: true };
  } catch (e) {
    if (!windowClosed(e)) { await saveMsg(store, { caseId: k.id, text, error: e.message, by: by.name, source: about, kind: 'text' }); return { ok: false, note: e.message }; }
    k.held = (k.held || []).concat([{ text, about, by: by.name, at: nowIso() }]).slice(-10);
    let note = 'held until the employee next writes (24-hour window closed)';
    const tpl = (process.env.WHATSAPP_NUDGE_TEMPLATE || '').trim();
    if (tpl && (!k.nudgedAt || Date.now() - Date.parse(k.nudgedAt) > 12 * 3600e3)) {
      try {
        const first = (k.employee.name || '').split(' ')[0] || 'there';
        const t = await wa.sendNamedTemplate(phone, tpl, process.env.WHATSAPP_NUDGE_TEMPLATE_LANG || 'en', [first, 'your exit formalities']);
        k.nudgedAt = nowIso(); note += '; reminder template sent';
        await saveMsg(store, { caseId: k.id, text: `[Template ${tpl}] reminder to reply`, waId: t.id || '', by: by.name, source: 'system', kind: 'template' });
      } catch (te) { note += '; template failed: ' + te.message; }
    }
    await saveMsg(store, { caseId: k.id, text, error: note, by: by.name, source: about, kind: 'held' });
    return { ok: false, held: true, note };
  }
}

// The employee just wrote: send everything that was held.
async function replayHeld(store, k) {
  const held = k.held || [];
  if (!held.length) return 0;
  k.held = [];
  let n = 0;
  for (const h of held) {
    try {
      const r = await wa.sendText(k.employee.phone, h.text);
      await saveMsg(store, { caseId: k.id, text: h.text, waId: r.id || '', by: h.by, source: h.about, kind: 'text' });
      n++;
    } catch { k.held.push(h); }
  }
  if (n) {
    k.plan = (k.plan || []).map(s => (s.status === 'held' && !k.held.some(h => h.about === s.key) ? Object.assign({}, s, { status: 'sent', at: nowIso(), note: (s.note || '') + ' · WhatsApp sent when the employee wrote' }) : s));
    log(k, `${n} held WhatsApp message${n > 1 ? 's' : ''} sent after the employee wrote.`);
  }
  return n;
}

/* ---------------- approvals ---------------- */
// Emails whoever is next in each pending approval chain (sequential: one step at a time; parallel: everyone).
async function askApprovers(setup, k, by) {
  const notes = [];
  for (const a of k.approvals || []) {
    if (a.status !== 'Pending') continue;
    const waiting = a.chain.filter(s => s.status !== 'Approved');
    if (!a.chain.length) { notes.push(`${a.action}: no approval rule; HR to decide`); alert(k, `${a.action}: no approval rule matches; HR to decide.`); continue; }
    const nextStep = Math.min(...waiting.map(s => s.step));
    for (let i = 0; i < a.chain.length; i++) {
      const s = a.chain[i];
      if (s.step !== nextStep || s.status !== 'Waiting') continue;
      const who = roleContact(setup, k, s.role);
      const text = `${who.name ? 'Dear ' + who.name.split(' ')[0] + ',' : 'Hello,'}\n\n${a.action} for ${k.employee.name} (${[k.employee.designation, k.employee.dept, k.employee.level].filter(Boolean).join(', ')}).\nSeparation type: ${k.typeName}. Formal date: ${R.niceDate(k.formal)}. Last working day: ${R.niceDate(k.lwd)}.${a.action === 'Notice waiver' ? `\nWaiver asked: ${k.waiverDays} days (last day as per notice: ${R.niceDate(k.noticeLwd)}).` : ''}${k.reason ? `\nReason: ${k.reason}` : ''}\n\nPlease reply within ${a.sla} hours.`;
      const r = await mail(setup, k, { to: who.email, subject: `Approval: ${a.action}, ${k.employee.name}`, text,
        buttons: [{ label: 'Approve', url: link(k, { a: 'ap', i: a.id, s: i, v: 'yes' }) }, { label: 'Reject', url: link(k, { a: 'ap', i: a.id, s: i, v: 'no' }), secondary: true }] });
      if (r.ok) { s.status = 'Asked'; s.askedAt = nowIso(); s.person = who.name; notes.push(`${a.action}: asked ${who.name}`); log(k, `${a.action}: approval asked from ${who.name} (${s.role}) by email.`, by); }
      else { notes.push(`${a.action}: ${s.role} not asked (${r.note})`); alert(k, `${a.action}: could not email ${s.role} (${r.note}). Add the email in Exit desk (manager) or Exit setup → People behind the roles.`); }
    }
  }
  return notes;
}

/* ---------------- clearances ---------------- */
async function emailOwners(setup, k, step, text, by, onlyOpen) {
  const notes = [];
  k.clearances = k.clearances || {};
  for (const o of setup.owners || []) {
    const st = k.clearances[o.id] = Object.assign({ area: o.area, status: 'open' }, k.clearances[o.id]);
    if (onlyOpen && st.status === 'cleared') continue;
    const who = ownerContact(k, o);
    const body = `${who.name ? 'Dear ' + who.name.split(' ')[0] + ',' : 'Hello,'}\n\n${text}\n\nYour area: ${o.area}${o.items ? ' (' + o.items + ')' : ''}. Please respond within ${o.sla} hours.`;
    const buttons = step.key === 'access'
      ? [{ label: 'Access closed', url: link(k, { a: 'clr', o: o.id, v: 'ok' }) }, { label: 'Something is pending', url: link(k, { a: 'clr', o: o.id, v: 'issue' }), secondary: true }]
      : [{ label: 'Cleared', url: link(k, { a: 'clr', o: o.id, v: 'ok' }) }, { label: 'Something is pending', url: link(k, { a: 'clr', o: o.id, v: 'issue' }), secondary: true }];
    const r = await mail(setup, k, { to: who.email, subject: `${step.title}: ${k.employee.name}`, text: body, buttons });
    if (r.ok) { st.askedAt = nowIso(); notes.push(`${o.area}: emailed`); }
    else { notes.push(`${o.area}: not emailed (${r.note})`); if (r.note === 'no email address') alert(k, `No email for the ${o.area} clearance owner. Add it in Exit setup → Clearance owners.`); }
  }
  return notes;
}

/* ---------------- one step ---------------- */
async function sendStep(store, setup, k, key, by) {
  const s = (k.plan || []).find(x => x.key === key);
  if (!s) return { ok: false, error: 'step_not_found' };
  const def = (setup.steps || []).find(x => x.key === key) || {};
  const text = R.fill(def.text || s.title, k, setup);
  const wantWa = s.channel === 'whatsapp' || s.channel === 'both';
  const wantMail = s.channel === 'email' || s.channel === 'both';
  const notes = [];
  let sent = 0, held = false;

  if (s.to === 'approvers') {
    notes.push(...await askApprovers(setup, k, by));
    sent = notes.filter(n => /asked /.test(n)).length;
  } else if (s.to === 'owners') {
    notes.push(...await emailOwners(setup, k, s, text, by, key !== 'clearance-start'));
    sent = notes.filter(n => /: emailed$/.test(n)).length;
  } else if (s.to === 'employee') {
    if (wantWa) {
      const r = await whatsappEmployee(store, k, text, by, key);
      if (r.ok) { sent++; notes.push('WhatsApp sent'); } else { held = Boolean(r.held); notes.push('WhatsApp: ' + r.note); }
    }
    if (wantMail || (wantWa && !k.employee.phone)) {
      const r = await mail(setup, k, { to: k.employee.email, subject: s.title, text });
      if (r.ok) { sent++; notes.push('email sent'); } else notes.push('email: ' + r.note);
    }
  } else {
    const to = s.to === 'manager' ? k.employee.managerEmail : (setup.contacts || {})[s.to];
    const buttons = key === 'handover' ? [{ label: 'Handover is complete', url: link(k, { a: 'step', k: key, v: 'done' }) }] : [];
    const r = await mail(setup, k, { to, subject: `${s.title}: ${k.employee.name}`, text, buttons });
    if (r.ok) { sent++; notes.push(`email sent to ${s.to}`); }
    else { notes.push(`${s.to}: ${r.note}`); if (r.note === 'no email address') alert(k, `No email for ${s.to} (step "${s.title}"). Add it in ${s.to === 'manager' ? 'the case (manager email)' : 'Exit setup → Company and contacts'}.`); }
  }

  const status = sent ? 'sent' : held ? 'held' : 'failed';
  k.plan = k.plan.map(x => (x.key === key ? Object.assign({}, x, { status: held && !sent ? 'held' : status, at: nowIso(), by: by.name, note: notes.join(' · ') }) : x));
  log(k, `Step "${s.title}": ${notes.join(' · ') || status}.`, by);
  return { ok: Boolean(sent || held), status, notes };
}

// Steps due at the case's clock, inside quiet hours. Old steps (more than 3 days late) are marked missed, not sent.
async function runDue(store, setup, k, by, realNow = Date.now(), { force = false } = {}) {
  const now = caseNow(k, realNow);
  let sent = 0;
  if (inQuietHours(now) && !force) return 0;
  for (const s of (k.plan || []).slice()) {
    if (!['planned', 'due'].includes(s.status)) continue;
    const t = stepTime(s);
    if (!(t <= now)) continue;
    if (now - t > 3 * 864e5) {
      k.plan = k.plan.map(x => (x.key === s.key ? Object.assign({}, x, { status: 'missed', at: nowIso() }) : x));
      alert(k, `Step "${s.title}" (${R.niceDate(s.date)}) was not sent in time. Send it from Case journey or mark it done.`);
      continue;
    }
    const r = await sendStep(store, setup, k, s.key, by);
    if (r.ok) sent++;
  }
  return sent;
}

/* ---------------- one-click links (m: 'exit') ---------------- */
function replan(setup, k) { k.plan = R.planFor(setup, k, k.plan); }

async function onLink(store, setup, k, p) {
  if (k.status !== 'open') return { ok: false, msg: 'This exit case is closed.' };
  const by = { name: 'email link' };
  if (p.a === 'ap') {
    const a = (k.approvals || []).find(x => x.id === p.i);
    const s = a && a.chain[+p.s];
    if (!a || !s) return { ok: false, msg: 'This approval is no longer open.' };
    if (a.status !== 'Pending' || s.status !== 'Asked') return { ok: true, msg: `Thank you. This was already answered (${a.status === 'Pending' ? s.status : a.status}).` };
    s.status = p.v === 'yes' ? 'Approved' : 'Rejected'; s.at = nowIso();
    log(k, `${a.action}: ${s.status.toLowerCase()} by ${s.person || s.role} (email).`, by);
    if (p.v !== 'yes') {
      a.status = 'Rejected';
      alert(k, `${a.action} was rejected by ${s.person || s.role}. Speak to the employee and the approver.`);
      if (a.action === 'Notice waiver' && k.noticeLwd) { k.lwd = k.noticeLwd; k.waiverDays = 0; replan(setup, k); log(k, `Last working day back to ${R.niceDate(k.lwd)} as per notice.`, by); }
      return { ok: true, msg: 'Thank you. Your answer is recorded and HR has been told.' };
    }
    if (a.chain.every(x => x.status === 'Approved')) {
      a.status = 'Approved'; a.at = nowIso();
      if (a.action === 'Accept resignation' || a.action === 'Involuntary separation') { k.acceptedAt = k.acceptedAt || nowIso(); k.stage = 'accepted'; }
      log(k, `${a.action}: fully approved.`, by);
    } else await askApprovers(setup, k, by);
    return { ok: true, msg: 'Thank you. Your approval is recorded.' };
  }
  if (p.a === 'clr') {
    const o = (setup.owners || []).find(x => x.id === p.o) || { area: p.o };
    const st = (k.clearances = k.clearances || {})[p.o] = Object.assign({ area: o.area }, (k.clearances || {})[p.o]);
    st.status = p.v === 'ok' ? 'cleared' : 'issue'; st.at = nowIso();
    if (p.v !== 'ok') alert(k, `${o.area} reports something pending for ${k.employee.name}'s clearance.`);
    log(k, `${o.area} clearance: ${p.v === 'ok' ? 'confirmed' : 'something is pending'} (email).`, by);
    return { ok: true, msg: p.v === 'ok' ? `Thank you. ${o.area} clearance for ${k.employee.name} is recorded.` : 'Thank you. HR has been told and will follow up.' };
  }
  if (p.a === 'step') {
    const s = (k.plan || []).find(x => x.key === p.k);
    if (!s) return { ok: false, msg: 'This step is no longer part of the case.' };
    k.plan = k.plan.map(x => (x.key === p.k ? Object.assign({}, x, { status: 'done', at: nowIso(), by: 'email link' }) : x));
    log(k, `Step "${s.title}" confirmed done (email).`, by);
    return { ok: true, msg: 'Thank you, noted.' };
  }
  return { ok: false, msg: 'Unknown action.' };
}

module.exports = { sendStep, runDue, replayHeld, askApprovers, onLink, caseNow, stepTime, inQuietHours, windowClosed, alert, log };
