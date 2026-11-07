'use strict';
// Reports for the Approvals, Interviews and alumni, and HR dashboard tabs. Read from exit_* collections only.

const R = require('./rules');
const email = require('../email');
const wa = require('../whatsapp');

const DAY = 864e5;
const live = k => k && k.employee && !['cancelled', 'intent'].includes(k.status);
async function casesOf(store, client) { return (await store.list('exit_cases')).map(r => r.data).filter(k => k && k.client === client); }

/* ---------------- approvals ---------------- */
async function approvals(store, client, now = Date.now()) {
  const out = [];
  for (const k of await casesOf(store, client)) {
    if (k.status !== 'open') continue;
    for (const a of k.approvals || []) {
      if (a.status !== 'Pending') continue;
      const asked = a.chain.filter(s => s.status === 'Asked');
      const since = asked.map(s => s.askedAt).filter(Boolean).sort()[0] || '';
      out.push({ caseId: k.id, name: k.employee.name, code: k.employee.code, typeName: k.typeName, lwd: k.lwd, waiverDays: k.waiverDays, approvalId: a.id, action: a.action, mode: a.mode, sla: a.sla, delegate: a.delegate,
        chain: a.chain.map(s => ({ role: s.role, person: s.person, status: s.status, askedAt: s.askedAt || '', escalatedAt: s.escalatedAt || '' })),
        since, overdue: Boolean(since) && now - Date.parse(since) > (+a.sla || 48) * 3600e3, notAsked: !asked.length });
    }
  }
  return out.sort((a, b) => (b.overdue - a.overdue) || String(a.since || '9').localeCompare(String(b.since || '9')));
}

function who(setup, p) {
  const emp = { level: String(p.level || ''), dept: String(p.dept || ''), manager: 'Reporting manager' };
  const rule = R.approvalRule(setup, String(p.action || ''), emp, String(p.typeId || 'Any'), Number(p.amount) || 0);
  return rule ? { rule, chain: R.chainOf(rule).map(s => Object.assign(s, { person: R.personFor(setup, s.role, emp) })) } : { rule: null, chain: [] };
}

/* ---------------- dashboard ---------------- */
const ym = iso => String(iso || '').slice(0, 7);
function monthsBack(today, n) { const out = []; let [y, m] = today.split('-').map(Number); for (let i = 0; i < n; i++) { out.unshift(`${y}-${String(m).padStart(2, '0')}`); m--; if (!m) { m = 12; y--; } } return out; }
const count = (arr, f) => { const o = {}; arr.forEach(x => { const key = f(x) || 'Not given'; o[key] = (o[key] || 0) + 1; }); return Object.entries(o).sort((a, b) => b[1] - a[1]); };
function tenureBand(k) {
  const e = k.employee; if (!e.doj || !k.lwd) return 'Not given';
  const m = R.monthsBetween(e.doj, k.lwd);
  return m < 6 ? 'Under 6 months' : m < 12 ? '6-12 months' : m < 24 ? '1-2 years' : m < 60 ? '2-5 years' : '5 years or more';
}

async function dashboard(store, setup, client, months = 12, now = Date.now()) {
  const today = R.todayIst(now);
  const all = (await casesOf(store, client)).filter(live);
  const span = monthsBack(today.slice(0, 7), months);
  const inSpan = all.filter(k => span.includes(ym(k.lwd)) || (k.status === 'open' && ym(k.lwd) > span[span.length - 1]));
  const open = all.filter(k => k.status === 'open');
  const paidOnTime = all.filter(k => k.fnf && k.fnf.wagesPaidAt).map(k => { const F = require('./fnf'); const c = F.compute(setup, k); return c && k.fnf.wagesPaidAt.slice(0, 10) <= c.wageDue; });
  const ivs = (await store.list('exit_interviews')).map(r => r.data).filter(x => x && x.client === client && span.includes(x.month));
  const th = (setup.interview && setup.interview.threshold) || 5;
  const tiles = {
    open: open.length,
    leaving30: open.filter(k => k.lwd >= today && k.lwd <= R.addDays(today, 30)).length,
    exits: inSpan.length,
    voluntaryPct: inSpan.length ? Math.round(100 * inSpan.filter(k => k.category === 'Voluntary').length / inSpan.length) : 0,
    pendingApprovals: open.reduce((a, k) => a + (k.approvals || []).filter(x => x.status === 'Pending').length, 0),
    red: open.reduce((a, k) => a + (k.alerts || []).filter(x => x.open).length, 0),
    fnfOnTimePct: paidOnTime.length ? Math.round(100 * paidOnTime.filter(Boolean).length / paidOnTime.length) : null,
    waivers: inSpan.filter(k => k.waiverDays > 0).length,
    interviews: ivs.length,
    alumni: (await store.list('exit_alumni')).filter(r => r.data && r.data.client === client).length,
    thinking: (await casesOf(store, client)).filter(k => k.status === 'intent').length
  };
  const reasons = ivs.length >= th ? count(ivs, x => x.answers && x.answers.q2).filter(([r]) => r !== 'Not given') : [];
  const avg = (key) => { const v = ivs.map(x => x.answers && x.answers[key]).filter(n => typeof n === 'number'); return v.length >= th ? Math.round(10 * v.reduce((a, b) => a + b, 0) / v.length) / 10 : null; };
  const enpsVals = ivs.map(x => x.answers && x.answers.q5).filter(n => typeof n === 'number');
  return {
    months: span, tiles,
    perMonth: span.map(mo => [mo, all.filter(k => ym(k.lwd) === mo).length]),
    byDept: count(inSpan, k => k.employee.dept), byType: count(inSpan, k => k.typeName), byTenure: count(inSpan, tenureBand),
    byManager: count(inSpan, k => k.employee.manager).filter(([, n]) => n >= 2).slice(0, 8),
    interviews: { n: ivs.length, threshold: th, reasons, overall: avg('q1'), manager: avg('q3'), enps: enpsVals.length >= th ? Math.round(100 * (enpsVals.filter(n => n >= 9).length - enpsVals.filter(n => n <= 6).length) / enpsVals.length) : null },
    risks: open.filter(k => (k.alerts || []).some(a => a.open) || (k.approvals || []).some(a => a.status === 'Pending' && k.lwd <= R.addDays(today, 7)))
      .map(k => ({ id: k.id, name: k.employee.name, lwd: k.lwd, items: (k.alerts || []).filter(a => a.open).length, pending: (k.approvals || []).filter(a => a.status === 'Pending').map(a => a.action) })).slice(0, 15)
  };
}

