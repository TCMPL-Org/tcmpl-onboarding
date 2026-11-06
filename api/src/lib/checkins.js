'use strict';
// Journey check-ins: one engine for everything the agent asks or tells people on a cadence, configured per client
// (Client setup → Journey setup), with a TCMPL default:
//   pre-joining  – resignation status (weekly until submitted), manager/HR agreement, relieving date, notice-pay
//                  reimbursement, travel, how they feel about joining, joining details with point of contact + map
//   joining day  – arrival check, Day-1 survey
//   first 90 days– infra (seat, canteen coupons, parking … configurable), role clarity, introductions, goals,
//                  fortnightly surveys to D90 for the candidate and the manager, induction completion reminders
//   closure      – closing message, final survey, closing call with HR
// Each item: who it goes to (candidate / manager / HR / buddy / an email), channel (WhatsApp / Email / both), day
// relative to joining + time, optional repeat (every N days until a day, stop on an answer), the message, the
// answer type (buttons, rating 1–5, date, free text, none), answers that alert HR, a reminder and an escalation.
//
// State on the candidate: checkins = { asks: { <key>: { sentAt, via, answer, answeredAt, by, flagged, remindedAt, escalatedAt, skipped } },
//                                       pending: { key, at } }, prejoin = { <saveAs>: { value, at } }, contacts = { manager, buddy }

const IST = 330 * 60000;
const H = 3600000, D = 864e5;
const QUIET = { from: 8, to: 21 };
const STAGES = ['pre', 'day1', 'p90', 'close'];
const TO = ['candidate', 'manager', 'hr', 'buddy', 'email'];
const CHANNELS = ['whatsapp', 'email', 'both'];
const ANSWERS = ['buttons', 'rating', 'date', 'text', 'none'];

const nowIso = t => new Date(t || Date.now()).toISOString();
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'item';

