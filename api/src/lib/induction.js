'use strict';
// Induction on WhatsApp, driven by each client's induction plan (Induction tab → plans/<clientId>).
//
// Milestone types:
//   session  - a meeting (HR connect, manager 1:1...). Reminder before, then "Did it happen?" Yes / Not yet / Rescheduled.
//   content  - a deck, policy PDF or link. Sent on the day; optional "I have read it"; follow-up if not acknowledged.
//   task     - something to do. "Have you completed …?" Yes / Not yet.
//   quiz     - the client's quiz, one question at a time with buttons; score and pass mark.
// No calendar invites are sent.
//
// State on the candidate: induction = { items: { <id>: { status, remindedAt, sentAt, checks, nextCheckAt, newTime, ... } },
//                                       pending: { id, type, i?, score? }, waiting: [replies held until the 24-hour window reopens] }

const ocr = require('./ocr');

const IST = 330 * 60000;
const H = 3600000;
const MAX_CHECKS = 2;          // ask "did it happen?" this many times, then hand over to HR
const BACKLOG_DAYS = 3;        // never send things more than this many days late
const QUIET = { from: 8, to: 21 }; // IST hours when the agent may message

const nowIso = () => new Date().toISOString();
const clean = (s, n = 300) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

/* ---------- plan ---------- */
function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item'; }