/* ---------------- interviews (anonymous) ---------------- */
async function interviews(store, setup, client, groupBy = 'dept') {
  const key = ['dept', 'manager', 'location', 'level', 'category'].includes(groupBy) ? groupBy : 'dept';
  const ivs = (await store.list('exit_interviews')).map(r => r.data).filter(x => x && x.client === client);
  const th = (setup.interview && setup.interview.threshold) || 5;
  const qs = (setup.interview && setup.interview.questions) || [];
  const groups = {};
  ivs.forEach(x => { const g = x[key] || 'Not given'; (groups[g] = groups[g] || []).push(x); });
  const shown = [], hidden = [];
  for (const [g, list] of Object.entries(groups)) {
    if (list.length < th) { hidden.push(list.length); continue; }
    const row = { group: g, n: list.length, answers: {} };
    for (const q of qs) {
      const vals = list.map(x => x.answers && x.answers[q.id]).filter(v => v !== undefined && v !== '');
      if (q.type === 'scale5' || q.type === 'scale10') row.answers[q.id] = vals.length ? Math.round(10 * vals.reduce((a, b) => a + Number(b), 0) / vals.length) / 10 : null;
      else if (q.type === 'choice' || q.type === 'yesno') row.answers[q.id] = count(vals, v => v).slice(0, 3);
      else row.answers[q.id] = vals.length;
    }
    shown.push(row);
  }
  return { groupBy: key, threshold: th, total: ivs.length, questions: qs, groups: shown.sort((a, b) => b.n - a.n), hiddenGroups: hidden.length, hiddenPeople: hidden.reduce((a, b) => a + b, 0) };
}

/* ---------------- alumni ---------------- */
async function alumni(store, client) {
  return (await store.list('exit_alumni')).map(r => r.data).filter(x => x && x.client === client).sort((a, b) => String(b.joinedAt).localeCompare(String(a.joinedAt)));
}

// Job shared with alumni: email to each; WhatsApp only with an approved template (WHATSAPP_ALUMNI_TEMPLATE, body {{1}} first name, {{2}} role).
async function shareJob(store, setup, client, p) {
  const role = String(p.role || '').trim().slice(0, 120), where = String(p.location || '').trim().slice(0, 80), more = String(p.link || '').trim().slice(0, 300);
  if (!role) return { status: 400, body: { error: 'role_required' } };
  const list = await alumni(store, client);
  const co = (setup.contacts && setup.contacts.company) || 'us';
  const tpl = (process.env.WHATSAPP_ALUMNI_TEMPLATE || '').trim();
  let emails = 0, whatsapps = 0;
  for (const a of list) {
    const first = (a.name || '').split(' ')[0] || 'there';
    if (a.email && email.emailConfigured()) {
      try { await email.send({ to: a.email, replyTo: setup.contacts.recruitment || setup.contacts.replyTo, subject: `Opening at ${co}: ${role}`, text: `Hi ${first},\n\nWe have an opening you or someone you know may like: ${role}${where ? ', ' + where : ''}.${more ? '\n\n' + more : ''}\n\nReply to this email if you are interested. You are receiving this as a member of the ${co} alumni network.` }); emails++; } catch { /* next */ }
    }
    if (tpl && a.phone && wa.waConfigured()) {
      try { await wa.sendNamedTemplate(a.phone, tpl, process.env.WHATSAPP_ALUMNI_TEMPLATE_LANG || 'en', [first, role]); whatsapps++; } catch { /* next */ }
    }
  }
  return { status: 200, body: { alumni: list.length, emails, whatsapps, whatsappTemplate: Boolean(tpl) } };
}

module.exports = { approvals, who, dashboard, interviews, alumni, shareJob, tenureBand, DAY };
