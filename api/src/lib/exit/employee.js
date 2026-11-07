'use strict';
// The employee's side on WhatsApp:
//   - "I want to resign" from someone in a client's employee master (Exit on, not a new joiner in onboarding) opens a
//     private conversation: Resign formally / Talk to HR first / Not now. A formal resignation becomes an open case.
//   - Photos or files sent during an open case are kept as declared assets (private storage).
//   - Exit interview answers, one question at a time; answers are stored for anonymous group reports.
//   - Alumni opt-in (YES / NO), and STOP to leave the alumni network.
// Every function mutates the case object it is given; the caller saves it.

const crypto = require('node:crypto');
const wa = require('../whatsapp');
const blob = require('../blob');
const modules = require('../modules');
const R = require('./rules');
const C = require('./cases');

const nowIso = () => new Date().toISOString();
const SYSTEM = { name: 'exit-agent' };
const INTENT_RE = /\b(resign|resignation|resigning|quit|quitting|leaving (the |this )?(company|job|organi[sz]ation)|i('| a)?m leaving|i want to leave|notice period|serve (my )?notice|relieving letter|last working day)\b|istifa|naukri chhod|job chhod|इस्तीफा/i;
const INTENT_DAYS = 7;
const AFTER_CLOSE_DAYS = 30;
const EM = { code: 0, name: 1, designation: 2, dept: 3, managerCode: 4, email: 5, mobile: 6 };

const msgId = () => 'xo-' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
async function out(store, k, text, extra) {
  let waId = '', error = '';
  try { waId = (extra && extra.buttons ? await wa.sendButtons(k.employee.phone, text, extra.buttons) : await wa.sendText(k.employee.phone, text)).id || ''; }
  catch (e) { error = e.message; }
  await store.put('exit_messages', msgId(), { caseId: k.id, direction: 'out', text: text + (extra && extra.buttons ? `\n[Buttons: ${extra.buttons.join(' | ')}]` : ''), waId, error, source: 'agent', kind: extra && extra.buttons ? 'interactive' : 'text', at: nowIso() }, SYSTEM);
}
function alert(k, why) { if (!(k.alerts || []).some(a => a.open && a.why === why)) k.alerts = (k.alerts || []).concat([{ why, at: nowIso(), open: true }]).slice(-50); }
function log(k, text) { k.log = (k.log || []).concat([{ at: nowIso(), by: 'WhatsApp', text }]).slice(-300); }

/* ---------------- who is writing ---------------- */
async function findEmployee(store, phone) {
  for (const rec of await store.list('master')) {
    const client = rec.id, rows = (rec.data && rec.data.rows) || [];
    const row = rows.find(r => wa.normalizePhone(r[EM.mobile]) === phone);
    if (!row) continue;
    if (!await modules.enabled(store, client, 'exit')) continue;
    const mgr = row[EM.managerCode] ? rows.find(r => r[EM.code] === row[EM.managerCode]) : null;
    return { client, clientLabel: (rec.data && rec.data.clientLabel) || '', employee: { code: row[EM.code] || '', name: row[EM.name] || '', designation: row[EM.designation] || '', dept: row[EM.dept] || '', email: row[EM.email] || '', mobile: phone, manager: mgr ? mgr[EM.name] : '', managerEmail: mgr ? mgr[EM.email] : '' } };
  }
  return null;
}

// A new joiner still in onboarding (offer released, joining within the last 100 days or later) stays with onboarding.
async function inOnboarding(store, phone) {
  const rec = await store.get('candidates', 'wa-' + phone).catch(() => null);
  if (!rec || !rec.data) return false;
  const c = rec.data;
  if (/declined/i.test(c.stage || '')) return false;
  const doj = (c.profile && c.profile.doj) || c.doj;
  return !doj || doj >= R.addDays(R.todayIst(), -100);
}

// What an incoming message belongs to: an open or "thinking of leaving" case, a recently closed case still asking
// interview/alumni questions, an alumni member, or a new "I want to resign".
async function resolve(store, m) {
  const phone = wa.normalizePhone(m && m.from);
  if (!phone) return null;
  const mine = (await store.list('exit_cases')).map(r => r.data).filter(k => k && k.employee && k.employee.phone === phone)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  for (const k of mine) {
    if (!await modules.enabled(store, k.client, 'exit')) continue;
    if (k.status === 'open') return { kind: 'case', k };
    if (k.status === 'intent' && (k.intent.step === 'hr' || Date.now() - Date.parse(k.createdAt) < INTENT_DAYS * 864e5)) return { kind: 'case', k };
    const pending = (k.interview && k.interview.status === 'asked') || (k.alumni && k.alumni.status === 'asked');
    if (k.status === 'closed' && pending && Date.now() - Date.parse(k.closedAt || k.createdAt) < AFTER_CLOSE_DAYS * 864e5) return { kind: 'case', k };
  }
  const text = String((m && m.text) || '').trim();
  if (/^stop$/i.test(text)) {
    const al = (await store.list('exit_alumni')).find(r => r.data && r.data.phone === phone);
    if (al) return { kind: 'alumni-stop', rec: al };
  }
  if (INTENT_RE.test(text) && !await inOnboarding(store, phone)) {
    const emp = await findEmployee(store, phone);
    if (emp) return { kind: 'intent', emp };
  }
  return null;
}

/* ---------------- "I want to resign" ---------------- */
const MENU = ['Resign formally', 'Talk to HR first', 'Not now'];

async function startIntent(store, emp, m) {
  const today = R.todayIst();
  const id = C.caseId(emp.client, emp.employee.code || emp.employee.mobile, today);
  const k = {
    id, client: emp.client, clientLabel: emp.clientLabel, employee: C.cleanEmployee(emp.employee), status: 'intent', stage: 'raised', typeId: 'resign', typeName: 'Resignation', category: 'Voluntary',
    raisedBy: 'Employee', source: 'WhatsApp', formal: today, lwd: '', plan: [], approvals: [], alerts: [], createdAt: nowIso(), createdBy: 'WhatsApp',
    intent: { step: 'menu', at: nowIso(), firstText: String(m.text || '').slice(0, 300) }, log: [{ at: nowIso(), by: 'WhatsApp', text: 'Employee wrote about leaving; private conversation started.' }]
  };
  const first = (k.employee.name || '').split(' ')[0] || 'there';
  await out(store, k, `Thank you for telling me, ${first}. This stays private between you and HR until you decide. How would you like to go ahead?`, { buttons: MENU });
  return k;
}

function parseFirstTold(text) {
  const t = String(text || '').trim().toLowerCase();
  const today = R.todayIst();
  if (/^(no|not yet|nahi|na)\b/.test(t)) return { told: false, date: today };
  if (/^today|aaj/.test(t)) return { told: true, date: today };
  if (/^yesterday|kal/.test(t)) return { told: true, date: R.addDays(today, -1) };
  const d = C.anyDate(t.replace(/\s+/g, ' '));
  return d && d <= today ? { told: true, date: d } : null;
}

async function intentReply(store, k, m, setup) {
  const text = String(m.text || '').trim();
  const t = text.toLowerCase();
  const first = (k.employee.name || '').split(' ')[0] || 'there';
  const step = k.intent.step;
  if (step === 'menu') {
    if (/^(1|resign formally|formal)/.test(t) || /resign formally/.test(t)) {
      k.intent.step = 'told';
      await out(store, k, 'Have you already told your manager? Reply with the date you told them (for example 05/11/2026, "today" or "yesterday"), or "no".');
    } else if (/^(2|talk to hr|hr)/.test(t) || /talk to hr/.test(t)) {
      k.intent.step = 'hr';
      alert(k, `${k.employee.name} is thinking of leaving and asked for a confidential call with HR. Nothing has been shared with the manager.`);
      log(k, 'Employee asked for a confidential HR call.');
      await out(store, k, `I have asked HR to call you, ${first}. Nothing is shared with your manager. You can write here any time.`);
    } else if (/^(3|not now|no|later)/.test(t) || /not now/.test(t)) {
      k.status = 'cancelled'; k.cancelledAt = nowIso(); k.cancelledBy = 'employee';
      log(k, 'Employee chose "Not now". Nothing recorded with the manager.');
      await out(store, k, `Noted, ${first}. Nothing has been recorded. Write here whenever you want to talk about it.`);
    } else await out(store, k, 'Please choose one of the options.', { buttons: MENU });
    return;
  }
  if (step === 'told') {
    const p = parseFirstTold(text);
    if (!p) { await out(store, k, 'Please reply with a date like 05/11/2026, "today", "yesterday" or "no".'); return; }
    k.intent.first = p.date; k.intent.told = p.told; k.intent.step = 'lwd';
    const pre = C.build(setup, { employee: k.employee, typeId: 'resign', raisedBy: 'Employee', first: p.date, formal: R.todayIst() }, { client: k.client });
    const kk = pre.k;
    if (!kk) { await out(store, k, 'Thank you. HR will confirm your notice period and last working day with you.'); return; }
    k.intent.noticeLwd = kk.lwd;
    await out(store, k, `Thank you. Your notice is ${kk.noticeDays} days, counted from ${R.niceDate(kk.noticeStart)}, so your last working day would be ${R.niceDate(kk.lwd)}.\n\nReply "as per notice", or send an earlier date you would like (the company decides on early release).`);
    return;
  }
  if (step === 'lwd') {
    let requested = '';
    if (!/as per notice|^ok|^yes|^fine|notice/.test(t)) {
      requested = C.anyDate(text);
      if (!requested) { await out(store, k, 'Please reply "as per notice" or a date like 15/12/2026.'); return; }
    }
    const r = C.build(setup, { employee: k.employee, typeId: 'resign', raisedBy: 'Employee', first: k.intent.first, formal: R.todayIst(), requestedLwd: requested, source: 'WhatsApp', reason: '' }, { client: k.client, clientLabel: k.clientLabel });
    if (!r.k) { alert(k, `${k.employee.name} wants to resign but the case could not be worked out (${r.errors.join(' ')}). Please raise it on the Exit desk.`); await out(store, k, 'Thank you. HR will confirm the details with you shortly.'); return; }
    const keep = { id: k.id, createdAt: k.createdAt, createdBy: 'WhatsApp', log: k.log, alerts: k.alerts, intent: Object.assign({}, k.intent, { step: 'done' }) };
    Object.keys(k).forEach(x => { delete k[x]; });
    Object.assign(k, r.k, keep, { status: 'open', stage: 'raised' });
    log(k, `Resignation submitted on WhatsApp: last working day ${R.niceDate(k.lwd)}${k.noticeDays ? `, notice ${k.noticeDays} days (${k.noticeRule})` : ''}${k.waiverDays ? `, ${k.waiverDays} days' waiver asked` : ''}.`);
    alert(k, `New resignation on WhatsApp from ${k.employee.name}. Check the level, date of joining and manager email on the case (the employee master has no level, so the default notice rule was used).`);
    await out(store, k, `Done, ${(k.employee.name || '').split(' ')[0]}. Your resignation is recorded with last working day ${R.niceDate(k.lwd)}${k.waiverDays ? ' (the earlier date needs approval)' : ''}. Your manager and HR will be asked to accept it, and I will keep you posted here.`);
    return;
  }
  // step 'hr': the employee is waiting for HR
  alert(k, `${k.employee.name} wrote again (waiting for the confidential HR call): "${text.slice(0, 160)}"`);
  await out(store, k, 'Thank you. HR has your message and will contact you.');
}

/* ---------------- assets, interview, alumni ---------------- */
async function saveAsset(store, k, m) {
  const n = (k.assets || []).length + 1;
  const a = { n, at: nowIso(), caption: String((m.media && m.media.caption) || m.text || '').slice(0, 200), mime: (m.media && m.media.mime) || '', filename: (m.media && m.media.filename) || '' };
  if (blob.storageConfigured() && wa.waConfigured() && m.media && m.media.id) {
    try {
      const f = await wa.downloadMedia(m.media.id, 8 * 1024 * 1024);
      const ext = /pdf/.test(f.mime) ? 'pdf' : /png/.test(f.mime) ? 'png' : 'jpg';
      a.path = await blob.putFile(`exit/${k.client}/${k.id}/assets/${n}-${Date.now()}.${ext}`, f.buffer, f.mime);
      a.mime = f.mime; a.size = f.buffer.length;
    } catch (e) { a.error = e.message; }
  } else a.error = 'file not stored (storage or WhatsApp not connected)';
  k.assets = (k.assets || []).concat([a]).slice(-40);
  log(k, `Asset declared on WhatsApp: ${a.caption || (m.type === 'image' ? 'photo' : 'file') + ' ' + n}${a.error ? ' (' + a.error + ')' : ''}.`);
  await out(store, k, `Thank you, received${a.caption ? ': ' + a.caption : ` item ${n}`}. Send the next one, or reply DONE when that is everything.`);
}

const qPrompt = q => {
  if (q.type === 'scale5') return `${q.q}\nReply with a number from 1 (poor) to 5 (excellent).`;
  if (q.type === 'scale10') return `${q.q}\nReply with a number from 0 to 10.`;
  if (q.type === 'choice') return `${q.q}\n${q.options.split(/,\s*/).map((o, i) => `${i + 1}. ${o}`).join('\n')}\nReply with the number.`;
  if (q.type === 'yesno') return `${q.q}\nReply Yes, Maybe or No.`;
  return `${q.q}\n(Write your answer, or "skip".)`;
};
function qAnswer(q, text) {
  const t = String(text || '').trim();
  if (q.type === 'scale5' || q.type === 'scale10') { const n = parseInt(t, 10); const max = q.type === 'scale5' ? 5 : 10, min = q.type === 'scale5' ? 1 : 0; return /^\d{1,2}$/.test(t) && n >= min && n <= max ? n : null; }
  if (q.type === 'choice') { const opts = q.options.split(/,\s*/); const n = parseInt(t, 10); if (/^\d+$/.test(t) && n >= 1 && n <= opts.length) return opts[n - 1]; return opts.find(o => o.toLowerCase() === t.toLowerCase()) || null; }
  if (q.type === 'yesno') { const m = /^(yes|y|haan|ha|maybe|may be|no|n|nahi)\b/i.exec(t); return m ? (/^(y|haan|ha)/i.test(m[1]) ? 'Yes' : /^may/i.test(m[1]) ? 'Maybe' : 'No') : null; }
  return t ? (/^skip$/i.test(t) ? '' : t.slice(0, 1000)) : null;
}

// Starts the interview (called when the interview step is sent): the intro and the first question go together.
function interviewStart(setup, k) {
  const qs = (setup.interview && setup.interview.questions) || [];
  k.interview = { status: qs.length ? 'asked' : 'done', i: 0, answers: {}, startedAt: nowIso() };
  return qs.length ? qPrompt(qs[0]) : '';
}

async function interviewReply(store, setup, k, text) {
  const qs = (setup.interview && setup.interview.questions) || [];
  const iv = k.interview;
  const q = qs[iv.i];
  if (!q) { iv.status = 'done'; return; }
  const a = qAnswer(q, text);
  if (a === null) { await out(store, k, qPrompt(q)); return; }
  iv.answers[q.id] = a;
  iv.i++;
  if (iv.i < qs.length) { await out(store, k, qPrompt(qs[iv.i])); return; }
  iv.status = 'done'; iv.doneAt = nowIso();
  const e = k.employee;
  await store.put('exit_interviews', k.id, {
    client: k.client, dept: e.dept || 'Not given', level: e.level || 'Not given', location: e.location || 'Not given', manager: e.manager || 'Not given', category: k.category, typeName: k.typeName,
    month: String(k.lwd || '').slice(0, 7), questions: qs.map(x => ({ id: x.id, q: x.q, type: x.type })), answers: iv.answers, at: nowIso()
  }, SYSTEM);
  log(k, 'Exit interview completed on WhatsApp.');
  await out(store, k, 'Thank you for your time and honesty. Your answers are reported to the company only in groups, never by name.');
}

async function alumniReply(store, k, text) {
  const t = String(text || '').trim();
  const e = k.employee;
  if (/^(yes|y|join|haan|ha|ok)\b/i.test(t)) {
    k.alumni = Object.assign({}, k.alumni, { status: 'joined', at: nowIso() });
    await store.put('exit_alumni', k.id, { client: k.client, caseId: k.id, name: e.name, phone: e.phone, email: e.email, designation: e.designation, dept: e.dept, location: e.location, lwd: k.lwd, joinedAt: nowIso(), consent: `Replied "${t.slice(0, 20)}" on WhatsApp` }, SYSTEM);
    log(k, 'Joined the alumni network (consent recorded).');
    await out(store, k, 'Welcome to the alumni network! We will share openings and news about once a month. Reply STOP any time to leave.');
    return true;
  }
  if (/^(no|n|not now|nahi)\b/i.test(t)) {
    k.alumni = Object.assign({}, k.alumni, { status: 'declined', at: nowIso() });
    log(k, 'Declined the alumni network.');
    await out(store, k, 'No problem. We wish you all the best.');
    return true;
  }
  return false;
}

// Messages on a case. Returns true when handled here (no generic holding reply needed).
async function caseReply(store, setup, k, m) {
  if (k.status === 'intent') { await intentReply(store, k, m, setup); return true; }
  if (m.media) { if (k.status === 'open') { await saveAsset(store, k, m); return true; } return false; }
  const text = String(m.text || '').trim();
  if (k.interview && k.interview.status === 'asked') { await interviewReply(store, setup, k, text); return true; }
  if (k.alumni && k.alumni.status === 'asked' && await alumniReply(store, k, text)) return true;
  const assetsSent = (k.plan || []).some(s => s.key === 'assets' && ['sent', 'held', 'done'].includes(s.status)) || (k.assets || []).length;
  if (k.status === 'open' && assetsSent && !k.assetsDone && /^(none|nothing|no assets|done|that'?s all)\b/i.test(text)) {
    k.assetsDone = { at: nowIso(), text: text.slice(0, 100), count: (k.assets || []).length };
    k.plan = (k.plan || []).map(s => (s.key === 'assets' ? Object.assign({}, s, { status: 'done', at: nowIso(), by: 'employee' }) : s));
    log(k, (k.assets || []).length ? `Employee finished declaring assets (${k.assets.length}).` : 'Employee declared no company assets.');
    await out(store, k, (k.assets || []).length ? `Thank you. ${k.assets.length} item${k.assets.length > 1 ? 's are' : ' is'} recorded for your clearance.` : 'Thank you, noted that you have no company items to return.');
    return true;
  }
  return false;
}

async function alumniStop(store, rec) {
  await store.remove('exit_alumni', rec.id, SYSTEM);
  try { await wa.sendText(rec.data.phone, 'You have left the alumni network. Thank you, and all the best.'); } catch { /* best effort */ }
}

module.exports = { resolve, startIntent, caseReply, interviewStart, alumniStop, findEmployee, inOnboarding, INTENT_RE, qPrompt, qAnswer, parseFirstTold };
