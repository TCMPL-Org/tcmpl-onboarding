'use strict';
// Full and final settlement and exit letters.
// HR enters the pay facts on the case (monthly gross, basic, leave balance, loans, other recoveries, PT, TDS);
// everything else is worked out from the case and the client's F&F rules in Exit setup. Figures are indicative
// and are approved by payroll before anything is paid.

const R = require('./rules');
const pdf = require('./pdf');

const DAY = 864e5;
const num = (v, max = 1e9) => { const n = Number(String(v == null ? '' : v).replace(/[,₹\s]/g, '')); return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0; };
const r0 = n => Math.round(n);
const inr = n => (n < 0 ? '-' : '') + 'Rs. ' + Math.round(Math.abs(n)).toLocaleString('en-IN');
const toUtc = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
const NO_RECOVERY = ['death', 'medical', 'retire', 'retrench', 'fte_end', 'performance'];

function cleanInputs(p) {
  p = p && typeof p === 'object' ? p : {};
  return {
    gross: num(p.gross), basic: num(p.basic), leaveDays: num(p.leaveDays, 500), loans: num(p.loans), other: num(p.other), otherNote: String(p.otherNote || '').slice(0, 200),
    pt: num(p.pt, 5000), tds: num(p.tds), extra: num(p.extra), extraNote: String(p.extraNote || '').slice(0, 200), gratForfeit: p.gratForfeit === true
  };
}

// Working days after the last day (Sundays skipped), for the wages deadline.
function addWorkingDays(iso, n) {
  let t = toUtc(iso), left = n;
  while (left > 0) { t += DAY; if (new Date(t).getUTCDay() !== 0) left--; }
  return new Date(t).toISOString().slice(0, 10);
}

function compute(setup, k) {
  const f = Object.assign({ wageDays: 2, gratYears: 5, fteGratYears: 1, gratDays: 30, encash: 'basic26', recovery: 'basic', gratCap: 2000000 }, setup.fnf);
  const p = cleanInputs(k.fnf && k.fnf.inputs);
  const lwd = k.lwd, e = k.employee || {};
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(lwd || '');
  if (!m) return null;
  const mDays = new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate(), dWorked = +m[3];
  const salary = p.gross * dWorked / mDays, basicPart = p.basic * dWorked / mDays;
  const encash = p.leaveDays * (f.encash === 'gross30' ? p.gross / 30 : p.basic / 26);
  const fyStart = `${+m[2] >= 4 ? +m[1] : +m[1] - 1}-04-01`;
  const fyMonths = Math.max(1, R.monthsBetween(fyStart, lwd) + 1);
  const bonus = p.basic > 0 && p.basic <= 21000 ? 0.0833 * Math.min(p.basic, 7000) * fyMonths : 0;
  const yrsExact = e.doj ? (toUtc(lwd) - toUtc(e.doj)) / (365.25 * DAY) : 0;
  const yrs = Math.floor(yrsExact) + ((yrsExact % 1) * 12 > 6 ? 1 : 0);
  const gMin = ['death', 'medical'].includes(k.typeId) ? 0 : k.typeId === 'fte_end' ? f.fteGratYears : f.gratYears;
  // Continuous service: the minimum years, or one year less plus 240 days (e.g. 4 years 240 days for 5).
  const whole = Math.floor(yrsExact), extraDays = (yrsExact - whole) * 365.25;
  const gratElig = Boolean(e.doj) && (whole >= gMin || (gMin > 0 && whole === gMin - 1 && extraDays >= 240)) && !(k.typeId === 'misconduct' && p.gratForfeit);
  const gratuity = gratElig ? Math.min(f.gratCap, 15 / 26 * p.basic * yrs) : 0;

  // Notice: days served from the notice start to the last day; an approved waiver is not recovered.
  const req = +k.noticeDays || 0;
  const served = k.noticeStart ? Math.max(0, Math.round((toUtc(lwd) - toUtc(k.noticeStart)) / DAY)) : req;
  const waiverOk = (k.approvals || []).some(a => a.action === 'Notice waiver' && a.status === 'Approved');
  const shortfall = NO_RECOVERY.includes(k.typeId) ? 0 : Math.max(0, req - served - (waiverOk ? +k.waiverDays || 0 : 0));
  const noticeRec = shortfall * (f.recovery === 'gross' ? p.gross / 30 : p.basic / 30);

  const pf = 0.12 * basicPart, esic = p.gross > 0 && p.gross <= 21000 ? 0.0075 * salary : 0;
  const earn = [['Salary for ' + dWorked + ' of ' + mDays + ' days', salary], ['Leave encashment (' + p.leaveDays + ' days)', encash], ['Statutory bonus (indicative)', bonus]];
  if (p.extra) earn.push([p.extraNote || 'Other earnings', p.extra]);
  const ded = [['Provident Fund (employee, 12% of basic)', pf], ['ESIC (employee)', esic], ['Professional tax', p.pt], ['Income tax (TDS)', p.tds]];
  if (noticeRec) ded.push([`Notice shortfall recovery (${shortfall} days)`, noticeRec]);
  if (p.loans) ded.push(['Loans and advances', p.loans]);
  if (p.other) ded.push([p.otherNote || 'Other recoveries', p.other]);
  const earnT = earn.reduce((a, x) => a + x[1], 0), dedT = ded.reduce((a, x) => a + x[1], 0);
  const wagesNet = earnT - dedT;
  const wageDue = addWorkingDays(lwd, f.wageDays);
  const gratDue = R.addDays(lwd, f.gratDays);
  return {
    inputs: p, earn: earn.filter(x => x[1]).map(([l, v]) => [l, r0(v)]), ded: ded.filter(x => x[1]).map(([l, v]) => [l, r0(v)]),
    earnTotal: r0(earnT), dedTotal: r0(dedT), wagesNet: r0(wagesNet), gratuity: r0(gratuity), gratElig, yrs, yrsExact: Math.round(yrsExact * 10) / 10,
    net: r0(wagesNet + gratuity), shortfall, served, wageDue, gratDue, missing: [!p.gross && 'monthly gross', !p.basic && 'monthly basic', !e.doj && 'date of joining'].filter(Boolean)
  };
}

