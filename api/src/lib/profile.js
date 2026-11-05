'use strict';
// Personal details the joining forms need that no document shows, asked on WhatsApp one at a time,
// plus the candidate's confirmation of the filled forms.
//
// Stored on the candidate record:
//   details -> { step, startedAt, completedAt, marital, spouse, presAddr, permSame, permAddr, family[], familyPlace,
//                nominees[], guardian, prevEpf, uan, prevPf, exitDate, prevEps, intl, religion }
//   forms   -> { vals, states, sentAt, pendingConfirm, awaitNote, candidateConfirmedAt, candidateNote, approvedBy, approvedAt }

const ocr = require('./ocr');

const nowIso = () => new Date().toISOString();
const clean = (s, n = 300) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const RELATIONS = ['Spouse', 'Wife', 'Husband', 'Father', 'Mother', 'Son', 'Daughter', 'Brother', 'Sister', 'Grandfather', 'Grandmother', 'Father-in-law', 'Mother-in-law', 'Guardian'];

function ageOn(iso, at = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return null;
  let a = at.getFullYear() - +m[1];
  if (at.getMonth() + 1 < +m[2] || (at.getMonth() + 1 === +m[2] && at.getDate() < +m[3])) a--;
  return a;
}

function relationOf(s) {
  const t = String(s || '').toLowerCase();
  for (const r of RELATIONS) if (t.includes(r.toLowerCase())) return r === 'Wife' || r === 'Husband' ? 'Spouse' : r;
  return '';
}

// "Sunita Pawar, Mother, 05/05/1969" — one person per line (or separated by ;).
function parseFamily(text) {
  const out = [], bad = [];
  for (const raw of String(text || '').split(/\n|;/).map(s => s.trim()).filter(Boolean)) {
    const parts = raw.split(/\s*[,|-]\s*(?=\S)/);
    const dob = ocr.toIsoDate(raw);
    const relation = relationOf(raw);
    const name = ocr.cleanName(parts.find(p => /[A-Za-z]{2}/.test(p) && !relationOf(p) && !ocr.toIsoDate(p)) || '');
    if (name && relation && dob) out.push({ name, relation, dob, livesWith: true });
    else bad.push(raw);
  }
  return { family: out, bad };
}

// "Sunita Pawar 50%, Rahul Pawar 50%" or just "Sunita Pawar" (= 100%).
function parseNominees(text, family) {
  const parts = String(text || '').split(/,|\n|;|\band\b/i).map(s => s.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    const pm = /(\d{1,3})\s*%/.exec(p);
    const nm = p.replace(/\d{1,3}\s*%/, '').trim();
    const match = family.find(f => ocr.namesMatch(f.name, nm) || f.name.toLowerCase() === nm.toLowerCase() || f.relation.toLowerCase() === nm.toLowerCase());
    if (!match) return { error: `I couldn't find "${clean(nm, 40)}" in your family list. Please use the names exactly as you sent them.` };
    out.push({ name: match.name, relation: match.relation, dob: match.dob, share: pm ? +pm[1] : null });
  }
  if (!out.length) return { error: 'Please type at least one nominee.' };
  if (out.length === 1 && out[0].share == null) out[0].share = 100;
  if (out.some(n => n.share == null)) { const each = Math.floor(100 / out.length); out.forEach((n, i) => { n.share = i === out.length - 1 ? 100 - each * (out.length - 1) : each; }); }
  const sum = out.reduce((a, n) => a + n.share, 0);
  if (sum !== 100) return { error: `The shares add up to ${sum}%. They need to add up to 100%.` };
  return { nominees: out };
}

/* ---------- what the forms need ---------- */
// ESIC form only when gross pay is within the ESIC ceiling (the offer decides this).
const esicApplies = c => Boolean(c && c.profile && c.profile.esic) && !formOff(c, 'esic');
const formOff = (c, id) => Array.isArray(c && c.formsOff) && c.formsOff.includes(id);
// An Aadhaar plus an individual PAN means an Indian resident: not an international worker.
const indianIds = c => Boolean(c && c.kyc && c.kyc.aadhaarLast4 && c.kyc.pan && String(c.kyc.pan)[3] === 'P');

