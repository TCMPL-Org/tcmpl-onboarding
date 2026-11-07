'use strict';
// Exit cases: exit_cases/exit-<client>-<employee code or phone>-<yyyymmdd>.
// A case holds the employee, the separation, the notice worked out from the client's rules,
// the approvals it needs, the dated plan of steps and an activity log.

const crypto = require('node:crypto');
const R = require('./rules');
const S = require('./setup');
const wa = require('../whatsapp');
const email = require('../email');

const str = S.str;
const nowIso = () => new Date().toISOString();
const MAX_IMPORT = 300;

function caseId(client, key, formal) {
  const k = String(key || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 40);
  return `exit-${S.cleanClient(client)}-${k}-${String(formal || '').replace(/-/g, '')}`;
}

function cleanEmployee(e) {
  e = e && typeof e === 'object' ? e : {};
  const phone = wa.normalizePhone(e.mobile || e.phone || '');
  return {
    code: str(e.code, 40), name: str(e.name, 120), phone: phone || '', email: email.addresses(e.email)[0] || '',
    designation: str(e.designation, 120), dept: str(e.dept, 80), level: str(e.level, 20), location: str(e.location, 80), doj: R.isoDate(e.doj),
    manager: str(e.manager, 120), managerEmail: email.addresses(e.managerEmail)[0] || '', managerPhone: wa.normalizePhone(e.managerMobile || e.managerPhone || '') || ''
  };
}

// Works out the whole case from the HR input and the client's setup. Returns { k, errors }.
function build(setup, input, ctx = {}) {
  input = input && typeof input === 'object' ? input : {};
  const errors = [];
  const emp = cleanEmployee(input.employee);
  if (!emp.name) errors.push('Employee name is required.');
  if (!emp.code && !emp.phone) errors.push('Employee code or a valid mobile number is required.');
  if (str(input.employee && input.employee.mobile, 30) && !emp.phone) errors.push('The mobile number is not valid (use the country code, e.g. 91 98xxxxxxxx).');
  const type = R.typeOf(setup, str(input.typeId, 40));
  if (!type) errors.push('Choose a separation type.');
  const raisedBy = ['Employee', 'Manager', 'HR'].includes(input.raisedBy) ? input.raisedBy : 'HR';
  if (type && !R.raisers(type).includes(raisedBy) && !ctx.imported) errors.push(`${raisedBy} cannot raise "${type.name}" (see Exit setup → Separation types).`);
  const formal = R.isoDate(input.formal);
  if (!formal) errors.push('The formal date is required.');
  const first = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(str(input.first, 16)) && R.isoDate(input.first) ? str(input.first, 16) : formal;
  const requestedLwd = R.isoDate(input.requestedLwd);
  const givenLwd = R.isoDate(input.lwd);
  if (errors.length) return { k: null, errors };

  const k = {
    id: caseId(ctx.client, emp.code || emp.phone, formal), client: S.cleanClient(ctx.client), clientLabel: str(ctx.clientLabel, 120),
    employee: emp, typeId: type.id, typeName: type.name, category: type.cat, raisedBy, source: str(input.source, 40) || 'Exit desk',
    first, formal, requestedLwd, startOverride: str(input.startOverride, 10),
    announce: str(input.announce, 40) || type.announce, ta: str(input.ta, 40) || type.ta, replace: str(input.replace, 40) || 'Ask manager', reason: str(input.reason, 300),
    noticeDays: 0, noticeText: type.notice, noticeRule: '', noticeStart: '', noticeStartRule: '', noticeLwd: '', lwd: '', waiverDays: 0
  };

  if (type.notice === 'Serve notice') {
    const n = R.noticeFor(setup, emp, formal);
    const st = R.startRuleFor(setup, emp, k.startOverride);
    const startDate = st.start === 'first' ? first.slice(0, 10) : formal; // "accept" counts from the formal date until acceptance is recorded
    k.noticeDays = n.days; k.noticeRule = n.label; k.noticeStart = startDate; k.noticeStartRule = `${(require('./defaults').START)[st.start]} · ${st.src}`;
    k.noticeLwd = R.addDays(startDate, n.days);
    k.lwd = givenLwd || k.noticeLwd;
    if (!givenLwd && requestedLwd && requestedLwd < k.noticeLwd && requestedLwd >= formal) { k.lwd = requestedLwd; k.waiverDays = R.daysBetween(requestedLwd, k.noticeLwd); }
  } else {
    k.lwd = givenLwd || requestedLwd || formal;
  }
  if (k.lwd < formal) return { k: null, errors: ['The last working day cannot be before the formal date.'] };

  const actions = type.cat === 'Voluntary' ? ['Accept resignation'] : type.cat === 'Involuntary' ? ['Involuntary separation'] : [];
  if (k.waiverDays > 0) actions.push('Notice waiver');
  k.approvals = actions.map(a => {
    const r = R.approvalRule(setup, a, emp, type.id, 0);
    return { id: 'ap-' + crypto.randomBytes(4).toString('hex'), action: a, ruleId: r ? r.id : '', mode: r ? r.mode : 'Sequential', sla: r ? r.sla : 48, delegate: r ? r.delegate : 'HR',
      chain: R.chainOf(r).map(s => Object.assign(s, { person: R.personFor(setup, s.role, emp) })), status: 'Pending' };
  });
  k.plan = R.planFor(setup, k);
  return { k, errors: [] };
}

