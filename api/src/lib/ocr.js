'use strict';
// Turns a Document Intelligence result into checked fields for Aadhaar, PAN and bank proof.
// Pure functions only (no network), so they are fully unit-tested.

/* ---------- validators ---------- */
const VD = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1], [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]];
const VP = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1], [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]];
const VINV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

function verhoeffValid(num) {
  const s = String(num || '');
  if (!/^\d+$/.test(s)) return false;
  let c = 0;
  [...s].reverse().forEach((ch, i) => { c = VD[c][VP[i % 8][+ch]]; });
  return c === 0;
}
function verhoeffDigit(num) {
  let c = 0;
  [...String(num)].reverse().forEach((ch, i) => { c = VD[c][VP[(i + 1) % 8][+ch]]; });
  return VINV[c];
}

// Aadhaar: 12 digits, never starting with 0 or 1, valid Verhoeff checksum.
const validAadhaar = n => /^[2-9]\d{11}$/.test(String(n || '')) && verhoeffValid(n);
// PAN: AAAAA9999A; the 4th letter is P for an individual.
const validPan = p => /^[A-Z]{3}[ABCFGHJLPT][A-Z]\d{4}[A-Z]$/.test(String(p || ''));
const isPersonPan = p => validPan(p) && String(p)[3] === 'P';
// IFSC: 4 letters, 0, then 6 letters/digits.
const validIfsc = s => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(s || ''));