/* ---------- the questions, in order ---------- */
const yes = t => /^(y|yes|haan|ha)\b/i.test(t);
const no = t => /^(n|no|nahi|nope)\b/i.test(t);

const STEPS = [
  { key: 'marital', forms: ['f11', 'f2a', 'esic', 'gf'], has: d => Boolean(d.marital) && d.marital !== 'Other', ask: () => ({ text: 'A few details for your joining forms (PF, ESIC, gratuity). It takes about 2 minutes.\n\nWhat is your marital status?', buttons: ['Single', 'Married', 'Other'] }),
    handle: (t, d) => { if (/^single|unmarried/i.test(t)) d.marital = 'Unmarried'; else if (/^married/i.test(t)) d.marital = 'Married'; else if (/^other/i.test(t)) d.marital = 'Other'; else if (/widow|divorc|separat/i.test(t)) d.marital = /widow/i.test(t) ? (/widower/i.test(t) ? 'Widower' : 'Widow') : /divorc/i.test(t) ? 'Divorced' : 'Separated'; else return 'Please tap Single, Married or Other.'; } },
  { key: 'maritalOther', forms: ['f11', 'f2a', 'esic', 'gf'], when: d => d.marital === 'Other', has: () => false, ask: () => ({ text: 'Please type one: *Widow*, *Widower*, *Divorced* or *Separated*.' }),
    handle: (t, d) => { const m = /widower|widow|divorced|separated/i.exec(t); if (!m) return 'Please type Widow, Widower, Divorced or Separated.'; d.marital = m[0][0].toUpperCase() + m[0].slice(1).toLowerCase(); } },
  { key: 'spouse', forms: ['f11', 'f2a', 'esic'], when: d => d.marital === 'Married', has: d => Boolean(d.spouse), ask: () => ({ text: "What is your spouse's full name?" }),
    handle: (t, d) => { const n = ocr.cleanName(t); if (n.split(' ').length < 1 || n.length < 3) return "Please type your spouse's full name."; d.spouse = n; } },
  // Address already read from the Aadhaar: just confirm it.
  { key: 'presConfirm', forms: ['f2a', 'esic', 'gf'], when: (d, c) => Boolean(c.kyc && c.kyc.address), has: d => Boolean(d.presAddr) || d.presConfirmed === false,
    ask: (d, c) => ({ text: `Is this your *present address* (where you live now)?\n\n${c.kyc.address}`, buttons: ['Yes', 'Different'] }),
    handle: (t, d, c) => { if (yes(t)) { d.presAddr = clean(c.kyc.address); d.presConfirmed = true; } else if (/^diff|^no/i.test(t)) d.presConfirmed = false; else return 'Please tap Yes or Different.'; } },
  { key: 'presAddr', forms: ['f2a', 'esic', 'gf'], has: d => Boolean(d.presAddr), ask: () => ({ text: 'What is your *present address* (where you live now), with PIN code?' }),
    handle: (t, d) => { if (t.length < 15 || !/\d{6}/.test(t)) return 'Please type the full address including the 6-digit PIN code.'; d.presAddr = clean(t); } },
  { key: 'permSame', forms: ['f2a', 'esic', 'gf'], has: d => d.permSame === true || d.permSame === false, ask: () => ({ text: 'Is your *permanent address* the same?', buttons: ['Same address', 'Different'] }),
    handle: (t, d) => { if (/^same|^yes/i.test(t)) d.permSame = true; else if (/^diff|^no/i.test(t)) d.permSame = false; else return 'Please tap Same address or Different.'; } },
  { key: 'permAddr', forms: ['f2a', 'esic', 'gf'], when: d => d.permSame === false, has: d => Boolean(d.permAddr), ask: () => ({ text: 'Please type your permanent address, with PIN code.' }),
    handle: (t, d) => { if (t.length < 15 || !/\d{6}/.test(t)) return 'Please type the full address including the 6-digit PIN code.'; d.permAddr = clean(t); } },
  { key: 'family', forms: ['f2a', 'f2b', 'esic', 'gf'], has: d => (d.family || []).length > 0, ask: (d, c) => ({ text: `Please list your family members, *one per line*: name, relation, date of birth.\n\nFor example:\n${d.marital === 'Married' ? `${d.spouse || 'Priya Pawar'}, Spouse, 12/01/1996\n` : ''}Sunita Pawar, Mother, 05/05/1969\n\n${esicApplies(c) ? 'These are used for ESIC medical cover and PF/pension nomination.' : 'These are used for your PF and pension nomination.'}` }),
    handle: (t, d) => { const r = parseFamily(t); if (!r.family.length) return 'I couldn\'t read that. Please send one person per line like this:\nSunita Pawar, Mother, 05/05/1969'; if (r.bad.length) return `I couldn't read: "${clean(r.bad[0], 60)}". Please send the whole list again, one per line: name, relation, date of birth.`; d.family = r.family; } },
  { key: 'livesWith', forms: ['esic'], when: (d, c) => esicApplies(c) && (d.family || []).length > 0, has: d => d.livesWithAsked === true, ask: () => ({ text: 'Do all of them live with you?', buttons: ['Yes, all', 'No'] }),
    handle: (t, d) => { if (/^yes/i.test(t)) d.family.forEach(f => { f.livesWith = true; }); else if (/^no/i.test(t)) d.family.forEach(f => { f.livesWith = false; }); else return 'Please tap Yes, all or No.'; d.livesWithAsked = true; } },
  { key: 'familyPlace', forms: ['esic'], when: (d, c) => esicApplies(c) && (d.family || []).some(f => f.livesWith === false), has: d => Boolean(d.familyPlace), ask: () => ({ text: 'Where do they live? Type the town and state, e.g. *Nashik, Maharashtra*.' }),
    handle: (t, d) => { if (t.length < 3) return 'Please type the town and state.'; d.familyPlace = clean(t, 120); } },
  { key: 'nominees', forms: ['f2a', 'f2b', 'esic', 'gf'], has: d => (d.nominees || []).length > 0 && (d.nominees || []).every(n => (d.family || []).some(f => f.name === n.name)), ask: d => ({ text: 'Who should be your *nominee* for PF and gratuity?\n\nTap a name for 100%, or type names with shares, e.g. *Sunita Pawar 50%, Rahul Pawar 50%*.', buttons: (d.family || []).slice(0, 3).map(f => f.name.slice(0, 20)) }),
    handle: (t, d) => { const r = parseNominees(t, d.family || []); if (r.error) return r.error; d.nominees = r.nominees; } },
  { key: 'guardian', forms: ['f2a', 'gf'], when: d => (d.nominees || []).some(n => (ageOn(n.dob) ?? 99) < 18), has: d => Boolean(d.guardian), ask: () => ({ text: 'One of your nominees is under 18. Who is their guardian? Please type the full name.' }),
    handle: (t, d) => { const n = ocr.cleanName(t); if (n.length < 3) return 'Please type the guardian\'s full name.'; d.guardian = n; } },
  { key: 'prevEpf', forms: ['f11'], has: d => Boolean(d.prevEpf), ask: () => ({ text: 'Did you have a *PF account (UAN)* with an earlier employer?', buttons: ['Yes', 'No'] }),
    handle: (t, d) => { if (yes(t)) d.prevEpf = 'Yes'; else if (no(t)) { d.prevEpf = 'No'; d.prevEps = 'No'; } else return 'Please tap Yes or No.'; } },
  { key: 'uan', forms: ['f11'], when: d => d.prevEpf === 'Yes', has: d => d.uan !== undefined, ask: () => ({ text: 'What is your 12-digit *UAN*? It\'s on your old payslips or the UAN card. Type *don\'t know* if you can\'t find it.' }),
    handle: (t, d) => { const u = t.replace(/\D/g, ''); if (/don'?t know|dont know|not sure|skip/i.test(t)) d.uan = ''; else if (u.length === 12) d.uan = u; else return 'A UAN has 12 digits. Please check and type it again, or type *don\'t know*.'; } },
  { key: 'prevPf', forms: ['f11'], when: d => d.prevEpf === 'Yes', has: d => d.prevPf !== undefined, ask: () => ({ text: 'Your previous *PF member ID* (looks like MH/BAN/0012345/000/0001234), if you have it. Type *skip* if not.' }),
    handle: (t, d) => { d.prevPf = /^skip|don'?t know|no$/i.test(t) ? '' : clean(t, 60).toUpperCase(); } },
  { key: 'exitDate', forms: ['f11'], when: d => d.prevEpf === 'Yes', has: d => Boolean(d.exitDate), ask: () => ({ text: 'What was your *last working day* at your previous job? (e.g. 31/10/2026)' }),
    handle: (t, d) => { const iso = ocr.toIsoDate(t); if (!iso) return 'Please type the date like 31/10/2026.'; d.exitDate = iso; } },
  { key: 'prevEps', forms: ['f11'], when: d => d.prevEpf === 'Yes', has: d => Boolean(d.prevEps), ask: () => ({ text: 'Were you also a member of the *pension scheme (EPS)* there? Most employees are.', buttons: ['Yes', 'No', 'Not sure'] }),
    handle: (t, d) => { if (yes(t)) d.prevEps = 'Yes'; else if (no(t)) d.prevEps = 'No'; else if (/not sure|don'?t know/i.test(t)) d.prevEps = 'Not sure'; else return 'Please tap Yes, No or Not sure.'; } },
  { key: 'intl', forms: ['f11'], when: (d, c) => !indianIds(c), has: d => Boolean(d.intl), ask: () => ({ text: 'Are you joining as an *international worker* (holding a foreign passport, or covered by another country\'s social security)?', buttons: ['No', 'Yes'] }),
    handle: (t, d) => { if (no(t)) d.intl = 'No'; else if (yes(t)) d.intl = 'Yes'; else return 'Please tap No or Yes.'; } },
  { key: 'religion', forms: ['gf'], when: (d, c) => !formOff(c, 'gf'), has: d => Boolean(d.religion), ask: () => ({ text: 'Last one: the gratuity nomination form (Form F) asks for religion. Tap one, or type yours (or *prefer not to say*).', buttons: ['Hindu', 'Muslim', 'Other'] }),
    handle: (t, d) => { if (/^other$/i.test(t)) return 'Please type your religion, e.g. Christian, Sikh, Jain, Buddhist, Parsi, or *prefer not to say*.'; d.religion = /prefer not/i.test(t) ? 'Prefer not to say' : clean(t, 40).replace(/^\w/, c => c.toUpperCase()); } }
];

// scope: only questions that feed these forms (e.g. ['f11']); none = all forms.
function nextStep(d, c, after, scope) {
  const only = scope === undefined ? d.scope : scope;
  let i = after ? STEPS.findIndex(s => s.key === after) + 1 : 0;
  for (; i < STEPS.length; i++) {
    const st = STEPS[i];
    if (only && only.length && !st.forms.some(f => only.includes(f))) continue;
    if (st.when && !st.when(d, c)) continue;
    if (st.has && st.has(d, c)) continue;
    return st;
  }
  return null;
}

function ask(d, c, step) {
  const q = step.ask(d, c);
  if (q.buttons && !q.buttons.length) delete q.buttons;
  return q;
}

// Values the forms can take without asking.
function infer(d, c) {
  if (!d.intl && indianIds(c)) { d.intl = 'No'; d.intlInferred = true; }
}

// Starts the questions, asking only what is still missing (full: ask everything again).
// Returns the first message, or null when nothing is missing.
const FORM_NAMES = { f11: 'Form 11 (PF declaration)', f2a: 'Form 2 (PF nomination)', f2b: 'Form 2 Part B (pension)', esic: 'the ESIC form', gf: 'Form F (gratuity nomination)' };

// Which forms still need answers (for the app's per-form buttons).
function missingByForm(cand) {
  const d = Object.assign({ family: [], nominees: [] }, cand.details);
  infer(d, cand);
  const out = {};
  for (const f of Object.keys(FORM_NAMES)) {
    const keys = [];
    let st = nextStep(d, cand, null, [f]);
    while (st) { keys.push(st.key); st = nextStep(d, cand, st.key, [f]); }
    out[f] = keys;
  }
  return out;
}

function start(cand, opts = {}) {
  const prev = cand.details || {};
  const scope = Array.isArray(opts.forms) ? opts.forms.filter(f => FORM_NAMES[f]) : [];
  const d = cand.details = opts.full
    ? { startedAt: nowIso(), family: [], nominees: [], previous: prev.completedAt ? { completedAt: prev.completedAt } : undefined }
    : Object.assign({ family: [], nominees: [] }, prev, { startedAt: nowIso(), completedAt: '' });
  d.scope = scope.length ? scope : null;
  infer(d, cand);
  const s = nextStep(d, cand);
  if (!s) {
    d.step = null; d.scope = null;
    if (!nextStep(d, cand, null, null)) d.completedAt = nowIso();
    return null;
  }
  d.step = s.key;
  const q = ask(d, cand, s);
  const forWhat = d.scope ? d.scope.map(f => FORM_NAMES[f]).join(' and ') : 'your joining forms';
  if (s.key !== 'marital' || d.scope) q.text = `A few details are still needed for ${forWhat}.\n\n` + q.text;
  return q;
}

const DONE_TEXT = 'Thank you, that\'s everything! HR will prepare your joining forms and send them here for you to check.';

/* ---------- inbound ---------- */
// Returns { handled, replies }.
function onInbound(cand, m) {
  const text = String(m.text || '').trim();
  if (!text || m.media) return { handled: false, replies: [] };

  // Forms sent for confirmation.
  const f = cand.forms;
  if (f && f.awaitNote) {
    f.awaitNote = false; f.candidateNote = clean(text, 1000); f.candidateNoteAt = nowIso();
    cand.handovers = (cand.handovers || []).concat([{ why: 'Correction to joining forms: ' + clean(text, 200), at: nowIso(), open: true }]);
    return { handled: true, replies: [{ text: 'Thanks, I\'ve passed that to HR. They\'ll correct it and send the forms again.' }] };
  }
  if (f && f.pendingConfirm) {
    if (/^(all\s*correct|correct|yes|ok|okay|confirm)/i.test(text)) {
      f.pendingConfirm = false; f.candidateConfirmedAt = nowIso();
      cand.stage = 'Forms confirmed';
      return { handled: true, replies: [{ text: 'Thank you! Your joining forms are confirmed. HR will sign and file them.' }] };
    }
    if (/^(something|wrong|no|change|fix)/i.test(text)) {
      f.pendingConfirm = false; f.awaitNote = true;
      return { handled: true, replies: [{ text: 'No problem. Please type what needs to change, e.g. *Nominee share should be Mother 100%*.' }] };
    }
  }

  // Details questions.
  const d = cand.details;
  if (!d || !d.step) {
    if (/^(details|my details|forms?)$/i.test(text)) { const q = start(cand); return { handled: true, replies: [q || { text: 'I already have everything I need for your joining forms, thank you!' }] }; }
    return { handled: false, replies: [] };
  }
  if (/\?\s*$/.test(text)) return { handled: false, replies: [] }; // a question: let the agent answer it
  const step = STEPS.find(s => s.key === d.step);
  if (!step) { d.step = null; return { handled: false, replies: [] }; }
  const err = step.handle(text, d, cand);
  if (err) return { handled: true, replies: [{ text: err }] };
  infer(d, cand);
  const nx = nextStep(d, cand, step.key);
  if (!nx) {
    const scope = d.scope;
    d.step = null; d.scope = null;
    const allDone = !nextStep(d, cand, null, null);
    if (allDone) { d.completedAt = nowIso(); if (!/Forms/.test(cand.stage || '')) cand.stage = 'Details submitted'; }
    const text = scope && !allDone ? `Thank you, that's everything needed for ${scope.map(f => FORM_NAMES[f]).join(' and ')}.` : DONE_TEXT;
    return { handled: true, replies: [{ text }] };
  }
  d.step = nx.key;
  return { handled: true, replies: [ask(d, cand, nx)] };
}

module.exports = { STEPS, FORM_NAMES, missingByForm, esicApplies, indianIds, start, onInbound, parseFamily, parseNominees, ageOn, DONE_TEXT };
