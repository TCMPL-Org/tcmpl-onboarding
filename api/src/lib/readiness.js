'use strict';
// Day-1 readiness for a real candidate.
//   Owners (IT, Admin, Security, manager, payroll) get each task by email from HR (Outlook draft from the app);
//   HR records Requested / Done / Problem here.
//   The candidate is asked on WhatsApp whether things actually arrived:
//     D-2 10:00 "Have you received your company email ID and login details?"
//     D0  11:00 "Did you get your access card or ID badge?"
//     D0  12:00 "Is your laptop set up and can you log in?"
//     D0  16:00 "Have you met your buddy?"
//   Yes  → the task is marked done (confirmed by the candidate).
//   Not yet → the task is flagged as a problem and handed to HR.
//
// State on the candidate: readiness = { items: { <k>: { status, requestedAt, doneAt, by, note, candidate } },
//                                       asks: { <qid>: { sentAt, answer, answeredAt } }, pending: { qid, at } }

const IST = 330 * 60000;
const H = 3600000;
const QUIET = { from: 8, to: 21 };
const STATUSES = ['not_started', 'requested', 'done', 'issue'];

const QUESTIONS = [
  { id: 'email', k: 'email', day: -2, time: '10:00', text: 'Quick check before you join: have you received your *company email ID and login details*?' },
  { id: 'card', k: 'card', day: 0, time: '11:00', text: 'Did you get your *access card or ID badge*?' },
  { id: 'laptop', k: 'laptop', day: 0, time: '12:00', text: 'Is your *laptop set up*, and can you log in?' },
  { id: 'buddy', k: 'buddy', day: 0, time: '16:00', text: 'Have you met your *buddy* today?' }
];
const BUTTONS = ['Yes', 'Not yet'];

const nowIso = () => new Date().toISOString();
function at(doj, day, time) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(doj || ''); if (!m) return null;
  const [h, mi] = String(time).split(':').map(Number);
  return Date.UTC(+m[1], +m[2] - 1, +m[3] + day, h, mi) - IST;
}
const istHour = t => new Date(t + IST).getUTCHours();

function state(cand) { return (cand.readiness = Object.assign({ items: {}, asks: {} }, cand.readiness)); }

// Questions due now (pure; updates state). Returns [{ qid, msgs }].
function due(cand, now = Date.now()) {
  const doj = cand.profile && cand.profile.doj;
  if (!doj || cand.exited) return [];
  const h = istHour(now);
  if (h < QUIET.from || h >= QUIET.to) return [];
  const r = state(cand);
  if (r.pending && now - Date.parse(r.pending.at) < 2 * H) return [];
  const ck = cand.checkins && cand.checkins.pending;
  if (ck && now - Date.parse(ck.at) < 2 * H) return []; // a journey check-in question is open
  const off = Array.isArray(r.off) ? r.off : [];
  for (const q of QUESTIONS) {
    if (off.includes(q.k) || (r.asks[q.id] && r.asks[q.id].sentAt)) continue;
    const t = at(doj, q.day, q.time);
    if (now < t) continue;
    if (now > t + 24 * H) { r.asks[q.id] = { skipped: true }; continue; }
    return [ask(cand, q)];
  }
  return [];
}

function ask(cand, q) {
  const r = state(cand);
  r.asks[q.id] = Object.assign({}, r.asks[q.id], { sentAt: nowIso() });
  r.pending = { qid: q.id, at: nowIso() };
  const first = (cand.profile && cand.profile.first) || (cand.name || '').split(' ')[0] || '';
  const text = q.day === 0 && q.id === 'card' ? `Welcome to your first day${first ? ', ' + first : ''}! ${q.text}` : q.text;
  return { qid: q.id, msgs: [{ text, buttons: BUTTONS }] };
}

// HR "Send now" for one question.
function sendNow(cand, qid) {
  const q = QUESTIONS.find(x => x.id === qid);
  return q ? ask(cand, q) : null;
}

function onInbound(cand, m) {
  const r = cand.readiness;
  if (!r || !r.pending) return { handled: false, replies: [] };
  const text = String(m.text || '').trim();
  const q = QUESTIONS.find(x => x.id === r.pending.qid);
  if (!q) { r.pending = null; return { handled: false, replies: [] }; }
  const item = r.items[q.k] = Object.assign({ status: 'not_started' }, r.items[q.k]);
  if (/^(yes|yep|haan|done|received|got it)\b/i.test(text)) {
    r.asks[q.id] = Object.assign({}, r.asks[q.id], { answer: 'yes', answeredAt: nowIso() });
    item.status = 'done'; item.doneAt = item.doneAt || nowIso(); item.candidate = 'Confirmed by candidate';
    r.pending = null;
    return { handled: true, replies: [{ text: 'Great, thanks for confirming!' }] };
  }
  if (/^(not yet|no|nahi|not received)\b/i.test(text)) {
    r.asks[q.id] = Object.assign({}, r.asks[q.id], { answer: 'not_yet', answeredAt: nowIso() });
    item.status = 'issue'; item.candidate = 'Candidate says not received'; item.issueAt = nowIso();
    r.pending = null;
    cand.handovers = (cand.handovers || []).concat([{ why: `Day-1 readiness: candidate has not received "${q.k}"`, at: nowIso(), open: true }]);
    return { handled: true, replies: [{ text: 'Thanks for telling us. I\'ve asked the team to sort it out today and will check back with you.' }] };
  }
  return { handled: false, replies: [] };
}

// HR updates one task (status / note), or switches candidate questions off.
function update(cand, p, user) {
  const r = state(cand);
  const k = String((p && p.k) || '').replace(/[^\w:-]/g, '').slice(0, 40);
  if (!k) return { error: 'task_required' };
  const st = String(p.status || '');
  if (!STATUSES.includes(st)) return { error: 'bad_status' };
  const it = r.items[k] = Object.assign({}, r.items[k], { status: st, by: user.name, at: nowIso() });
  if (st === 'requested') it.requestedAt = it.requestedAt || nowIso();
  if (st === 'done') it.doneAt = nowIso();
  if (typeof p.note === 'string') it.note = p.note.slice(0, 300);
  return { item: it };
}

module.exports = { QUESTIONS, due, onInbound, update, sendNow, at };