const summary = k => ({
  id: k.id, client: k.client, name: k.employee.name, code: k.employee.code, phone: k.employee.phone, dept: k.employee.dept, level: k.employee.level, designation: k.employee.designation,
  typeId: k.typeId, typeName: k.typeName, category: k.category, raisedBy: k.raisedBy, source: k.source, formal: k.formal, lwd: k.lwd, noticeDays: k.noticeDays, waiverDays: k.waiverDays,
  stage: k.stage, status: k.status, createdAt: k.createdAt, next: (k.plan || []).find(s => s.status === 'planned' || s.status === 'due') || null,
  red: (k.alerts || []).filter(a => a.open).length
});

async function raise(store, setup, input, ctx, user) {
  const { k, errors } = build(setup, input, ctx);
  if (!k) return { status: 400, body: { error: 'invalid', errors } };
  const prev = await store.get('exit_cases', k.id);
  if (prev && prev.data && prev.data.status === 'open') return { status: 409, body: { error: 'case_exists', id: k.id } };
  Object.assign(k, { stage: 'raised', status: 'open', createdAt: nowIso(), createdBy: user.name, alerts: [], log: [{ at: nowIso(), by: user.name, text: `Exit raised (${k.source}, by ${k.raisedBy}): ${k.typeName}; last working day ${R.niceDate(k.lwd)}${k.noticeDays ? `, notice ${k.noticeDays} days (${k.noticeRule})` : ''}.` }] });
  await store.put('exit_cases', k.id, k, user);
  return { status: 200, body: { case: k } };
}

// HRMS import: rows of { column: value } with whatever column names the HRMS uses.
const SYN = {
  code: ['employeecode', 'empcode', 'empid', 'employeeid', 'code', 'staffid'], name: ['employeename', 'name', 'fullname'], mobile: ['mobile', 'phone', 'mobilenumber', 'whatsapp', 'contactnumber'],
  email: ['email', 'personalemail', 'emailid'], designation: ['designation', 'title', 'jobtitle'], dept: ['department', 'dept'], level: ['level', 'grade', 'band'], location: ['location', 'city', 'site'],
  doj: ['dateofjoining', 'doj', 'joiningdate'], manager: ['manager', 'reportingmanager', 'managername'], managerEmail: ['manageremail', 'reportingmanageremail'],
  type: ['separationtype', 'exittype', 'type'], formal: ['resignationdate', 'dateofresignation', 'noticedate', 'formaldate'], lwd: ['lastworkingday', 'relievingdate', 'lwd', 'exitdate', 'dateofrelieving', 'separationdate'],
  reason: ['reason', 'reasonforleaving', 'exitreason'], raisedBy: ['raisedby', 'initiatedby', 'initiator']
};
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function pick(row, field) {
  for (const [col, v] of Object.entries(row || {})) if (SYN[field].includes(norm(col))) return String(v == null ? '' : v).trim();
  return '';
}
// 02/11/2026, 2-11-2026 (day first, as in India), 2026-11-02, or an Excel serial number.
function anyDate(v) {
  const s = String(v || '').trim();
  if (R.isoDate(s)) return s.slice(0, 10);
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return R.isoDate(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
  if (/^\d{5}$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + (+s) * 864e5).toISOString().slice(0, 10);
  m = /^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-](\d{4})$/.exec(s);
  if (m) { const i = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].toLowerCase()); if (i >= 0) return R.isoDate(`${m[3]}-${String(i + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`); }
  return '';
}
function typeFromText(setup, text) {
  const t = norm(text);
  if (!t) return null;
  const types = setup.types || [];
  const exact = types.find(x => norm(x.id) === t || norm(x.name) === t);
  if (exact) return exact;
  const guess = [['resign', 'resign'], ['voluntaryretire', 'vrs'], ['vrs', 'vrs'], ['superannuat', 'retire'], ['retire', 'retire'], ['death', 'death'], ['deceased', 'death'], ['abscond', 'abandon'], ['abandon', 'abandon'], ['misconduct', 'misconduct'], ['performance', 'performance'], ['layoff', 'retrench'], ['retrench', 'retrench'], ['contract', 'fte_end']];
  for (const [w, id] of guess) if (t.includes(w)) { const x = types.find(y => y.id === id); if (x) return x; }
  return types.find(x => norm(x.name).includes(t) || t.includes(norm(x.name))) || null;
}

