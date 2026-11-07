'use strict';
// Exit rules: notice period, when notice starts, last working day, who approves, and the dated plan of steps.
// Pure functions (no database), so every rule can be tested and the Exit desk preview uses the same code.

const { START } = require('./defaults');

const DAY = 864e5;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isoDate(v) {
  const s = String(v || '').slice(0, 10);
  const m = ISO_RE.exec(s);
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? s : '';
}
const toUtc = iso => { const m = ISO_RE.exec(iso || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
const addDays = (iso, n) => { const t = toUtc(iso); return Number.isFinite(t) ? new Date(t + n * DAY).toISOString().slice(0, 10) : ''; };
const daysBetween = (a, b) => Math.round((toUtc(b) - toUtc(a)) / DAY);
function monthsBetween(a, b) {
  const x = ISO_RE.exec(a || ''), y = ISO_RE.exec(b || '');
  if (!x || !y) return Infinity;
  return (+y[1] - +x[1]) * 12 + (+y[2] - +x[2]) - (+y[3] < +x[3] ? 1 : 0);
}
function niceDate(iso) {
  const m = ISO_RE.exec(iso || '');
  return m ? `${+m[3]} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1]} ${m[1]}` : (iso || '');
}
// Today in India (the scheduler and "Today" line work in IST).
const todayIst = (now = Date.now()) => new Date(now + 5.5 * 3600e3).toISOString().slice(0, 10);

// "L3-L5", "L2", "Any"
function lvlMatch(rule, lvl) {
  if (!rule || rule === 'Any') return true;
  const m = /^L(\d+)\s*-\s*L(\d+)$/i.exec(rule);
  if (m) { const n = parseInt(String(lvl || '').replace(/\D/g, ''), 10); return n >= +m[1] && n <= +m[2]; }
  return String(rule).toUpperCase() === String(lvl || '').toUpperCase();
}
const deptMatch = (rule, dept) => !rule || rule === 'Any' || String(rule).toLowerCase() === String(dept || '').toLowerCase();
const spec = r => (r.level && r.level !== 'Any' ? 1 : 0) + (r.dept && r.dept !== 'Any' ? 2 : 0) + (r.type && r.type !== 'Any' ? 1 : 0) + ((+r.over || 0) > 0 ? 1 : 0);

const typeOf = (setup, id) => (setup.types || []).find(t => t.id === id) || null;
const raisers = t => String((t && t.raise) || '').split(/[,;]/).map(s => s.trim()).filter(Boolean);

function noticeFor(setup, emp, atIso) {
  const inProb = monthsBetween(emp.doj, atIso) < (+setup.probationMonths || 0);
  const rules = (setup.noticeRules || []).filter(r => lvlMatch(r.level, emp.level) && deptMatch(r.dept, emp.dept)).sort((a, b) => spec(b) - spec(a));
  const r = rules[0] || { level: 'Any', dept: 'Any', prob: 30, conf: 60 };
  const label = `${r.level}${r.dept && r.dept !== 'Any' ? ' · ' + r.dept : ''} (${inProb ? 'probation' : 'confirmed'})`;
  return { days: Math.max(0, +(inProb ? r.prob : r.conf) || 0), inProb, label };
}

function startRuleFor(setup, emp, override) {
  const ns = setup.noticeStart || {};
  if (override && START[override] && ns.allowCase) return { start: override, src: 'Set for this case' };
  const seg = (ns.seg || []).filter(s => lvlMatch(s.level, emp.level) && deptMatch(s.dept, emp.dept)).sort((a, b) => spec(b) - spec(a))[0];
  if (seg && START[seg.start]) return { start: seg.start, src: `Rule for ${[seg.dept !== 'Any' ? seg.dept : '', seg.level !== 'Any' ? seg.level : ''].filter(Boolean).join(' ')}` };
  return { start: START[ns.company] ? ns.company : 'formal', src: 'Company-wide rule' };
}

function approvalRule(setup, action, emp, typeId, amount = 0) {
  return (setup.approvals || [])
    .filter(r => r.action === action && lvlMatch(r.level, emp.level) && deptMatch(r.dept, emp.dept) && (!r.type || r.type === 'Any' || r.type === typeId) && (+r.over || 0) <= amount)
    .sort((a, b) => spec(b) - spec(a) || (+b.over || 0) - (+a.over || 0))[0] || null;
}

function chainOf(rule) {
  if (!rule) return [];
  const par = rule.mode === 'Parallel';
  return String(rule.chain || '').split(par ? /\s*[+>,]\s*/ : /\s*>\s*/).map(s => s.trim()).filter(Boolean)
    .map((role, i) => ({ role, step: par ? 1 : i + 1, status: 'Waiting' }));
}

function personFor(setup, role, emp) {
  if (role === 'Manager') return emp.manager || 'Reporting manager';
  const p = (setup.people || []).find(x => x.role === role);
  return (p && p.contact) || role;
}

function stepApplies(step, type, k) {
  switch (step.when) {
    case 'voluntary': return type.cat === 'Voluntary';
    case 'notice': return type.notice === 'Serve notice' && daysBetween(k.formal, k.lwd) > 16;
    case 'notdeath': return type.id !== 'death';
    case 'interview': return Boolean(type.interview);
    case 'alumni': return Boolean(type.alumni);
    default: return true;
  }
}

// Every switched-on step that applies to this case, with its date. Steps keep their status if re-planned.
function planFor(setup, k, prev = []) {
  const type = typeOf(setup, k.typeId);
  if (!type) return [];
  const old = new Map((prev || []).map(s => [s.key, s]));
  const anchors = { formal: k.formal, first: (k.first || '').slice(0, 10) || k.formal, lwd: k.lwd };
  return (setup.steps || []).filter(s => s.on !== false && stepApplies(s, type, k)).map(s => {
    const date = addDays(anchors[s.anchor] || k.formal, +s.day || 0);
    const was = old.get(s.key);
    return Object.assign({ key: s.key, stage: s.stage, title: s.title, to: s.to, channel: s.channel, date, time: s.time || '11:00', status: 'planned' },
      was && was.status !== 'planned' ? { status: was.status, at: was.at, by: was.by, note: was.note } : {});
  }).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

// Fill a step's message for this case.
function fill(text, k, setup) {
  const e = k.employee || {};
  const v = {
    first: (e.name || '').split(' ')[0] || 'there', name: e.name || '', code: e.code || '', designation: e.designation || '', dept: e.dept || '', location: e.location || '',
    company: (setup.contacts && setup.contacts.company) || k.clientLabel || 'the company', type: (k.typeName || 'exit').toLowerCase(),
    formal: niceDate(k.formal), lwd: niceDate(k.lwd), notice: k.noticeDays ? `${k.noticeDays} days` : (k.noticeText || 'not applicable'),
    manager: e.manager || 'your manager', replace: k.replace || 'Ask manager'
  };
  return String(text || '').replace(/\{(\w+)\}/g, (m, key) => (key in v ? v[key] : m));
}

module.exports = { isoDate, addDays, daysBetween, monthsBetween, niceDate, todayIst, lvlMatch, noticeFor, startRuleFor, approvalRule, chainOf, personFor, planFor, fill, typeOf, raisers, stepApplies };