/* ---------- helpers ---------- */
const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
function toIsoDate(s) {
  const t = String(s || '');
  let m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/.exec(t);
  if (m && +m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  m = /\b(\d{1,2})\s*([A-Za-z]{3})[a-z]*\s*(\d{4})\b/.exec(t);
  if (m && MONTHS[m[2].toUpperCase()]) return `${m[3]}-${String(MONTHS[m[2].toUpperCase()]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  return '';
}
function niceDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${+m[3]} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1]} ${m[1]}` : (iso || '');
}
function cleanName(s) {
  return String(s || '').replace(/[^A-Za-z .'-]/g, ' ').replace(/\s+/g, ' ').trim()
    .toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
}
function nameTokens(s) { return cleanName(s).toUpperCase().split(' ').filter(t => t.length > 1); }
// Same person if the shorter name's words all appear in the longer one (initials allowed).
function namesMatch(a, b) {
  const x = nameTokens(a), y = nameTokens(b);
  if (!x.length || !y.length) return null;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.every(t => long.includes(t) || (t.length === 1 && long.some(l => l[0] === t)));
}
function lines(result) {
  const out = [];
  for (const p of (result && result.pages) || []) for (const l of p.lines || []) out.push(String(l.content || '').trim());
  if (!out.length) return String((result && result.content) || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  return out.filter(Boolean);
}
function field(result, ...names) {
  const f = (result && result.documents && result.documents[0] && result.documents[0].fields) || {};
  for (const n of names) {
    const v = f[n];
    if (!v) continue;
    const val = v.valueString || v.valueDate || (v.valueAddress && v.content) || v.content || '';
    if (val) return { value: String(val), confidence: typeof v.confidence === 'number' ? v.confidence : null };
  }
  return { value: '', confidence: null };
}
function avgWordConfidence(result, text) {
  const want = String(text || '').replace(/\s+/g, '');
  if (!want) return null;
  const hits = [];
  for (const p of (result && result.pages) || []) for (const w of p.words || []) {
    const c = String(w.content || '').replace(/\s+/g, '');
    if (c && want.includes(c) && typeof w.confidence === 'number') hits.push(w.confidence);
  }
  return hits.length ? Math.min(...hits) : null;
}

/* ---------- classify ---------- */
function classify(result) {
  const t = String((result && result.content) || '').toUpperCase();
  const digits = t.replace(/[^\dA-Z\s]/g, ' ');
  if (/INCOME\s*TAX|PERMANENT\s*ACCOUNT/.test(t) || /\b[A-Z]{3}P[A-Z]\d{4}[A-Z]\b/.test(t)) return 'pan';
  if (/\bIFSC\b|\b[A-Z]{4}0[A-Z0-9]{6}\b/.test(t) && /BANK|A\/C|ACCOUNT|PAY|CHEQUE|PASSBOOK/.test(t)) return 'bank';
  if (/AADHAAR|UNIQUE\s*IDENTIFICATION|GOVERNMENT\s*OF\s*INDIA|आधार/.test(t) || findAadhaar(digits)) return 'aadhaar';
  return 'other';
}

/* ---------- Aadhaar ---------- */
function findAadhaar(text) {
  const t = String(text || '');
  const re = /(?<!\d)(\d{4})[ -]?(\d{4})[ -]?(\d{4})(?![ -]?\d)/g;
  let m;
  while ((m = re.exec(t))) { const n = m[1] + m[2] + m[3]; if (validAadhaar(n)) return n; }
  return '';
}
function aadhaarFields(result) {
  const text = String((result && result.content) || '');
  const number = findAadhaar(text) || (validAadhaar(field(result, 'DocumentNumber').value.replace(/\D/g, '')) ? field(result, 'DocumentNumber').value.replace(/\D/g, '') : '');
  const ls = lines(result);
  const fn = field(result, 'FirstName'), lnF = field(result, 'LastName'), full = field(result, 'FullName', 'Name');
  let name = cleanName(full.value || [fn.value, lnF.value].filter(Boolean).join(' '));
  let nameConf = full.confidence != null ? full.confidence : fn.confidence;
  const dobF = field(result, 'DateOfBirth');
  let dob = toIsoDate(dobF.value);
  const dobIdx = ls.findIndex(l => /DOB|Date of Birth|Year of Birth|जन्म/i.test(l));
  if (!dob && dobIdx >= 0) dob = toIsoDate(ls[dobIdx]) || ((/(?:Year of Birth|YOB)\D*(\d{4})/i.exec(ls[dobIdx]) || [])[1] || '');
  if (!name && dobIdx > 0) {
    for (let i = dobIdx - 1; i >= 0 && i >= dobIdx - 3; i--) {
      if (/^[A-Za-z][A-Za-z .'-]{2,60}$/.test(ls[i]) && !/government|india|aadhaar|male|female/i.test(ls[i])) { name = cleanName(ls[i]); nameConf = avgWordConfidence(result, ls[i]); break; }
    }
  }
  const sexF = field(result, 'Sex');
  const gm = /\b(MALE|FEMALE|TRANSGENDER)\b/i.exec(sexF.value || text);
  const gender = gm ? gm[1][0].toUpperCase() + gm[1].slice(1).toLowerCase() : (/^[MF]$/i.test(sexF.value) ? (/^M$/i.test(sexF.value) ? 'Male' : 'Female') : '');
  const address = cleanAddress(field(result, 'Address').value || addressAfter(ls, /^Address\s*:?/i));
  const checks = [
    { key: 'number', label: 'Aadhaar number found and checksum valid', ok: Boolean(number) },
    { key: 'name', label: 'Name read', ok: Boolean(name) },
    { key: 'dob', label: 'Date of birth read', ok: Boolean(dob) }
  ];
  return {
    fields: { name, dob, gender, aadhaarLast4: number ? number.slice(-4) : '', address },
    secret: { number },
    confidence: { name: nameConf, dob: dobF.confidence != null ? dobF.confidence : avgWordConfidence(result, dob), number: avgWordConfidence(result, number) },
    checks
  };
}
function addressAfter(ls, re) {
  const i = ls.findIndex(l => re.test(l));
  if (i < 0) return '';
  const first = ls[i].replace(re, '').trim();
  return [first, ...ls.slice(i + 1, i + 5)].filter(Boolean).join(', ');
}
function cleanAddress(s) {
  return String(s || '').replace(/\s*\n\s*/g, ', ').replace(/\b\d{4}\s?\d{4}\s?\d{4}\b/g, '').replace(/\s+/g, ' ').replace(/(,\s*)+/g, ', ').replace(/^[,\s]+|[,\s]+$/g, '').slice(0, 300);
}

/* ---------- PAN ---------- */
function panFields(result) {
  const text = String((result && result.content) || '').toUpperCase();
  const pm = /\b([A-Z]{3}[ABCFGHJLPT][A-Z]\d{4}[A-Z])\b/.exec(text);
  const pan = pm ? pm[1] : (validPan(field(result, 'DocumentNumber').value.toUpperCase()) ? field(result, 'DocumentNumber').value.toUpperCase() : '');
  const ls = lines(result);
  const after = re => { const i = ls.findIndex(l => re.test(l)); return i >= 0 && ls[i + 1] ? ls[i + 1] : ''; };
  const fn = field(result, 'FirstName'), lnF = field(result, 'LastName'), full = field(result, 'FullName', 'Name');
  let name = cleanName(full.value || [fn.value, lnF.value].filter(Boolean).join(' '));
  if (!name) name = cleanName(after(/(^|\/)\s*name\s*$/i));
  const fatherF = field(result, 'FathersName', 'FatherName', 'ParentName');
  const father = cleanName(fatherF.value || after(/father/i));
  const dobF = field(result, 'DateOfBirth');
  const dob = toIsoDate(dobF.value) || toIsoDate(after(/date of birth|जन्म/i)) || toIsoDate(text);
  return {
    fields: { pan, name, father, dob },
    secret: {},
    confidence: { pan: avgWordConfidence(result, pan), name: full.confidence != null ? full.confidence : fn.confidence, dob: dobF.confidence },
    checks: [
      { key: 'pan', label: 'PAN format valid', ok: validPan(pan) },
      { key: 'person', label: 'PAN belongs to an individual (4th letter P)', ok: isPersonPan(pan) },
      { key: 'name', label: 'Name read', ok: Boolean(name) }
    ]
  };
}

/* ---------- Bank proof ---------- */
function bankFields(result) {
  const text = String((result && result.content) || '');
  const up = text.toUpperCase();
  const im = /\b([A-Z]{4}0[A-Z0-9]{6})\b/.exec(up.replace(/IFSC\s*(CODE)?\s*[:.-]?\s*/g, 'IFSC '));
  const ifsc = im ? im[1] : '';
  const ls = lines(result);
  let account = '';
  for (const l of ls) {
    const m = /(?:A\/?C|ACCOUNT|SB|CA)\s*(?:NO|NUMBER|NUM)?\.?\s*[:.-]?\s*(\d[\d ]{7,20}\d)/i.exec(l);
    if (m) { account = m[1].replace(/\s/g, ''); if (account.length >= 9 && account.length <= 18) break; account = ''; }
  }
  if (!account) {
    const runs = (text.match(/(?<![\d])\d{11,18}(?![\d])/g) || []).filter(r => !validAadhaar(r));
    account = runs.sort((a, b) => b.length - a.length)[0] || '';
  }
  let holder = '';
  for (const l of ls) {
    const m = /^(?:A\/?C\s*HOLDER(?:'?S)?\s*NAME|ACCOUNT\s*HOLDER(?:'?S)?\s*NAME|CUSTOMER\s*NAME|NAME)\s*[:.-]?\s*(.+)$/i.exec(l);
    if (m && /[A-Za-z]{3}/.test(m[1])) { holder = cleanName(m[1]); break; }
  }
  const bm = /([A-Z][A-Za-z&.]*(?:\s+[A-Z][A-Za-z&.]*){0,4}\s+BANK(?:\s+(?:LTD|LIMITED))?)/i.exec(text);
  const bank = bm ? bm[1].replace(/\s+/g, ' ').trim() : '';
  return {
    fields: { holder, accountLast4: account ? account.slice(-4) : '', ifsc, bank },
    secret: { account },
    confidence: { ifsc: avgWordConfidence(result, ifsc), account: avgWordConfidence(result, account) },
    checks: [
      { key: 'ifsc', label: 'IFSC format valid', ok: validIfsc(ifsc) },
      { key: 'account', label: 'Account number read', ok: Boolean(account) },
      { key: 'holder', label: 'Account holder name read', ok: Boolean(holder) }
    ]
  };
}

function extract(type, result) {
  if (type === 'aadhaar') return aadhaarFields(result);
  if (type === 'pan') return panFields(result);
  if (type === 'bank') return bankFields(result);
  return { fields: {}, secret: {}, confidence: {}, checks: [] };
}

// Cross-document checks against what the candidate already confirmed.
function crossChecks(type, fields, kyc) {
  const out = [];
  const k = kyc || {};
  const nm = type === 'bank' ? fields.holder : fields.name;
  if (nm && k.name) { const ok = namesMatch(nm, k.name); if (ok !== null) out.push({ key: 'nameMatch', label: `Name matches ${k.nameFrom || 'earlier document'} (${k.name})`, ok }); }
  if (type !== 'bank' && fields.dob && k.dob) out.push({ key: 'dobMatch', label: `Date of birth matches ${k.dobFrom || 'earlier document'}`, ok: fields.dob === k.dob });
  return out;
}

const LOW = 0.8;
function lowConfidence(conf) {
  return Object.entries(conf || {}).filter(([, v]) => typeof v === 'number' && v < LOW).map(([k]) => k);
}

/* ---------- masking regions ---------- */
// Word boxes that show the first 8 digits of the Aadhaar number, and any QR codes.
function maskRegions(result, number) {
  const regions = [];
  const first8 = String(number || '').slice(0, 8);
  const groups = first8 ? [first8.slice(0, 4), first8.slice(4, 8)] : [];
  for (const p of (result && result.pages) || []) {
    const page = { pageNumber: p.pageNumber || 1, width: p.width, height: p.height, unit: p.unit || 'pixel' };
    for (const w of p.words || []) {
      const d = String(w.content || '').replace(/\D/g, '');
      if (!d || !w.polygon) continue;
      if (groups.includes(d) || (first8 && d.length >= 8 && d.startsWith(first8)) || (d.length === 12 && validAadhaar(d))) regions.push(Object.assign({ polygon: w.polygon, kind: 'digits' }, page));
    }
    for (const b of p.barcodes || []) if (b.polygon) regions.push(Object.assign({ polygon: b.polygon, kind: 'qr' }, page));
  }
  return regions;
}

/* ---------- WhatsApp summary ---------- */
const LABELS = {
  aadhaar: { name: 'Name', dob: 'Date of birth', gender: 'Gender', aadhaarLast4: 'Aadhaar', address: 'Address' },
  pan: { pan: 'PAN', name: 'Name', father: "Father's name", dob: 'Date of birth' },
  bank: { holder: 'Account holder', accountLast4: 'Account number', ifsc: 'IFSC', bank: 'Bank' }
};
function summaryText(type, fields) {
  const L = LABELS[type] || {};
  const shown = [], missing = [];
  for (const [k, label] of Object.entries(L)) {
    let v = fields[k];
    if (k === 'aadhaarLast4' || k === 'accountLast4') v = v ? 'ending ' + v : '';
    if (k === 'dob') v = niceDate(v);
    if (v) shown.push(`${label}: ${v}`); else if (k !== 'address' && k !== 'bank' && k !== 'father') missing.push(label.toLowerCase());
  }
  return { shown, missing };
}

module.exports = {
  verhoeffValid, verhoeffDigit, validAadhaar, validPan, isPersonPan, validIfsc, toIsoDate, niceDate, cleanName, namesMatch,
  classify, findAadhaar, aadhaarFields, panFields, bankFields, extract, crossChecks, lowConfidence, maskRegions, summaryText, LOW
};