// ---------------------------------------------------------------- TCMPL default
const DEFAULT_INFRA = ['Workstation / seat', 'Canteen coupons', 'Parking pass'];
const I = (o) => Object.assign({ to: 'candidate', email: '', cc: '', replyTo: '', channel: 'whatsapp', time: '11:00', every: 0, until: null, answer: 'buttons', options: [], flag: [], remind: 24, escalate: true, saveAs: '', stopOn: [], when: '', off: false }, o);
const DEFAULT_ITEMS = [
  I({ id: 'resign', stage: 'pre', title: 'Resignation status', day: -28, every: 7, until: -7, stopOn: ['Yes, submitted'], saveAs: 'resignation',
    text: 'Hi {first}, a quick check: have you submitted your resignation at your current company?', options: ['Yes, submitted', 'Not yet', 'Need help'], flag: ['Need help'] }),
  I({ id: 'exit-agree', stage: 'pre', title: 'Manager / HR agreement at current company', day: -24, saveAs: 'exitAgreement',
    text: 'Has your current manager or HR accepted your resignation and agreed your last working day?', options: ['Yes, agreed', 'Still discussing', 'There is a problem'], flag: ['There is a problem'] }),
  I({ id: 'relieving', stage: 'pre', title: 'Relieving date', day: -21, answer: 'date', saveAs: 'relievingDate',
    text: 'What is your confirmed *relieving (last working) date*? Please reply with the date, for example 25/11/2026.' }),
  I({ id: 'notice-pay', stage: 'pre', title: 'Notice-pay reimbursement', day: -20, saveAs: 'noticePay',
    text: 'Will you need to pay for any part of your notice period (notice buy-out)?', options: ['No', 'Yes, need support', 'Not sure yet'], flag: ['Yes, need support'] }),
  I({ id: 'travel', stage: 'pre', title: 'Travel for joining', day: -14, saveAs: 'travel',
    text: 'Do you need travel or a stay arranged for your joining?', options: ['No, all set', 'Need travel', 'Travel and stay'], flag: ['Need travel', 'Travel and stay'] }),
  I({ id: 'pulse-pre', stage: 'pre', title: 'How do you feel about joining?', day: -18, every: 7, until: -4, time: '17:30', remind: 0, escalate: false,
    text: 'How are you feeling about joining {company}?', options: ['Excited', 'Have questions', 'Second thoughts'], flag: ['Second thoughts'] }),
  I({ id: 'orient-confirm', stage: 'pre', title: 'Orientation sessions confirmed (HR)', to: 'hr', channel: 'email', day: -5, time: '10:00',
    text: 'Please confirm that the induction and department orientation sessions for {name} (joining {doj}) are planned with every department and stakeholder.', options: ['All confirmed', 'Some pending'], flag: ['Some pending'] }),
  I({ id: 'joining-info', stage: 'pre', title: 'Joining details, point of contact and map', channel: 'both', day: -3, time: '12:00', remind: 0, escalate: false,
    text: 'Your joining details, {first}:\n\n📅 {doj}, please report by {reportTime}\n📍 {address}\n🗺️ Map: {map}\n🙋 Ask for {poc}{pocPhone}\n👔 Dress: {dress}\n🎒 Please bring: {bring}', options: ['Got it', 'I have a question'], flag: ['I have a question'] }),
  I({ id: 'eve', stage: 'pre', title: 'Evening before joining', day: -1, time: '18:00', answer: 'none', remind: 0, escalate: false,
    text: 'See you tomorrow, {first}! Report by {reportTime} at {address} and ask for {poc}. Map: {map}' }),
  I({ id: 'arrive', stage: 'day1', title: 'Arrived and met point of contact?', day: 0, time: '10:30', remind: 2,
    text: 'Good morning {first}, welcome! Have you reached and met {poc}?', options: ['Yes', 'Not yet', 'Running late'], flag: ['Not yet'] }),
  I({ id: 'day1-survey', stage: 'day1', title: 'Day-1 experience survey', day: 0, time: '18:00', answer: 'rating', remind: 0, escalate: false,
    text: 'How was your first day, {first}? Please reply with a number from *1* (poor) to *5* (great).' }),
  I({ id: 'role', stage: 'p90', title: 'Role clarity', day: 7, saveAs: 'roleClarity',
    text: 'One week in! Is your role clear: do you know what is expected of you in the first 30 days?', options: ['Yes, clear', 'Partly', 'Not clear'], flag: ['Not clear'] }),
  I({ id: 'intros', stage: 'p90', title: 'Team, customer and stakeholder introductions', day: 7, time: '15:00',
    text: 'Have you been introduced to your team and the key stakeholders or customers you will work with?', options: ['Yes', 'Some of them', 'Not yet'], flag: ['Not yet'] }),
  I({ id: 'buddy', stage: 'p90', title: 'Buddy connect', day: 3,
    text: 'Have you had a proper conversation with your buddy this week?', options: ['Yes', 'Not yet'], flag: ['Not yet'] }),
  I({ id: 'induction-due', stage: 'p90', title: 'Induction completion reminder', day: 5, every: 3, until: 21, time: '10:00', answer: 'none', when: 'induction_open', remind: 0, escalate: false,
    text: 'A reminder, {first}: please complete your induction by {inductionDue}. Still open: {pending}.' }),
  I({ id: 'induction-late', stage: 'p90', title: 'Induction not completed (HR)', to: 'hr', channel: 'email', day: 22, time: '10:00', when: 'induction_open',
    text: '{name} has not completed the induction within the allowed period. Still open: {pending}.', options: ['Following up', 'Done now'] }),
  I({ id: 'goals', stage: 'p90', title: 'Goal setting', day: 30, saveAs: 'goals',
    text: 'Have you and your manager agreed your goals for the next few months?', options: ['Yes, agreed', 'Not yet'], flag: ['Not yet'] }),
  I({ id: 'pulse', stage: 'p90', title: 'Fortnightly check-in (candidate)', day: 14, every: 14, until: 84, time: '16:00', answer: 'rating', remind: 24, escalate: false,
    text: 'Quick fortnightly check-in, {first}: how are things going overall? Reply *1* (not well) to *5* (very well).' }),
  I({ id: 'mgr-pulse', stage: 'p90', title: 'Fortnightly check-in (manager)', to: 'manager', channel: 'email', day: 14, every: 14, until: 84, time: '10:00',
    text: 'How is {name} settling into the role and the team?', options: ['Settling in well', 'Some concerns', 'Serious concerns'], flag: ['Some concerns', 'Serious concerns'] }),
  I({ id: 'hr-pulse', stage: 'p90', title: 'HR mid-point check-in', to: 'hr', channel: 'email', day: 45, time: '10:00',
    text: 'Mid-point check for {name}: have you spoken with them and their manager about how onboarding is going?', options: ['Done, all fine', 'Done, issues found'], flag: ['Done, issues found'] }),
  I({ id: 'close-survey', stage: 'close', title: 'Day-90 survey', day: 89, time: '16:00', answer: 'rating', remind: 24, escalate: false,
    text: 'You are almost at 90 days, {first}! Overall, how would you rate your onboarding? Reply *1* (poor) to *5* (excellent).' }),
  I({ id: 'close-call', stage: 'close', title: 'Closing call with HR', day: 90, time: '11:00', saveAs: 'closingCall',
    text: 'To close your onboarding, HR would like a short 15-minute call with you. Does that work?', options: ['Yes, call me', 'Not needed'], remind: 24, escalate: false }),
  I({ id: 'close-call-hr', stage: 'close', title: 'Closing call held? (HR)', to: 'hr', channel: 'email', day: 93, time: '10:00',
    text: 'Did the onboarding closing call with {name} happen?', options: ['Yes, held', 'Not yet'], flag: ['Not yet'] }),
  I({ id: 'close-msg', stage: 'close', title: 'Onboarding closure message', channel: 'both', day: 94, time: '11:00', answer: 'none', remind: 0, escalate: false,
    text: 'Congratulations {first}, you have completed your onboarding at {company}! 🎉 Thank you for your feedback along the way. From now on, please reach HR at {hrEmail} for anything you need.' })
];
const DEFAULT_JOINING = { reportTime: '', address: '', mapUrl: '', poc: '', pocPhone: '', dress: '', bring: '' };