/* ---------------- PDFs ---------------- */
const company = (setup, k) => (setup.contacts && setup.contacts.company) || k.clientLabel || 'The Company';

function statementPdf(setup, k) {
  const r = compute(setup, k);
  if (!r) return null;
  const e = k.employee;
  const rows = [['Item', 'Amount', 'Note']];
  r.earn.forEach(([l, v]) => rows.push([l, inr(v), `Pay by ${R.niceDate(r.wageDue)}`]));
  rows.push(['Total earnings', inr(r.earnTotal), '']);
  r.ded.forEach(([l, v]) => rows.push(['Less: ' + l, '-' + inr(v), 'Adjusted against wages']));
  rows.push(['Wages part (net)', inr(r.wagesNet), r.wagesNet < 0 ? 'Employee to pay the company' : `Within ${setup.fnf.wageDays} working days`]);
  if (r.gratuity) rows.push([`Gratuity (${r.yrs} years)`, inr(r.gratuity), `Within ${setup.fnf.gratDays} days (by ${R.niceDate(r.gratDue)})`]);
  rows.push(['Net payable', inr(r.net), '']);
  const bold = [rows.findIndex(x => x[0] === 'Total earnings'), rows.findIndex(x => x[0] === 'Wages part (net)'), rows.length - 1];
  return pdf.build(`Full and final settlement: ${e.name}`, [
    { t: 'p', text: `${company(setup, k)} - Employee code ${e.code || '-'} - ${[e.designation, e.dept].filter(Boolean).join(', ')}` },
    { t: 'p', text: `Separation: ${k.typeName}. Formal date ${R.niceDate(k.formal)}. Last working day ${R.niceDate(k.lwd)}. Date of joining ${R.niceDate(e.doj) || '-'} (${r.yrsExact} years).` },
    { t: 'table', rows, widths: [0.5, 0.2, 0.3], align: [null, 'right', null], boldRows: bold },
    ...(r.shortfall ? [{ t: 'p', text: `Notice: ${k.noticeDays} days required, ${r.served} served; ${r.shortfall} days recovered.` }] : []),
    { t: 'p', text: `Status: ${(k.fnf && k.fnf.status) || 'Draft'}.` }
  ], 'Indicative statement prepared by the TCMPL AI Exit Agent for payroll approval. Tax and statutory figures are confirmed by payroll before payment.');
}