async function importRows(store, setup, rows, ctx, user) {
  if (!Array.isArray(rows) || !rows.length) return { status: 400, body: { error: 'no_rows' } };
  if (rows.length > MAX_IMPORT) return { status: 400, body: { error: 'too_many_rows', max: MAX_IMPORT } };
  const results = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const type = typeFromText(setup, pick(row, 'type'));
    const input = {
      employee: { code: pick(row, 'code'), name: pick(row, 'name'), mobile: pick(row, 'mobile'), email: pick(row, 'email'), designation: pick(row, 'designation'), dept: pick(row, 'dept'),
        level: pick(row, 'level'), location: pick(row, 'location'), doj: anyDate(pick(row, 'doj')), manager: pick(row, 'manager'), managerEmail: pick(row, 'managerEmail') },
      typeId: type ? type.id : '', formal: anyDate(pick(row, 'formal')), lwd: anyDate(pick(row, 'lwd')), reason: pick(row, 'reason'),
      raisedBy: ({ employee: 'Employee', manager: 'Manager', hr: 'HR' })[norm(pick(row, 'raisedBy'))] || 'Employee', source: 'HRMS import'
    };
    if (!input.formal && input.lwd) input.formal = input.lwd;
    if (!type) { results.push({ row: i + 2, ok: false, name: input.employee.name, errors: [`Separation type "${pick(row, 'type')}" is not in Exit setup.`] }); continue; }
    const r = await raise(store, setup, input, Object.assign({}, ctx, { imported: true }), user);
    results.push(r.status === 200 ? { row: i + 2, ok: true, id: r.body.case.id, name: input.employee.name }
      : { row: i + 2, ok: false, name: input.employee.name, errors: r.body.errors || [r.body.error === 'case_exists' ? 'An open case already exists for this employee and date.' : r.body.error] });
  }
  return { status: 200, body: { created: results.filter(x => x.ok).length, failed: results.filter(x => !x.ok).length, results } };
}

async function list(store, client, all) {
  const id = S.cleanClient(client);
  return (await store.list('exit_cases')).map(r => r.data).filter(k => k && k.employee && (all || k.client === id))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(summary);
}

async function cancel(store, id, reason, user) {
  const rec = await store.get('exit_cases', id);
  if (!rec) return { status: 404, body: { error: 'case_not_found' } };
  const k = Object.assign({}, rec.data);
  if (k.status !== 'open') return { status: 409, body: { error: 'not_open' } };
  k.status = 'cancelled'; k.cancelledAt = nowIso(); k.cancelledBy = user.name;
  k.log = (k.log || []).concat([{ at: nowIso(), by: user.name, text: `Case cancelled${reason ? ': ' + str(reason, 300) : ''}.` }]);
  await store.put('exit_cases', id, k, user);
  return { status: 200, body: { case: k } };
}

module.exports = { build, raise, importRows, list, cancel, caseId, summary, anyDate, typeFromText, cleanEmployee };