function defaults() {
  return { enabled: true, inductionDays: 21, infra: DEFAULT_INFRA.slice(), joining: Object.assign({}, DEFAULT_JOINING), contacts: { manager: '', hr: '', buddy: '' }, items: JSON.parse(JSON.stringify(DEFAULT_ITEMS)) };
}

// ---------------------------------------------------------------- setup (sanitised)
function cleanItem(x) {
  const opts = Array.isArray(x.options) ? x.options.map(o => str(String(o), 20).trim()).filter(Boolean).slice(0, 6) : [];
  const pick = (v, list, d) => (list.includes(v) ? v : d);
  const num = (v, lo, hi, d) => (Number.isFinite(+v) && v !== '' && v !== null ? Math.max(lo, Math.min(hi, Math.round(+v))) : d);
  return {
    id: str(x.id, 40).replace(/[^\w-]/g, '') || slug(x.title) + '-' + Math.random().toString(36).slice(2, 6),
    stage: pick(x.stage, STAGES, 'p90'), title: str(x.title, 120) || 'Check-in',
    to: pick(x.to, TO, 'candidate'), email: str(x.email, 300), cc: str(x.cc, 500), replyTo: str(x.replyTo, 300), channel: pick(x.channel, CHANNELS, 'whatsapp'),
    day: num(x.day, -90, 365, 0), time: /^\d{1,2}:\d{2}$/.test(x.time || '') ? x.time : '11:00',
    every: num(x.every, 0, 90, 0), until: x.until === null || x.until === '' || x.until === undefined ? null : num(x.until, -90, 365, null),
    text: str(x.text, 1500), answer: pick(x.answer, ANSWERS, 'buttons'), options: opts,
    flag: (Array.isArray(x.flag) ? x.flag : []).map(o => str(String(o), 20).trim()).filter(o => opts.includes(o)),
    stopOn: (Array.isArray(x.stopOn) ? x.stopOn : []).map(o => str(String(o), 20).trim()).filter(o => opts.includes(o)),
    remind: num(x.remind, 0, 240, 0), escalate: Boolean(x.escalate), saveAs: str(x.saveAs, 30).replace(/[^\w]/g, ''),
    when: x.when === 'induction_open' ? 'induction_open' : '', off: Boolean(x.off), infra: Boolean(x.infra)
  };
}
function cleanSetup(s) {
  const d = defaults();
  if (!s || typeof s !== 'object') return d;
  const j = s.joining || {}, c = s.contacts || {};
  return {
    enabled: s.enabled !== false,
    inductionDays: Number.isFinite(+s.inductionDays) ? Math.max(1, Math.min(120, Math.round(+s.inductionDays))) : 21,
    infra: Array.isArray(s.infra) ? s.infra.map(x => str(String(x), 40).trim()).filter(Boolean).slice(0, 15) : d.infra,
    joining: Object.fromEntries(Object.keys(DEFAULT_JOINING).map(k => [k, str(j[k], k === 'address' || k === 'bring' ? 300 : 200)])),
    contacts: { manager: str(c.manager, 300), hr: str(c.hr, 300), buddy: str(c.buddy, 300) },
    items: Array.isArray(s.items) ? s.items.slice(0, 60).map(cleanItem) : d.items
  };
}