function letterParas(setup, k, name) {
  const e = k.employee, co = company(setup, k), first = (e.name || '').split(' ')[0], d = R.niceDate(k.lwd), years = e.doj ? Math.floor((toUtc(k.lwd) - toUtc(e.doj)) / (365.25 * DAY)) : 0;
  const n = name.toLowerCase();
  if (/resignation acceptance|acceptance letter/.test(n)) return [`We acknowledge your resignation dated ${R.niceDate(k.formal)}. Your resignation has been accepted, and your last working day with ${co} will be ${d}.`, 'Please complete your handover and return company assets as listed in your exit checklist. Your full and final settlement will be processed as per law and company policy.'];
  if (/relieving/.test(n)) return [`This is to confirm that you have been relieved from the services of ${co} at the close of business on ${d}, after completing the exit formalities.`, 'We thank you for your contribution and wish you the very best.'];
  if (/experience/.test(n)) return [`This is to certify that ${e.name} worked with ${co} from ${R.niceDate(e.doj) || '-'} to ${d}.${e.designation ? ` At the time of leaving, ${first} held the position of ${e.designation}${e.dept ? ` in the ${e.dept} department` : ''}.` : ''}`, `We wish ${first} every success in the future.`];
  if (/service certificate/.test(n)) return [`This is to certify that ${e.name} served ${co} from ${R.niceDate(e.doj) || '-'} to ${d}${e.designation ? ` as ${e.designation}` : ''}.`];
  if (/retirement/.test(n)) return [`On your retirement on ${d}, ${co} thanks you for ${years} years of dedicated service. Your retirement benefits will be settled as per law and company policy.`];
  if (/completion/.test(n)) return [`Your fixed-term engagement with ${co} is complete on ${d}. Thank you for your work during this period.`, 'Your full and final settlement will be processed as per law and company policy.'];
  return [`${name} for ${e.name} (${e.code || '-'}). Separation type: ${k.typeName}. Last working day: ${d}.`, 'Draft prepared by the AI exit agent for HR review; HR completes the wording before it is issued.'];
}

function letterPdf(setup, k, name) {
  if (/f&f statement/i.test(name)) return statementPdf(setup, k);
  const e = k.employee;
  return pdf.build(name, [
    { t: 'p', text: company(setup, k) }, { t: 'p', text: `Date: ${R.niceDate(R.todayIst())}` }, { t: 'p', text: `${e.name}${e.code ? ', Employee code ' + e.code : ''}` }, { t: 'gap' },
    { t: 'p', text: `Dear ${(e.name || '').split(' ')[0] || 'colleague'},` },
    ...letterParas(setup, k, name).map(text => ({ t: 'p', text })), { t: 'gap' },
    { t: 'p', text: `For ${company(setup, k)}` }, { t: 'p', text: 'Authorised signatory' }
  ], 'Generated by the TCMPL AI Exit Agent.');
}

const lettersOf = (setup, k) => { const t = R.typeOf(setup, k.typeId); return String((t && t.letters) || '').split(';').map(s => s.trim()).filter(Boolean); };
const fileName = (name, k) => `${name.replace(/[^\w]+/g, '_')}_${(k.employee.name || 'employee').replace(/[^\w]+/g, '_')}.pdf`.replace(/_+/g, '_');

// Which letters go with which step.
function lettersForStep(setup, k, key) {
  const all = lettersOf(setup, k);
  if (key === 'accepted') return all.filter(n => /acceptance/i.test(n));
  if (key === 'lastday') return all.filter(n => /relieving|experience|service certificate|retirement|completion/i.test(n));
  if (key === 'fnf-paid' || key === 'fnf-draft') return all.filter(n => /f&f statement/i.test(n)).slice(0, 1).concat(all.some(n => /f&f statement/i.test(n)) ? [] : ['F&F statement']);
  return [];
}

function attachment(setup, k, name) {
  const buf = letterPdf(setup, k, name);
  return buf ? { name: fileName(name, k), contentType: 'application/pdf', base64: buf.toString('base64'), buffer: buf, letter: name } : null;
}

module.exports = { compute, cleanInputs, statementPdf, letterPdf, lettersOf, lettersForStep, attachment, fileName, addWorkingDays, inr };