function normalizeItem(it, i) {
  const title = clean(it.title || 'Induction step', 120);
  const hasFile = it.material && typeof it.material === 'object' && it.material.id;
  const kind = ['session', 'content', 'quiz', 'task'].includes(it.kind) ? it.kind
    : /quiz/i.test(title) ? 'quiz' : (hasFile || /^https?:\/\//.test(it.link || '')) ? 'content' : 'session';
  return {
    id: String(it.id || `${it.day}-${slug(title)}-${i}`).slice(0, 80),
    day: Number.isFinite(+it.day) ? +it.day : 0,
    time: /^\d{1,2}:\d{2}$/.test(it.time || '') ? it.time : '10:00',
    mins: +it.mins || 30,
    title, owner: clean(it.owner || 'HR', 60), kind,
    remind: it.remind === undefined ? (kind === 'session' ? 60 : 0) : Math.max(0, +it.remind || 0),
    check: it.check === undefined ? kind !== 'quiz' : Boolean(it.check),
    ack: Boolean(it.ack),
    note: clean(it.note || '', 600),
    material: hasFile ? { id: String(it.material.id), name: clean(it.material.name, 120), mime: String(it.material.mime || 'application/pdf'), size: +it.material.size || 0 } : null,
    link: /^https?:\/\//.test(it.link || '') ? String(it.link).slice(0, 500) : ''
  };
}

function normalizePlan(rec) {
  const items = ((rec && rec.items) || []).map(normalizeItem).filter(it => it.day >= 0);
  const q = (rec && rec.quiz) || {};
  const questions = (q.questions || []).filter(x => x && x.q && Array.isArray(x.options) && x.options.length >= 2)
    .map(x => ({ q: clean(x.q, 300), options: x.options.slice(0, 3).map(o => clean(o, 20)), answer: Math.min(Math.max(0, +x.answer || 0), Math.min(2, x.options.length - 1)) }));
  return { items, quiz: { questions, pass: Math.min(questions.length, Math.max(1, +q.pass || Math.ceil(questions.length * 0.6))) } };
}

/* ---------- time ---------- */
function at(doj, day, time) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(doj || ''); if (!m) return null;
  const [h, mi] = String(time || '10:00').split(':').map(Number);
  return Date.UTC(+m[1], +m[2] - 1, +m[3] + day, h || 0, mi || 0) - IST;
}
const istHour = t => new Date(t + IST).getUTCHours();
const istTime = t => { const d = new Date(t + IST); const h = d.getUTCHours(), m = d.getUTCMinutes(); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
const istDate = t => { const d = new Date(t + IST); return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}`; };
function when(it, st, doj) { return st.newTime || at(doj, it.day, it.time); }

/* ---------- messages ---------- */
function first(cand) { return String((cand.profile && cand.profile.first) || cand.first || (cand.name || '').split(' ')[0] || 'there'); }

function reminderMsg(cand, it, t) {
  return { text: `Hi ${first(cand)}, a reminder: *${it.title}*${it.owner ? ' with ' + it.owner : ''} is ${istDate(t) === istDate(Date.now()) ? 'today' : 'on ' + istDate(t)} at ${istTime(t)}.${it.note ? '\n\n' + it.note : ''}` };
}
function checkMsg(it) {
  if (it.kind === 'session') return { text: `Did your *${it.title}* happen?`, buttons: ['Yes', 'Not yet', 'Rescheduled'] };
  if (it.kind === 'content') return { text: `Have you gone through *${it.title}*?`, buttons: ['Yes, done', 'Will do today', 'Need help'] };
  return { text: `Have you completed *${it.title}*?`, buttons: ['Yes', 'Not yet'] };
}
function contentMsgs(it) {
  const out = [];
  const body = `*${it.title}*${it.note ? '\n\n' + it.note : ''}${it.link ? '\n\n' + it.link : ''}`;
  if (it.material) out.push({ file: it.material, caption: it.title });
  out.push(it.ack ? { text: body + '\n\nPlease tap below once you have read it.', buttons: ['I have read it'] } : { text: body });
  return out;
}
function quizQuestion(quiz, i) {
  const q = quiz.questions[i];
  return { text: `Question ${i + 1} of ${quiz.questions.length}\n\n${q.q}`, buttons: q.options };
}

/* ---------- what is due now ---------- */
// Returns the messages to send now for one candidate (and updates its induction state). Pure: no network.
function due(cand, planRec, now = Date.now()) {
  const doj = cand.profile && cand.profile.doj;
  if (!doj || cand.exited) return [];
  const plan = normalizePlan(planRec);
  if (!plan.items.length) return [];
  const hour = istHour(now);
  if (hour < QUIET.from || hour >= QUIET.to) return [];
  const ind = cand.induction = Object.assign({ items: {} }, cand.induction);
  if (ind.pending && ind.pending.at && now - Date.parse(ind.pending.at) < 2 * H) return []; // wait for the open question first
  const ck = cand.checkins && cand.checkins.pending;
  if (ck && now - Date.parse(ck.at) < 2 * H) return []; // a journey check-in question is open
  const out = [];
  for (const it of plan.items) {
    const st = ind.items[it.id] = Object.assign({}, ind.items[it.id]);
    if (['done', 'escalated', 'skipped', 'failed'].includes(st.status)) continue;
    const t = when(it, st, doj);
    if (t == null) continue;
    if (now > t + BACKLOG_DAYS * 24 * H && !st.sentAt && !st.remindedAt && !st.checks) { st.status = 'skipped'; continue; }

    if (it.kind === 'session') {
      if (it.remind && !st.remindedAt && now >= t - it.remind * 60000 && now < t) { st.remindedAt = nowIso(); out.push({ id: it.id, msgs: [reminderMsg(cand, it, t)] }); break; }
      const checkAt = st.nextCheckAt ? Date.parse(st.nextCheckAt) : t + (it.mins + 30) * 60000;
      if (!it.check) { if (now >= t + it.mins * 60000) st.status = 'done'; continue; }
      if (now >= checkAt) { if (askCheck(cand, ind, it, st, out, now)) break; }
    } else if (it.kind === 'content') {
      if (!st.sentAt && now >= t) {
        st.sentAt = nowIso(); st.status = 'sent';
        if (!it.ack && !it.check) st.status = 'done';
        else st.nextCheckAt = new Date(now + 24 * H).toISOString();
        out.push({ id: it.id, msgs: contentMsgs(it), pending: it.ack ? { id: it.id, type: 'ack' } : null });
        break;
      }
      if (st.sentAt && (it.ack || it.check) && st.nextCheckAt && now >= Date.parse(st.nextCheckAt)) { if (askCheck(cand, ind, it, st, out, now)) break; }
    } else if (it.kind === 'task') {
      const checkAt = st.nextCheckAt ? Date.parse(st.nextCheckAt) : t;
      if (now >= checkAt) { if (askCheck(cand, ind, it, st, out, now)) break; }
    } else if (it.kind === 'quiz') {
      if (!st.sentAt && now >= t) {
        if (!plan.quiz.questions.length) { st.status = 'skipped'; continue; }
        st.sentAt = nowIso(); st.status = 'sent'; st.attempts = (st.attempts || 0) + 1;
        out.push({ id: it.id, msgs: [{ text: `Time for a short quiz about ${(cand.profile && cand.profile.company) || 'the company'}: ${plan.quiz.questions.length} questions, tap the right answer.` }, quizQuestion(plan.quiz, 0)], pending: { id: it.id, type: 'quiz', i: 0, score: 0 } });
        break;
      }
    }
  }
  for (const o of out) { ind.pending = o.pending ? Object.assign({ at: nowIso() }, o.pending) : ind.pending; }
  return out;
}

function askCheck(cand, ind, it, st, out, now) {
  if ((st.checks || 0) >= MAX_CHECKS) {
    st.status = 'escalated'; st.escalatedAt = nowIso();
    cand.handovers = (cand.handovers || []).concat([{ why: `Induction: "${it.title}" not confirmed after ${MAX_CHECKS} reminders (owner: ${it.owner})`, at: nowIso(), open: true }]);
    return false;
  }
  st.checks = (st.checks || 0) + 1;
  st.lastCheckAt = nowIso();
  st.nextCheckAt = new Date(now + 24 * H).toISOString();
  out.push({ id: it.id, msgs: [checkMsg(it)], pending: { id: it.id, type: 'check' } });
  return true;
}

/* ---------- answers ---------- */
// Returns { handled, replies }. Updates the candidate's induction state.
function onInbound(cand, planRec, m) {
  const ind = cand.induction;
  if (!ind) return { handled: false, replies: [] };
  const text = String(m.text || '').trim();
  const p = ind.pending;
  const plan = normalizePlan(planRec);

  // Messages held because the 24-hour window was closed: deliver them now that the candidate wrote.
  if (ind.waiting && ind.waiting.length && !(p && matchesPending(p, text, plan))) {
    const held = ind.waiting; ind.waiting = [];
    return { handled: true, replies: held };
  }
  if (!p || !text) return { handled: false, replies: [] };
  const it = plan.items.find(x => x.id === p.id);
  if (!it) { ind.pending = null; return { handled: false, replies: [] }; }
  const st = ind.items[it.id] = Object.assign({}, ind.items[it.id]);
  const done = msg => { st.status = 'done'; st.doneAt = nowIso(); ind.pending = null; return { handled: true, replies: [{ text: msg }] }; };

  if (p.type === 'ack') {
    if (/^(i have read|read|yes|done|ok)/i.test(text)) { st.ackAt = nowIso(); return done('Thank you, noted.'); }
    return { handled: false, replies: [] };
  }

  if (p.type === 'resched') {
    let iso = ocr.toIsoDate(text);
    const dm = /\b(\d{1,2})[/.-](\d{1,2})(?![/.-]?\d)/.exec(text);
    if (!iso && dm && +dm[2] >= 1 && +dm[2] <= 12) {
      const nowD = new Date(Date.now() + IST); let y = nowD.getUTCFullYear();
      if (+dm[2] < nowD.getUTCMonth() + 1 - 1) y++; // e.g. typed in December for January
      iso = `${y}-${String(dm[2]).padStart(2, '0')}-${String(dm[1]).padStart(2, '0')}`;
    }
    if (!iso) return { handled: true, replies: [{ text: 'Please type the new date and time, e.g. *12/12 3 pm*.' }] };
    const tm = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text.replace(/\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?/, ''));
    let h = tm ? +tm[1] : 10; const mi = tm && tm[2] ? +tm[2] : 0;
    if (tm && /pm/i.test(tm[3] || '') && h < 12) h += 12;
    const [y, mo, d] = iso.split('-').map(Number);
    st.newTime = Date.UTC(y, mo - 1, d, h, mi) - IST;
    st.status = 'rescheduled'; st.checks = 0; st.remindedAt = null; st.nextCheckAt = null;
    ind.pending = null;
    return { handled: true, replies: [{ text: `Thanks, noted for ${istDate(st.newTime)} at ${istTime(st.newTime)}. I'll remind you before it.` }] };
  }

  if (p.type === 'check') {
    if (/^(yes|done|yes,?\s*done|completed|it happened)/i.test(text)) return done('Great, thank you!');
    if (it.kind === 'session' && /^resched/i.test(text)) { ind.pending = { id: it.id, type: 'resched', at: nowIso() }; return { handled: true, replies: [{ text: 'When is it now? Please type the date and time, e.g. *12/12 3 pm*.' }] }; }
    if (/^need help/i.test(text)) {
      ind.pending = null; st.status = 'help';
      cand.handovers = (cand.handovers || []).concat([{ why: `Induction: candidate needs help with "${it.title}"`, at: nowIso(), open: true }]);
      return { handled: true, replies: [{ text: 'Sure. What would you like help with? Type your question and I\'ll answer or pass it to HR.' }] };
    }
    if (/^(will do|later|today)/i.test(text)) { ind.pending = null; st.status = 'not_yet'; st.nextCheckAt = new Date(Date.now() + 20 * H).toISOString(); return { handled: true, replies: [{ text: 'No problem, I\'ll check in tomorrow.' }] }; }
    if (/^(not yet|no)\b/i.test(text)) {
      ind.pending = null; st.status = 'not_yet';
      return { handled: true, replies: [{ text: it.kind === 'session' ? `Thanks for letting me know. I'll remind ${it.owner} and check with you again tomorrow.` : 'No problem, I\'ll check again tomorrow.' }] };
    }
    return { handled: false, replies: [] };
  }

  if (p.type === 'quiz') {
    const quiz = plan.quiz;
    const q = quiz.questions[p.i];
    if (!q) { ind.pending = null; return { handled: false, replies: [] }; }
    let pick = q.options.findIndex(o => o.toLowerCase() === text.toLowerCase());
    if (pick < 0 && /^[1-3]$/.test(text)) pick = +text - 1;
    if (pick < 0) return { handled: true, replies: [{ text: 'Please tap one of the answers.' }, quizQuestion(quiz, p.i)] };
    const right = pick === q.answer;
    const score = p.score + (right ? 1 : 0);
    const fb = right ? '✓ Correct.' : `✗ The right answer is: ${q.options[q.answer]}`;
    if (p.i + 1 < quiz.questions.length) {
      ind.pending = { id: it.id, type: 'quiz', i: p.i + 1, score, at: nowIso() };
      return { handled: true, replies: [{ text: fb }, quizQuestion(quiz, p.i + 1)] };
    }
    st.score = `${score}/${quiz.questions.length}`; st.scoreAt = nowIso();
    if (score >= quiz.pass) { st.status = 'done'; ind.pending = null; return { handled: true, replies: [{ text: `${fb}\n\nYou scored *${score}/${quiz.questions.length}*. Well done, you passed!` }] }; }
    st.status = 'retry'; ind.pending = { id: it.id, type: 'quizRetry', at: nowIso() };
    return { handled: true, replies: [{ text: `${fb}\n\nYou scored *${score}/${quiz.questions.length}*. The pass mark is ${quiz.pass}.`, buttons: ['Try again', 'Later'] }] };
  }

  if (p.type === 'quizRetry') {
    if (/^try again/i.test(text)) { st.attempts = (st.attempts || 1) + 1; ind.pending = { id: it.id, type: 'quiz', i: 0, score: 0, at: nowIso() }; return { handled: true, replies: [quizQuestion(plan.quiz, 0)] }; }
    if (/^later/i.test(text)) { ind.pending = null; st.status = 'failed'; return { handled: true, replies: [{ text: 'No problem. HR will go over these points with you.' }] }; }
  }
  return { handled: false, replies: [] };
}