// Items with the infra list expanded (one question each, the day after joining).
function itemsOf(setup) {
  const out = (setup.items || []).filter(x => !x.off);
  (setup.infra || []).forEach((name, i) => {
    out.push(I({ id: 'infra-' + slug(name), stage: 'p90', title: 'Infra: ' + name, infra: true, day: 1, time: `${11 + Math.floor(i / 2)}:${i % 2 ? '30' : '00'}`,
      text: `Have you received your *${name}*?`, options: ['Yes', 'Not yet', 'Not needed'], flag: ['Not yet'], remind: 24, escalate: true }));
  });
  return out;
}

// Every occurrence of every item: [{ key, item, day }].
function occurrences(setup) {
  const out = [];
  for (const it of itemsOf(setup)) {
    if (it.every > 0 && it.until !== null && it.until >= it.day) {
      for (let d = it.day, n = 0; d <= it.until && n < 30; d += it.every, n++) out.push({ key: `${it.id}@${d}`, item: it, day: d });
    } else out.push({ key: it.id, item: it, day: it.day });
  }
  return out;
}

function at(doj, day, time) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(doj || ''); if (!m) return null;
  const [h, mi] = String(time || '11:00').split(':').map(Number);
  return Date.UTC(+m[1], +m[2] - 1, +m[3] + day, h, mi) - IST;
}
const istHour = t => new Date(t + IST).getUTCHours();
function fmtDoj(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); if (!m) return iso || '';
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
function addDaysIso(iso, n) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n)).toISOString().slice(0, 10) : ''; }

function mapUrl(j) {
  if (j.mapUrl) return j.mapUrl;
  const q = j.address || '';
  return q ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q) : '';
}

// Fills {placeholders}; ctx.pending = open induction titles.
function fill(text, cand, setup, ctx = {}) {
  const p = cand.profile || {};
  const j = setup.joining || {};
  const first = p.first || cand.first || (cand.name || '').split(' ')[0] || '';
  const doj = p.doj || cand.doj || '';
  const v = {
    first, name: cand.name || p.name || first, doj: fmtDoj(doj), company: cand.company || cand.clientLabel || 'the company', role: p.role || cand.role || '',
    manager: p.mgr || 'your manager', reportTime: j.reportTime || 'the time shared by HR', address: j.address || 'the office address shared by HR',
    map: mapUrl(j) || '(link to follow)', poc: j.poc || 'the HR team', pocPhone: j.pocPhone ? ` (${j.pocPhone})` : '', dress: j.dress || 'business casual',
    bring: j.bring || 'a photo ID', hrEmail: (setup.contacts && setup.contacts.hr) || ctx.hrEmail || 'the HR team',
    pending: (ctx.pending || []).join(', ') || 'none', inductionDue: fmtDoj(addDaysIso(doj, setup.inductionDays || 21))
  };
  return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
}

function state(cand) { return (cand.checkins = Object.assign({ asks: {} }, cand.checkins)); }
const recipients = (it, cand, setup, hrDefault) => {
  const c = Object.assign({}, setup.contacts, cand.contacts);
  if (it.to === 'manager') return c.manager || '';
  if (it.to === 'buddy') return c.buddy || '';
  if (it.to === 'hr') return c.hr || hrDefault || '';
  if (it.to === 'email') return it.email || '';
  return '';
};
const wantsWa = it => it.to === 'candidate' && it.channel !== 'email';
const wantsEmail = it => it.channel !== 'whatsapp' || it.to !== 'candidate';

// WhatsApp message for an item (buttons when ≤3 short options, otherwise numbered list).
function waMsg(it, text) {
  if (it.answer === 'buttons' && it.options.length && it.options.length <= 3) return { text, buttons: it.options };
  if (it.answer === 'buttons' && it.options.length) return { text: text + '\n\n' + it.options.map((o, i) => `${i + 1}. ${o}`).join('\n') + '\n\nReply with the number.' };
  return { text };
}

// Builds one send (WhatsApp and/or email) for an occurrence. Pure; the caller delivers and records.
function build(o, cand, setup, ctx, { reminder = false } = {}) {
  const it = o.item;
  const body = fill(it.text, cand, setup, ctx);
  const prefix = reminder ? 'Reminder: ' : '';
  const out = { key: o.key, item: it };
  if (wantsWa(it)) out.wa = [waMsg(it, prefix + body)];
  if (wantsEmail(it)) {
    const to = it.to === 'candidate' ? (cand.email || (cand.profile && cand.profile.email) || '') : recipients(it, cand, setup, ctx.hrEmail);
    if (to) {
      const linkFor = ctx.link || (() => '');
      const buttons = it.answer === 'buttons' ? it.options.map((op, i) => ({ label: op, url: linkFor({ c: ctx.candidateId, k: o.key, a: 'ck', v: i }), secondary: i > 0 })).filter(b => b.url)
        : it.answer === 'rating' ? [1, 2, 3, 4, 5].map(n => ({ label: String(n), url: linkFor({ c: ctx.candidateId, k: o.key, a: 'ck', v: 'r' + n }), secondary: true })).filter(b => b.url) : [];
      const about = it.to === 'candidate' ? '' : `About: ${cand.name || ''}${cand.clientLabel ? ' · ' + cand.clientLabel : ''}${(cand.profile && cand.profile.doj) ? ' · joining ' + fmtDoj(cand.profile.doj) : ''}\n\n`;
      const tail = it.answer === 'date' || it.answer === 'text' ? '\n\nPlease reply to this email with your answer.' : '';
      out.email = { to, cc: it.cc || '', replyTo: it.replyTo || '', subject: `${prefix}${it.title}${it.to === 'candidate' ? '' : ' · ' + (cand.name || '')}`, text: about + body.replace(/\*/g, '') + tail, buttons };
    } else out.emailMissing = it.to;
  }
  return out;
}

function stopped(r, o) {
  const it = o.item;
  if (!it.stopOn.length || !/@/.test(o.key)) return false;
  return Object.entries(r.asks).some(([k, a]) => k.startsWith(it.id + '@') && a.answer && it.stopOn.includes(a.answer));
}