function matchesPending(p, text, plan) {
  if (!text) return false;
  if (p.type === 'quiz') { const q = plan.quiz.questions[p.i]; return Boolean(q && q.options.some(o => o.toLowerCase() === text.toLowerCase())); }
  return /^(yes|no|not yet|rescheduled|i have read|will do|need help|try again|later|done)/i.test(text);
}

// HR "Send now" for testing a milestone without waiting for its date.
function sendNow(cand, planRec, itemId) {
  const plan = normalizePlan(planRec);
  const it = plan.items.find(x => x.id === itemId);
  if (!it) return null;
  const ind = cand.induction = Object.assign({ items: {} }, cand.induction);
  const st = ind.items[it.id] = {};
  let msgs, pending = null;
  if (it.kind === 'content') { msgs = contentMsgs(it); st.sentAt = nowIso(); st.status = it.ack || it.check ? 'sent' : 'done'; st.nextCheckAt = new Date(Date.now() + 24 * H).toISOString(); if (it.ack) pending = { id: it.id, type: 'ack' }; }
  else if (it.kind === 'quiz') {
    if (!plan.quiz.questions.length) return { error: 'no_quiz' };
    msgs = [{ text: `Time for a short quiz: ${plan.quiz.questions.length} questions, tap the right answer.` }, quizQuestion(plan.quiz, 0)];
    st.sentAt = nowIso(); st.status = 'sent'; st.attempts = 1; pending = { id: it.id, type: 'quiz', i: 0, score: 0 };
  } else if (it.kind === 'session') { const t = at(cand.profile && cand.profile.doj, it.day, it.time) || Date.now(); msgs = [reminderMsg(cand, it, t), checkMsg(it)]; st.remindedAt = nowIso(); st.checks = 1; st.lastCheckAt = nowIso(); pending = { id: it.id, type: 'check' }; }
  else { msgs = [checkMsg(it)]; st.checks = 1; st.lastCheckAt = nowIso(); pending = { id: it.id, type: 'check' }; }
  ind.pending = pending ? Object.assign({ at: nowIso() }, pending) : null;
  return { msgs };
}

module.exports = { normalizePlan, normalizeItem, at, due, onInbound, sendNow, MAX_CHECKS };