// What is due for a candidate at `now`. ctx: { waBusy, pending: [open induction titles], hrEmail, link, candidateId }.
// Returns [{ key, item, wa?, email?, reminder?, escalate? }] and records them as sent (caller saves the candidate).
function due(cand, setup, now, ctx = {}) {
  if (!setup || setup.enabled === false || cand.exited) return [];
  const doj = cand.profile && cand.profile.doj;
  if (!doj) return [];
  const r = state(cand);
  const quiet = istHour(now) < QUIET.from || istHour(now) >= QUIET.to;
  let waBusy = Boolean(ctx.waBusy) || (r.pending && now - Date.parse(r.pending.at) < 2 * H);
  const out = [];
  for (const o of occurrences(setup)) {
    const it = o.item;
    const a = r.asks[o.key];
    const t = at(doj, o.day, it.time);
    if (t == null || now < t) continue;
    if (a && a.sentAt) {
      // reminder, then escalation, for unanswered questions
      if (a.answer || it.answer === 'none' || a.closed) continue;
      if (it.remind > 0 && !a.remindedAt && now >= Date.parse(a.sentAt) + it.remind * H) {
        if (wantsWa(it) && (quiet || waBusy)) continue;
        const b = build(o, cand, setup, ctx, { reminder: true });
        a.remindedAt = nowIso(now);
        if (b.wa) { r.pending = { key: o.key, at: nowIso(now) }; waBusy = true; }
        out.push(Object.assign(b, { reminder: true }));
        continue;
      }
      const base = a.remindedAt || (it.remind > 0 ? null : a.sentAt);
      if (it.escalate && !a.escalatedAt && base && now >= Date.parse(base) + Math.max(24, it.remind || 24) * H) {
        a.escalatedAt = nowIso(now);
        cand.handovers = (cand.handovers || []).concat([{ why: `No answer: "${it.title}"${it.to !== 'candidate' ? ' (' + it.to + ')' : ''}`, at: nowIso(now), open: true }]);
        out.push({ key: o.key, item: it, escalate: true });
      }
      continue;
    }
    if (a && a.skipped) continue;
    if (stopped(r, o) || (it.when === 'induction_open' && !(ctx.pending || []).length)) { r.asks[o.key] = { skipped: true, why: 'not needed' }; continue; }
    if (now > t + 3 * D) { r.asks[o.key] = { skipped: true, why: 'too late' }; continue; }
    const isQuestion = it.answer !== 'none';
    if (wantsWa(it) && (quiet || (isQuestion && waBusy))) continue;
    const b = build(o, cand, setup, ctx);
    if (!b.wa && !b.email) { if (!a || !a.missingAt) r.asks[o.key] = { missingAt: nowIso(now), why: 'no ' + (b.emailMissing || 'recipient') + ' email' }; continue; }
    r.asks[o.key] = { sentAt: nowIso(now), via: [b.wa ? 'whatsapp' : '', b.email ? 'email' : ''].filter(Boolean).join('+') };
    if (b.wa && isQuestion) { r.pending = { key: o.key, at: nowIso(now) }; waBusy = true; }
    out.push(b);
  }
  return out;
}

// HR "Send now" for one occurrence key.
function sendNow(cand, setup, key, ctx = {}) {
  const o = occurrences(setup).find(x => x.key === key);
  if (!o) return null;
  const r = state(cand);
  const b = build(o, cand, setup, ctx);
  if (!b.wa && !b.email) return { error: b.emailMissing ? `no_${b.emailMissing}_email` : 'nothing_to_send' };
  r.asks[key] = Object.assign({}, r.asks[key], { sentAt: nowIso(), via: [b.wa ? 'whatsapp' : '', b.email ? 'email' : ''].filter(Boolean).join('+'), answer: undefined, skipped: undefined, by: 'hr' });
  if (b.wa && o.item.answer !== 'none') r.pending = { key, at: nowIso() };
  return b;
}

// Date answers: 25/11/2026, 25-11-26, 25 Nov 2026, Nov 25.
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function parseDate(t, refYear) {
  let m = /(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/.exec(t);
  let d, mo, y;
  if (m) { d = +m[1]; mo = +m[2]; y = m[3] ? +m[3] : refYear; }
  else if ((m = /(\d{1,2})\s*([a-z]{3})[a-z]*\.?(?:\s*,?\s*(\d{4}))?/i.exec(t))) { d = +m[1]; mo = MON[m[2].toLowerCase()]; y = m[3] ? +m[3] : refYear; }
  else if ((m = /([a-z]{3})[a-z]*\.?\s*(\d{1,2})(?:\s*,?\s*(\d{4}))?/i.exec(t))) { mo = MON[m[1].toLowerCase()]; d = +m[2]; y = m[3] ? +m[3] : refYear; }
  if (!d || !mo || mo > 12 || d > 31) return '';
  if (y < 100) y += 2000;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Records an answer (from WhatsApp or an email link). Returns { flagged, why }.
function record(cand, setup, key, value, by) {
  const o = occurrences(setup).find(x => x.key === key);
  const r = state(cand);
  const a = r.asks[key] = Object.assign({}, r.asks[key], { answer: value, answeredAt: nowIso(), by });
  const it = o ? o.item : { title: key, flag: [], saveAs: '' };
  let why = '';
  if (it.flag && it.flag.includes(value)) why = `"${it.title}": ${value}`;
  if (it.answer === 'rating' && +value <= 2) why = `"${it.title}": rated ${value} of 5`;
  if (it.saveAs) {
    cand.prejoin = Object.assign({}, cand.prejoin, { [it.saveAs]: { value, at: nowIso(), title: it.title } });
    const doj = cand.profile && cand.profile.doj;
    if (it.saveAs === 'relievingDate' && doj && value >= doj) why = `Relieving date ${value} is on or after the joining date ${doj}`;
  }
  if (why) {
    a.flagged = true;
    cand.handovers = (cand.handovers || []).concat([{ why: 'Check-in: ' + why + (by && by !== 'candidate' ? ` (answered by ${by})` : ''), at: nowIso(), open: true }]);
  }
  if (r.pending && r.pending.key === key) r.pending = null;
  return { flagged: Boolean(why), why, item: it };
}

function onInbound(cand, setup, m) {
  const r = cand.checkins;
  if (!r || !r.pending || !setup) return { handled: false, replies: [] };
  const o = occurrences(setup).find(x => x.key === r.pending.key);
  if (!o) { r.pending = null; return { handled: false, replies: [] }; }
  const it = o.item;
  const text = String(m.text || '').trim();
  if (!text) return { handled: false, replies: [] };
  let value;
  if (it.answer === 'buttons') {
    const low = text.toLowerCase();
    const n = /^\s*(\d)\s*$/.exec(text);
    value = (n && it.options[+n[1] - 1]) || it.options.find(op => op.toLowerCase() === low) || it.options.find(op => low.startsWith(op.toLowerCase()) || op.toLowerCase().startsWith(low)) || '';
    if (!value) return { handled: false, replies: [] };
  } else if (it.answer === 'rating') {
    const n = /^\s*([1-5])\b/.exec(text);
    if (!n) return { handled: true, replies: [{ text: 'Please reply with a number from 1 to 5.' }] };
    value = n[1];
  } else if (it.answer === 'date') {
    const doj = (cand.profile && cand.profile.doj) || '';
    value = parseDate(text, +(doj.slice(0, 4)) || new Date().getUTCFullYear());
    if (!value) return { handled: true, replies: [{ text: 'Sorry, I could not read that date. Please send it like 25/11/2026.' }] };
  } else if (it.answer === 'text') value = text.slice(0, 500);
  else return { handled: false, replies: [] };
  const res = record(cand, setup, o.key, value, 'candidate');
  const reply = res.flagged ? 'Thanks for telling me. I have let the HR team know and they will get in touch with you soon.'
    : it.answer === 'rating' ? (+value >= 4 ? 'Thank you, great to hear! 😊' : 'Thank you for the honest feedback.')
      : it.answer === 'date' ? `Thanks, noted your relieving date as ${fmtDoj(value)}.`
        : /question/i.test(value) ? 'Sure, please type your question and I will help.' : /call me/i.test(value) ? 'Great, HR will call you in the next few days.' : 'Thanks, noted!';
  return { handled: true, replies: [{ text: reply }] };
}

// For the journey screen: every occurrence with its date, for one candidate.
function list(setup, doj) {
  return occurrences(setup).map(o => ({ key: o.key, id: o.item.id, title: o.item.title + (/@/.test(o.key) ? ` (D${o.day >= 0 ? '+' : ''}${o.day})` : ''), stage: o.item.stage, day: o.day, time: o.item.time, date: addDaysIso(doj, o.day), item: o.item }));
}

module.exports = { defaults, cleanSetup, occurrences, itemsOf, due, sendNow, onInbound, record, fill, list, parseDate, at, mapUrl, DEFAULT_ITEMS };
