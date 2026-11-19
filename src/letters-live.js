// Word offer letters: the client's own .docx template (HROne-style «MERGEFIELDS»), filled by the server.
//  - Offer letters (own section): admins upload a template, choose where each placeholder comes from,
//    which salary components go into each salary table, pictures (logo, signature) and signatories.
//  - Offer desk: a Word template appears first in "Offer letter template"; its preview is the real Word layout,
//    HR fills the per-offer details, and "Approve and hand to agent" makes the signed letter (PDF through
//    Microsoft 365 when connected) and sends it. Nothing goes out while a placeholder is empty.
// Server: /api/letters/* (api/src/lib/letters.js). Lists: /api/data/lettertpl and /api/data/signatories.

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const toast = m => (window.tcmplWAUtil && window.tcmplWAUtil.toast ? window.tcmplWAUtil.toast(m) : console.log(m));
const isAdmin = () => Boolean(window.tcmplAccess && window.tcmplAccess.role === 'admin');
const clientId = () => (window.tcmplClientId ? window.tcmplClientId() : (($('#clientSel') && $('#clientSel').value) || 'default'));
const clientLabel = () => (window.tcmplClientLabel ? window.tcmplClientLabel() : clientId());
const money = n => Math.round(Number(n) || 0).toLocaleString('en-IN');

async function api(action, body) {
  try {
    const r = await fetch('/api/letters/' + action, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
    return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) };
  } catch { return { ok: false, status: 0, body: {} }; }
}
async function list(col) {
  try {
    const r = await fetch('/api/data/' + col, { credentials: 'same-origin', headers: { accept: 'application/json' } });
    const b = await r.json().catch(() => null);
    return r.ok && b && Array.isArray(b.items) ? b.items : [];
  } catch { return []; }
}
const fileB64 = f => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = rej; fr.readAsDataURL(f); });
const b64Blob = (b64, type) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type }); };
function saveAs(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/* ---------- where values come from ---------- */
const SOURCES = [
  ['Candidate', [['cand.name', 'Full name'], ['cand.first', 'First name'], ['cand.role', 'Designation'], ['cand.dept', 'Department'], ['cand.grade', 'Grade'], ['cand.doj', 'Joining date'], ['cand.dob', 'Date of birth'], ['cand.mgr', 'Reporting manager'], ['cand.email', 'Email'], ['cand.mobile', 'Mobile'], ['cand.state', 'Work state'], ['cand.city', 'Work city']]],
  ['Offer and salary', [['offer.date', 'Letter date (day it is made)'], ['offer.ctc', 'Annual CTC'], ['offer.ctcMonthly', 'Monthly CTC'], ['offer.ctcWords', 'Annual CTC in words'], ['offer.gross', 'Annual gross'], ['offer.grossMonthly', 'Monthly gross'], ['offer.takeHome', 'Monthly take-home']]],
  ['Client setup', [['client.company', 'Company name'], ['client.short', 'Short company name'], ['client.address', 'Company address (full)'], ['client.street', 'Company address (without city, state, PIN)'], ['client.city', 'Company city'], ['client.state', 'Company state'], ['client.pincode', 'Company PIN code'], ['client.location', 'Place of posting'], ['client.probation', 'Probation period'], ['client.noticeProbation', 'Notice during probation'], ['client.noticeConfirmed', 'Notice after confirmation'], ['client.workWeek', 'Work week'], ['client.holidays', 'Holidays a year'], ['client.retirementAge', 'Retirement age'], ['client.jurisdiction', 'Courts with jurisdiction']]],
  ['Signatory', [['sig.name', 'Signatory name'], ['sig.designation', 'Signatory designation']]],
  ['Other', [['fixed', 'Same text on every letter (type it here)'], ['ask', 'HR types it on each offer'], ['blank', 'Leave empty']]]
];
const CLIENT_KEY = { company: 'company', short: 'short', address: 'companyAddress', location: 'location', probation: 'probation', noticeProbation: 'noticeProbation', noticeConfirmed: 'noticeConfirmed', workWeek: 'workWeek', holidays: 'holidays', retirementAge: 'retirementAge', jurisdiction: 'jurisdiction' };

// HROne and common placeholder names -> source (first match wins; signatory before designation).
const AUTO = [
  [/SIGNATORY.*(DESIG|TITLE)/, 'sig.designation'], [/SIGNATORY/, 'sig.name'],
  [/^(CANDIDATE|EMPLOYEE)_?NAME$|^NAME$|^FULL_NAME$/, 'cand.name'], [/FIRST_?NAME/, 'cand.first'],
  [/^(CANDIDATE_|EMPLOYEE_)?DESIGNATION$|^ROLE$|^POSITION$/, 'cand.role'], [/DEPARTMENT|^DEPT$/, 'cand.dept'], [/^(JOB_)?GRADE$|^BAND$|^LEVEL$/, 'cand.grade'],
  [/JOINING_DATE|DATE_OF_JOINING|^DOJ$|JOIN_DATE/, 'cand.doj'], [/BIRTH|^DOB$/, 'cand.dob'], [/REPORTING_MANAGER|^MANAGER(_NAME)?$|REPORTING_TO/, 'cand.mgr'],
  [/^(CANDIDATE_|PERSONAL_)?E_?MAIL$/, 'cand.email'], [/^(CANDIDATE_)?(MOBILE|PHONE)/, 'cand.mobile'],
  [/^(CURRENT|LETTER|OFFER|ISSUE)_DATE$|^TODAY$|^DATE$/, 'offer.date'], [/CTC.*WORDS/, 'offer.ctcWords'], [/MONTHLY_CTC|CTC_MONTHLY/, 'offer.ctcMonthly'],
  [/^(ANNUAL_|TOTAL_|YEARLY_)?CTC$/, 'offer.ctc'], [/MONTHLY_GROSS|GROSS_MONTHLY/, 'offer.grossMonthly'], [/^(ANNUAL_)?GROSS(_SALARY)?$/, 'offer.gross'], [/TAKE_?HOME|NET_SALARY/, 'offer.takeHome'],
  [/^COMPANY(_NAME)?$|^ORGANI[SZ]ATION(_NAME)?$|^EMPLOYER(_NAME)?$/, 'client.company'], [/^COMPANY_SHORT/, 'client.short'],
  [/^COMPANY_CITY$/, 'client.city'], [/^COMPANY_STATE$/, 'client.state'], [/^COMPANY_(PIN|PINCODE|PIN_CODE|ZIP)$/, 'client.pincode'], [/COMPANY_ADDRESS|REGISTERED_ADDRESS|REGD_/, 'client.address'],
  [/^BRANCH|PLACE_OF_POSTING|WORK_LOCATION|^LOCATION$/, 'client.location'], [/NOTICE.*PROBATION/, 'client.noticeProbation'], [/NOTICE.*CONFIRM|^NOTICE_PERIOD$/, 'client.noticeConfirmed'],
  [/CONFIRMATION_PERIOD|PROBATION/, 'client.probation'], [/RETIRE/, 'client.retirementAge'], [/JURISDICTION|COURT/, 'client.jurisdiction'], [/WORK_?WEEK/, 'client.workWeek'], [/HOLIDAY/, 'client.holidays'], [/^CANDIDATE_|^EMPLOYEE_/, 'ask'], [/^COMPANY_/, 'fixed']
];
const pretty = n => String(n).replace(/^Image:/i, '').toLowerCase().replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
// names: every placeholder in the template. When the letter also has COMPANY_CITY / STATE / PIN, its address
// placeholder gets only the street part, so the address is not printed twice (HROne footers do this).
function autoMap(name, names) {
  const hit = AUTO.find(([re]) => re.test(name));
  let src = hit ? hit[1] : 'ask';
  if (src === 'client.address' && (names || []).some(n => /^COMPANY_(CITY|STATE|PIN)/.test(n))) src = 'client.street';
  return { src, value: '', label: src === 'ask' ? pretty(name) : '' };
}

/* ---------- salary tables ---------- */
const COMPONENTS = [['BASIC', 'Basic'], ['DA', 'Dearness allowance'], ['HRA', 'House rent allowance'], ['FIXED', 'Other fixed heads'], ['OTHER', 'Other allowance'], ['RETAINER', 'Retainer / consulting fee'], ['EARNINGS', 'Other earnings (salary structure)'],
  ['GROSS', 'Gross salary'], ['ERPF', 'Employer PF'], ['ERESIC', 'Employer ESIC'], ['NPS', 'Employer NPS'], ['GRATUITY', 'Gratuity'], ['BONUS', 'Statutory bonus'], ['INCENT', 'Incentive (target)'], ['VARIABLE', 'Target variable pay'],
  ['CTC', 'Cost to company'], ['EEPF', 'Employee PF'], ['EEESIC', 'Employee ESIC'], ['TAKEHOME', 'Net take-home']];
const NATURE = { ERPF: 'Statutory', ERESIC: 'Statutory', NPS: 'Retiral', GRATUITY: 'Statutory', BONUS: 'Statutory', INCENT: 'Variable', VARIABLE: 'Variable', EEPF: 'Deduction', EEESIC: 'Deduction' };
function defaultTable(name, fields) {
  const cols = {};
  for (const f of fields) cols[f] = /YEARLY|ANNUAL/i.test(f) ? 'yearly' : /NATURE|TYPE/i.test(f) ? 'nature' : /AMOUNT|MONTHLY|VALUE/i.test(f) ? 'monthly' : /NAME|COMPONENT|HEAD/i.test(f) ? 'name' : 'blank';
  const keys = /gross|earn|fixed|salary/i.test(name) ? ['BASIC', 'DA', 'HRA', 'FIXED', 'OTHER', 'RETAINER', 'EARNINGS']
    : /retir|contrib|statut|employer/i.test(name) ? ['ERPF', 'ERESIC', 'NPS', 'GRATUITY']
      : /recurr|variab|incent/i.test(name) ? ['INCENT', 'VARIABLE'] : /other|benefit/i.test(name) ? ['BONUS'] : [];
  return { cols, items: keys.map(key => ({ key, nature: NATURE[key] || 'Fixed', label: '' })) };
}

/* ---------- values for one offer ---------- */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function fmtDate(v, fmt) {
  const d = v instanceof Date ? v : new Date(String(v || '') + (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? 'T00:00:00' : ''));
  if (!Number.isFinite(d.getTime())) return String(v || '');
  const dd = String(d.getDate()).padStart(2, '0'), mm = String(d.getMonth() + 1).padStart(2, '0'), y = d.getFullYear(), M = MONTHS[d.getMonth()];
  return ({ 'dd/MM/yyyy': `${dd}/${mm}/${y}`, 'dd-MMM-yyyy': `${dd}-${M.slice(0, 3)}-${y}`, 'dd.MM.yyyy': `${dd}.${mm}.${y}`, 'MMMM d, yyyy': `${M} ${d.getDate()}, ${y}` })[fmt] || `${d.getDate()} ${M} ${y}`;
}
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = n => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : ''));
const three = n => (n >= 100 ? ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + two(n % 100) : '') : two(n));
// "Nine Lakh Fifty Nine Thousand Nine Hundred Eighty Eight Only" (letters say "Rupees «CTC_IN_WORDS»" themselves).
function inWords(n) {
  n = Math.round(Math.abs(Number(n) || 0));
  if (!n) return 'Zero Only';
  const parts = [], cr = Math.floor(n / 1e7), lk = Math.floor(n / 1e5) % 100, th = Math.floor(n / 1e3) % 100, rest = n % 1000;
  if (cr) parts.push((cr >= 1000 ? inWords(cr).replace(/ Only$/, '') : three(cr)) + ' Crore');
  if (lk) parts.push(two(lk) + ' Lakh');
  if (th) parts.push(two(th) + ' Thousand');
  if (rest) parts.push(three(rest));
  return parts.join(' ') + ' Only';
}

window.tcmplInWords = inWords;

let tpls = [], sigs = [], status = { pdf: false, service: '', storage: false, admin: false }, loaded = false;
const asks = {}; // template id -> { FIELD: value } typed on the Offer desk
const tplById = id => tpls.find(t => t.id === id);
const scanOf = t => { const d = t && t.data; const v = d && (d.versions || []).find(x => x.v === d.current); return (v && v.scan) || { fields: [], regions: [], images: [] }; };
const mapOf = t => { const m = Object.assign({}, (t.data && t.data.map) || {}); const names = scanOf(t).fields.map(f => f.name); for (const n of names) if (!m[n]) m[n] = autoMap(n, names); return m; };
const tablesOf = t => { const out = {}; for (const r of scanOf(t).regions) out[r.name] = (t.data.tables || {})[r.name] || defaultTable(r.name, r.fields); return out; };
const imagesOf = t => { const out = {}; for (const k of scanOf(t).images) out[k] = (t.data.images || {})[k] || { src: /SIGN/i.test(k) ? 'signature' : 'blank' }; return out; };
const sigsFor = cid => sigs.filter(s => s.data.client === '*' || s.data.client === cid);
const usesSignature = t => Object.values(imagesOf(t)).some(m => m.src === 'signature') || Object.values(mapOf(t)).some(m => /^sig\./.test(m.src));

// "Tower B, Sector 44, Gurugram, Haryana 122003" -> street, city, state, PIN (from Client setup → Offer letter details).
const STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Delhi', 'NCT of Delhi', 'Jammu and Kashmir', 'Ladakh', 'Puducherry', 'Chandigarh', 'Andaman and Nicobar Islands', 'Dadra and Nagar Haveli and Daman and Diu', 'Lakshadweep'];
function addressParts(a, fallbackCity) {
  const s = String(a || '').trim();
  const pin = (s.match(/\b\d{3}\s?\d{3}\b/) || [''])[0].replace(/\s/, '');
  const state = STATES.slice().sort((x, y) => y.length - x.length).find(st => new RegExp('\\b' + st.replace(/ /g, '\\s+') + '\\b', 'i').test(s)) || '';
  let rest = s.replace(/\b\d{3}\s?\d{3}\b/, '');
  if (state) rest = rest.replace(new RegExp('\\b' + state.replace(/ /g, '\\s+') + '\\b', 'i'), '');
  const parts = rest.split(',').map(x => x.trim()).filter(Boolean);
  const city = parts.length > 1 ? parts.pop() : (fallbackCity || '');
  return { street: parts.join(', '), city: city || fallbackCity || '', state, pin };
}

function valuesFor(t, data, sig) {
  const m = mapOf(t), fmt = t.data.dateFmt || 'd MMMM yyyy', fields = {};
  const c = data.c, cv = data.cv;
  const addr = addressParts(cv('companyAddress'), cv('location'));
  // Without a signatory record, the signatory text in Client setup ("Priya Malhotra, HR Business Partner") is used.
  const sigText = String(cv('signatory') || '');
  const signer = sig || { name: sigText.split(',')[0].trim(), designation: sigText.split(',').slice(1).join(',').trim() };
  for (const f of scanOf(t).fields) {
    const x = m[f.name] || autoMap(f.name);
    const [grp, key] = x.src.split('.');
    let v;
    if (grp === 'cand') v = key === 'doj' || key === 'dob' ? (c[key] ? fmtDate(c[key], fmt) : '') : c[key];
    else if (grp === 'offer') v = { date: fmtDate(new Date(), fmt), ctc: money(data.ctc), ctcMonthly: money(data.ctc / 12), ctcWords: inWords(data.ctc), gross: money(data.gross), grossMonthly: money(data.gross / 12), takeHome: money(data.takeHome) }[key];
    else if (grp === 'client') v = key === 'location' ? (cv('location') || c.city || c.state) : key === 'street' ? addr.street : key === 'city' ? addr.city : key === 'state' ? addr.state : key === 'pincode' ? addr.pin : cv(CLIENT_KEY[key] || key);
    else if (grp === 'custom') { const it = (data.customLetter || []).find(z => z.slug === key); v = it ? it.value : ''; }
    else if (grp === 'sig') v = key === 'name' ? signer.name : signer.designation;
    else if (grp === 'fixed') v = x.value;
    else if (grp === 'blank') v = '';
    else if (grp === 'ask') v = (asks[t.id] || {})[f.name];
    if (v !== undefined && v !== null && String(v).trim() !== '') fields[f.name] = String(v);
    else if (grp === 'blank') fields[f.name] = '';
  }
  const tables = {};
  for (const [name, cfg] of Object.entries(tablesOf(t))) {
    const rows = [];
    for (const it of cfg.items) {
      const hits = it.key === 'EARNINGS' ? data.rows.filter(r => /^E\d+$/.test(r.key)) : data.rows.filter(r => r.key === it.key);
      for (const r of hits) {
        const rec = {};
        for (const [f, role] of Object.entries(cfg.cols)) rec[f] = role === 'name' ? (it.label && it.key !== 'EARNINGS' ? it.label : r.name) : role === 'nature' ? (it.nature || '') : role === 'monthly' ? money(r.monthly) : role === 'yearly' ? money(r.annual) : '';
        rows.push(rec);
      }
    }
    tables[name] = rows;
  }
  return { fields, tables };
}

/* ---------- loading ---------- */
async function load() {
  const [t, s, st] = await Promise.all([list('lettertpl'), list('signatories'), api('status')]);
  tpls = t.filter(x => x && x.data && x.data.name).sort((a, b) => String(a.data.name).localeCompare(String(b.data.name)));
  sigs = s.filter(x => x && x.data && x.data.name);
  if (st.ok) status = st.body;
  loaded = true;
  renderCard();
  if (window.tcmplRefreshTpls) window.tcmplRefreshTpls();
}
window.tcmplDocxTpls = cid => tpls.filter(t => t.data.active !== false && (t.data.client === '*' || t.data.client === cid) && t.data.current).map(t => ({ id: t.id, name: t.data.name }));

/* ---------- Client setup card ---------- */
let editing = null; // { id, map, tables, images, dateFmt, name, client }
function renderCard() {
  const card = $('#docxCard');
  if (!card) return;
  const cid = clientId(), admin = isAdmin();
  const mine = tpls.filter(t => t.data.client === '*' || t.data.client === cid);
  const setCount = t => { const m = mapOf(t); const need = Object.entries(m).filter(([k, x]) => scanOf(t).fields.some(f => f.name === k) && x.src === 'fixed' && !x.value).length; return need; };
  card.innerHTML = `<div class="row" style="justify-content:space-between;align-items:flex-start"><div><h3>Word offer letters</h3>
      <p class="note" style="margin:4px 0 0">Upload the client's own Word letter (with «placeholders», like HROne letters). The tool fills it from the offer, the salary calculator and this setup, keeps its exact layout, and adds the signature only when the offer is approved.</p></div>
      <div class="dx-status"><span class="chip ${status.pdf ? 'ok' : 'warn'}">${status.pdf ? 'PDF converter: on' : 'PDF converter not connected · Word letters cannot be sent yet'}</span></div></div>
    <div class="tscroll" style="margin-top:10px"><table class="dx-list"><tr><th>Template</th><th>Used for</th><th>Version</th><th>Set-up</th><th></th></tr>
    ${mine.length ? mine.map(t => { const d = t.data, v = (d.versions || [])[0] || {}; const need = setCount(t); const sc = scanOf(t);
      return `<tr><td><b>${esc(d.name)}</b><div class="note">${sc.fields.length} placeholders · ${sc.regions.length} salary tables · ${sc.images.length} pictures</div></td>
        <td>${d.client === '*' ? 'All clients' : esc(clientLabel())}</td><td>v${esc(d.current)}<div class="note">${esc(v.fileName || '')}</div></td>
        <td>${need ? `<span class="chip warn">${need} need a value</span>` : '<span class="chip ok">Ready</span>'}</td>
        <td class="row" style="gap:6px;flex-wrap:wrap">${admin ? `<button class="btn small" data-dxed="${esc(t.id)}">Set up placeholders</button><label class="btn small filebtn">New version<input type="file" data-dxver="${esc(t.id)}" accept=".docx" hidden></label>` : ''}
          <button class="btn small" data-dxdl="${esc(t.id)}">Download Word file</button>${admin ? `<button class="btn small" data-dxdel="${esc(t.id)}">Delete</button>` : ''}</td></tr>`; }).join('')
    : '<tr><td colspan="5" class="note">No Word template for this client yet. The Offer desk uses the TCMPL text templates below.</td></tr>'}</table></div>
    ${admin ? `<div class="dx-up row" style="margin-top:10px;gap:8px;align-items:flex-end;flex-wrap:wrap">
      <div class="field"><label class="lbl" for="dxName">Template name</label><input type="text" id="dxName" placeholder="e.g. Offer-cum-appointment letter" style="min-width:260px"></div>
      <div class="field"><label class="lbl" for="dxFor">Use for</label><select id="dxFor"><option value="${esc(cid)}">${esc(clientLabel())} only</option><option value="*">All clients</option></select></div>
      <label class="btn primary small filebtn">Upload Word template (.docx)<input type="file" id="dxFile" accept=".docx" hidden></label></div>` : '<p class="note" style="margin-top:8px">Only admins can add or change Word templates and signatures.</p>'}
    <div id="dxEditor"></div>
    <h4 class="subh">Signatories</h4>
    <p class="note">Who signs offer letters. The signature image is kept privately on the server and is added to a letter only when it is approved; nobody can download it.</p>
    <div class="tscroll"><table><tr><th>Name</th><th>Designation</th><th>For</th><th>Signature</th><th></th></tr>
    ${sigsFor(cid).length ? sigsFor(cid).map(s => `<tr><td><b>${esc(s.data.name)}</b></td><td>${esc(s.data.designation || '')}</td><td>${s.data.client === '*' ? 'All clients' : esc(clientLabel())}</td>
      <td>${s.data.hasImage ? '<span class="chip ok">Added</span>' : '<span class="chip warn">Missing</span>'}</td>
      <td class="row" style="gap:6px">${admin ? `<label class="btn small filebtn">${s.data.hasImage ? 'Replace' : 'Add'} signature<input type="file" data-sgimg="${esc(s.id)}" accept=".png,.jpg,.jpeg" hidden></label><button class="btn small" data-sgdel="${esc(s.id)}">Remove</button>` : ''}</td></tr>`).join('')
    : '<tr><td colspan="5" class="note">No signatories yet.</td></tr>'}</table></div>
    ${admin ? `<div class="row" style="margin-top:8px;gap:8px;align-items:flex-end;flex-wrap:wrap">
      <div class="field"><label class="lbl" for="sgName">Name</label><input type="text" id="sgName" placeholder="e.g. Asha Rao"></div>
      <div class="field"><label class="lbl" for="sgDesg">Designation</label><input type="text" id="sgDesg" placeholder="e.g. Head, Human Resources"></div>
      <div class="field"><label class="lbl" for="sgFor">For</label><select id="sgFor"><option value="${esc(cid)}">${esc(clientLabel())} only</option><option value="*">All clients</option></select></div>
      <div class="field"><label class="lbl" for="sgImg">Signature (PNG or JPEG, clear background)</label><input type="file" id="sgImg" accept=".png,.jpg,.jpeg"></div>
      <button class="btn small" id="sgAdd" type="button">Add signatory</button></div>` : ''}`;
  if (admin) wireAdmin(card);
  card.querySelectorAll('[data-dxdl]').forEach(b => { b.onclick = async () => { const r = await api('file', { id: b.dataset.dxdl }); if (r.ok) saveAs(b64Blob(r.body.base64, DOCX), r.body.fileName || 'template.docx'); else toast('Could not download the template.'); }; });
  if (editing && admin) renderEditor();
}

function wireAdmin(card) {
  const up = $('#dxFile');
  if (up) up.onchange = async () => {
    const f = up.files[0]; if (!f) return;
    if (!/\.docx$/i.test(f.name)) { toast('Please choose a Word .docx file (in Word: File → Save As → Word Document).'); return; }
    toast('Reading the template…');
    const r = await api('upload', { name: $('#dxName').value.trim() || f.name.replace(/\.docx$/i, ''), client: $('#dxFor').value, fileName: f.name, base64: await fileB64(f) });
    if (!r.ok) { toast(r.body.detail || 'The template could not be uploaded.'); return; }
    await load();
    openEditor(r.body.id);
    toast(`Found ${r.body.scan.fields.length} placeholders. Check where each one comes from, then save.`);
  };
  card.querySelectorAll('[data-dxver]').forEach(inp => { inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    const r = await api('upload', { id: inp.dataset.dxver, fileName: f.name, base64: await fileB64(f) });
    if (!r.ok) { toast(r.body.detail || 'The new version could not be uploaded.'); return; }
    await load(); openEditor(inp.dataset.dxver); toast(`Version ${r.body.v} uploaded. Your set-up is kept; check any new placeholders.`);
  }; });
  card.querySelectorAll('[data-dxed]').forEach(b => { b.onclick = () => openEditor(b.dataset.dxed); });
  card.querySelectorAll('[data-dxdel]').forEach(b => { b.onclick = async () => {
    const t = tplById(b.dataset.dxdel);
    if (!t || !window.confirm(`Delete the Word template "${t.data.name}" and all its versions? Letters already sent are not affected.`)) return;
    const r = await api('delete', { id: t.id });
    if (r.ok) { if (editing && editing.id === t.id) editing = null; await load(); toast('Template deleted.'); } else toast('Could not delete the template.');
  }; });
  const add = $('#sgAdd');
  if (add) add.onclick = async () => {
    const name = $('#sgName').value.trim(); if (!name) { toast('Type the signatory\'s name.'); return; }
    const f = $('#sgImg').files[0];
    const r = await api('signatory-save', { name, designation: $('#sgDesg').value.trim(), client: $('#sgFor').value, base64: f ? await fileB64(f) : '' });
    if (!r.ok) { toast(r.body.detail || 'Could not add the signatory.'); return; }
    await load(); toast(f ? 'Signatory added.' : 'Signatory added. Add their signature image before approving letters.');
  };
  card.querySelectorAll('[data-sgimg]').forEach(inp => { inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    const s = sigs.find(x => x.id === inp.dataset.sgimg);
    const r = await api('signatory-save', { id: s.id, name: s.data.name, designation: s.data.designation, client: s.data.client, base64: await fileB64(f) });
    if (r.ok) { await load(); toast('Signature saved.'); } else toast(r.body.detail || 'Could not save the signature.');
  }; });
  card.querySelectorAll('[data-sgdel]').forEach(b => { b.onclick = async () => {
    const s = sigs.find(x => x.id === b.dataset.sgdel);
    if (!s || !window.confirm(`Remove ${s.data.name} and their signature?`)) return;
    const r = await api('signatory-delete', { id: s.id });
    if (r.ok) { await load(); toast('Signatory removed.'); } else toast('Could not remove the signatory.');
  }; });
}

function openEditor(id) {
  const t = tplById(id); if (!t) return;
  editing = { id, name: t.data.name, client: t.data.client, dateFmt: t.data.dateFmt || 'd MMMM yyyy', map: JSON.parse(JSON.stringify(mapOf(t))), tables: JSON.parse(JSON.stringify(tablesOf(t))), images: JSON.parse(JSON.stringify(imagesOf(t))) };
  renderEditor();
  const ed = $('#dxEditor'); if (ed) ed.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function srcSelect(field, cur) {
  return `<select data-dxsrc="${esc(field)}" aria-label="Where ${esc(field)} comes from">${SOURCES.map(([g, xs]) => `<optgroup label="${esc(g)}">${xs.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('')}</optgroup>`).join('')}
    ${(() => { const data = window.tcmplOfferData && window.tcmplOfferData(); const cl = (data && data.customLetter) || []; return cl.length ? `<optgroup label="Offer letter details (Client setup)">${cl.map(x => `<option value="custom.${esc(x.slug)}" ${'custom.' + x.slug === cur ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</optgroup>` : ''; })()}</select>`;
}

function renderEditor() {
  const box = $('#dxEditor'), t = editing && tplById(editing.id);
  if (!box || !t) { if (box) box.innerHTML = ''; return; }
  const sc = scanOf(t), e = editing;
  const data = window.tcmplOfferData && window.tcmplOfferData();
  const sample = data ? valuesFor(Object.assign({}, t, { data: Object.assign({}, t.data, { map: e.map, tables: e.tables, dateFmt: e.dateFmt }) }), data, sigsFor(clientId())[0] && sigsFor(clientId())[0].data).fields : {};
  const where = f => f.parts.map(p => ({ document: 'letter', header: 'header', footer: 'footer' })[p] || p).join(', ');
  box.innerHTML = `<div class="dx-ed">
    <div class="row" style="justify-content:space-between;align-items:center"><h4 style="margin:0">Set up: ${esc(e.name)}</h4><button class="btn small" id="dxClose" type="button">Close</button></div>
    <div class="form" style="margin-top:8px"><div class="field"><label class="lbl" for="dxEdName">Template name</label><input type="text" id="dxEdName" value="${esc(e.name)}"></div>
      <div class="field"><label class="lbl" for="dxDate">Dates appear as</label><select id="dxDate">${['d MMMM yyyy', 'dd/MM/yyyy', 'dd-MMM-yyyy', 'dd.MM.yyyy', 'MMMM d, yyyy'].map(f => `<option ${f === e.dateFmt ? 'selected' : ''} value="${f}">${esc(fmtDate('2026-12-01', f))}</option>`).join('')}</select></div></div>
    <p class="note">Found in the file: ${sc.fields.length} placeholders, ${sc.regions.length} salary tables, ${sc.images.length} pictures. Word fields «NAME» and typed «NAME», &lt;&lt;NAME&gt;&gt; or {{NAME}} are all read.</p>
    ${sc.warnings && sc.warnings.length ? `<div class="dx-warn">${sc.warnings.map(w => `<div>⚠ ${esc(w)}</div>`).join('')}</div>` : ''}
    <h4 class="subh">Placeholders (${sc.fields.length})</h4>
    <p class="note">Each «placeholder» in the Word file and where its value comes from. "Same text on every letter" fills it once for this template; "HR types it on each offer" adds a box on the Offer desk. The example column uses the offer open on the Offer desk.</p>
    <div class="tscroll"><table class="dx-map"><tr><th>Placeholder</th><th>Fill from</th><th>Text / question</th><th>Example</th></tr>
    ${sc.fields.map(f => { const m = e.map[f.name] || autoMap(f.name); const need = m.src === 'fixed' && !m.value;
      return `<tr class="${need ? 'need' : ''}"><td><code>«${esc(f.name)}»</code><div class="note">${f.count}× · ${esc(where(f))}${f.styles ? ' · ' + esc(f.styles.join(', ')) : ''}</div></td><td>${srcSelect(f.name, m.src)}</td>
        <td>${m.src === 'fixed' ? `<input type="text" data-dxval="${esc(f.name)}" value="${esc(m.value || '')}" placeholder="Type the text for every letter">` : m.src === 'ask' ? `<input type="text" data-dxlab="${esc(f.name)}" value="${esc(m.label || pretty(f.name))}" placeholder="Label HR sees">` : '<span class="note">—</span>'}</td>
        <td class="note">${m.src === 'ask' ? 'Typed by HR' : m.src === 'blank' ? '(empty)' : esc(sample[f.name] !== undefined ? sample[f.name] : (m.src.startsWith('sig.') ? 'From the chosen signatory' : 'Not available yet'))}</td></tr>`; }).join('')}</table></div>
    ${sc.images.length ? `<h4 class="subh">Pictures</h4><div class="tscroll"><table><tr><th>Placeholder</th><th>Use</th><th></th></tr>${sc.images.map(k => { const m = e.images[k] || { src: 'blank' };
      return `<tr><td><code>«Image:${esc(k)}»</code></td><td><select data-dximg="${esc(k)}"><option value="signature" ${m.src === 'signature' ? 'selected' : ''}>Signatory's signature (added on approval)</option><option value="picture" ${m.src === 'picture' ? 'selected' : ''}>A picture uploaded here (e.g. company logo)</option><option value="blank" ${m.src === 'blank' ? 'selected' : ''}>Leave out</option></select></td>
        <td>${m.src === 'picture' ? `${m.has ? '<span class="chip ok">Uploaded</span> ' : '<span class="chip warn">Not uploaded</span> '}<label class="btn small filebtn">${m.has ? 'Replace' : 'Upload'} picture<input type="file" data-dxpic="${esc(k)}" accept=".png,.jpg,.jpeg" hidden></label>` : ''}</td></tr>`; }).join('')}</table></div>` : ''}
    ${sc.regions.length ? `<h4 class="subh">Salary tables</h4><p class="note">Each table repeats one row per salary component, taken from the salary on the Offer desk (TC CTC calculator). Components that are zero are left out; a table with no rows is removed from the letter.</p>
      ${sc.regions.map(r => { const cfg = e.tables[r.name] || defaultTable(r.name, r.fields); const on = new Map(cfg.items.map(i => [i.key, i]));
        return `<div class="dx-tbl"><b>${esc(r.name)}</b>
          <div class="dx-cols">${r.fields.map(f => `<label class="note">«${esc(f)}» <select data-dxcol="${esc(r.name)}|${esc(f)}">${[['name', 'Component name'], ['nature', 'Nature'], ['monthly', 'Monthly amount'], ['yearly', 'Yearly amount'], ['blank', 'Leave empty']].map(([v, l]) => `<option value="${v}" ${cfg.cols[f] === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`).join('')}</div>
          <div class="dx-comps">${COMPONENTS.map(([k, l]) => { const it = on.get(k); return `<div class="dx-comp ${it ? 'on' : ''}"><label><input type="checkbox" data-dxcomp="${esc(r.name)}|${k}" ${it ? 'checked' : ''}> ${esc(l)}</label>${it ? `<input type="text" data-dxnat="${esc(r.name)}|${k}" value="${esc(it.nature || '')}" placeholder="Nature" aria-label="Nature of ${esc(l)}"><input type="text" data-dxlbl="${esc(r.name)}|${k}" value="${esc(it.label || '')}" placeholder="Name in letter (optional)" aria-label="Name of ${esc(l)} in the letter">` : ''}</div>`; }).join('')}</div></div>`; }).join('')}` : ''}
    <div class="row" style="margin-top:12px;gap:8px"><button class="btn primary" id="dxSave" type="button">Save set-up</button><span class="note" id="dxSaveNote"></span></div></div>`;

  $('#dxClose').onclick = () => { editing = null; renderEditor(); };
  $('#dxEdName').oninput = ev => { e.name = ev.target.value; };
  $('#dxDate').onchange = ev => { e.dateFmt = ev.target.value; renderEditor(); };
  box.querySelectorAll('[data-dxsrc]').forEach(s => { s.onchange = () => { const f = s.dataset.dxsrc; e.map[f] = Object.assign({}, e.map[f], { src: s.value, label: s.value === 'ask' ? ((e.map[f] && e.map[f].label) || pretty(f)) : (e.map[f] && e.map[f].label) || '' }); renderEditor(); }; });
  box.querySelectorAll('[data-dxval]').forEach(i => { i.oninput = () => { e.map[i.dataset.dxval].value = i.value; i.closest('tr').classList.toggle('need', !i.value); }; });
  box.querySelectorAll('[data-dxlab]').forEach(i => { i.oninput = () => { e.map[i.dataset.dxlab].label = i.value; }; });
  box.querySelectorAll('[data-dximg]').forEach(s => { s.onchange = () => { e.images[s.dataset.dximg] = Object.assign({}, e.images[s.dataset.dximg], { src: s.value }); renderEditor(); }; });
  box.querySelectorAll('[data-dxpic]').forEach(inp => { inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    const r = await api('picture', { id: e.id, field: inp.dataset.dxpic, base64: await fileB64(f) });
    if (!r.ok) { toast(r.body.detail || 'Could not upload the picture.'); return; }
    e.images[inp.dataset.dxpic] = { src: 'picture', has: true }; toast('Picture uploaded.'); renderEditor();
  }; });
  box.querySelectorAll('[data-dxcol]').forEach(s => { s.onchange = () => { const [r, f] = s.dataset.dxcol.split('|'); e.tables[r] = e.tables[r] || defaultTable(r, []); e.tables[r].cols[f] = s.value; }; });
  box.querySelectorAll('[data-dxcomp]').forEach(c => { c.onchange = () => {
    const [r, k] = c.dataset.dxcomp.split('|'); const reg = sc.regions.find(x => x.name === r);
    const cfg = e.tables[r] = e.tables[r] || defaultTable(r, reg ? reg.fields : []);
    cfg.items = c.checked ? cfg.items.concat([{ key: k, nature: NATURE[k] || 'Fixed', label: '' }]) : cfg.items.filter(i => i.key !== k);
    const order = COMPONENTS.map(x => x[0]); cfg.items.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    renderEditor();
  }; });
  box.querySelectorAll('[data-dxnat]').forEach(i => { i.oninput = () => { const [r, k] = i.dataset.dxnat.split('|'); const it = e.tables[r].items.find(x => x.key === k); if (it) it.nature = i.value; }; });
  box.querySelectorAll('[data-dxlbl]').forEach(i => { i.oninput = () => { const [r, k] = i.dataset.dxlbl.split('|'); const it = e.tables[r].items.find(x => x.key === k); if (it) it.label = i.value; }; });
  $('#dxSave').onclick = async () => {
    const r = await api('save', { id: e.id, name: e.name, map: e.map, tables: e.tables, images: e.images, dateFmt: e.dateFmt });
    if (!r.ok) { toast(r.body.detail || 'Could not save.'); return; }
    $('#dxSaveNote').textContent = 'Saved.';
    const keep = e.id; await load(); if (editing && editing.id === keep) openEditor(keep);
    toast('Letter set-up saved. The Offer desk uses it straight away.');
  };
}

/* ---------- Offer desk ---------- */
const curTpl = () => { const v = ($('#oTpl') && $('#oTpl').value) || ''; return v.startsWith('docx:') ? tplById(v.slice(5)) : null; };
let lastKey = '', timer = null, docxLib = null, renderSeq = 0;
const sigPick = {}; // template id -> signatory id

function panel(t) {
  let p = $('#docxPanel');
  if (!p) { p = document.createElement('div'); p.id = 'docxPanel'; p.className = 'dx-panel'; const lp = $('#letterPrev'); lp.parentNode.insertBefore(p, lp); }
  if (!t) { p.hidden = true; p.innerHTML = ''; return p; }
  p.hidden = false;
  const cid = clientId(), m = mapOf(t), ss = sigsFor(cid);
  const askF = scanOf(t).fields.filter(f => (m[f.name] || autoMap(f.name)).src === 'ask');
  if (!sigPick[t.id] || !ss.some(s => s.id === sigPick[t.id])) sigPick[t.id] = (ss.find(s => s.data.hasImage) || ss[0] || {}).id || '';
  const a = asks[t.id] = asks[t.id] || {};
  const focus = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.dxask : null;
  const data = window.tcmplOfferData && window.tcmplOfferData();
  const sigText = data ? String(data.cv('signatory') || '') : '';
  p.innerHTML = `${usesSignature(t) ? (ss.length ? `<div class="field"><label class="lbl" for="dxSig">Signed by</label><select id="dxSig">${ss.map(s => `<option value="${esc(s.id)}" ${s.id === sigPick[t.id] ? 'selected' : ''}>${esc(s.data.name)}${s.data.designation ? ', ' + esc(s.data.designation) : ''}${s.data.hasImage ? '' : ' (no signature image)'}</option>`).join('')}</select></div>`
    : `<div class="note"><b>Signed by:</b> ${esc(sigText || 'the signatory in Client setup → Offer letter details')}. <span class="chip warn">No signature picture yet</span> The letter goes without one until an admin adds a signatory with a signature image in Offer letters → Signatories.</div>`) : ''}
    ${askF.length ? `<div class="dx-asks">${askF.map(f => `<div class="field"><label class="lbl" for="dxa_${esc(f.name)}">${esc((m[f.name] && m[f.name].label) || pretty(f.name))}</label><input type="text" id="dxa_${esc(f.name)}" data-dxask="${esc(f.name)}" value="${esc(a[f.name] || '')}"></div>`).join('')}</div>` : ''}
    <div class="note" id="dxState"></div>`;
  const sel = $('#dxSig'); if (sel) sel.onchange = () => { sigPick[t.id] = sel.value; schedule(); };
  p.querySelectorAll('[data-dxask]').forEach(i => { i.oninput = () => { a[i.dataset.dxask] = i.value; schedule(); }; });
  if (focus) { const el = p.querySelector(`[data-dxask="${CSS.escape(focus)}"]`); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }
  return p;
}

function payloadFor(t, final) {
  const data = window.tcmplOfferData && window.tcmplOfferData();
  if (!data) return null;
  const s = sigs.find(x => x.id === sigPick[t.id]);
  const { fields, tables } = valuesFor(t, data, s && s.data);
  return { id: t.id, client: data.clientId, fields, tables, signatoryId: s ? s.id : '', final: Boolean(final), password: final ? data.password || '' : '', fileName: data.fileBase, candidate: { name: data.c.name, mobile: data.c.mobile } };
}

function schedule() { clearTimeout(timer); timer = setTimeout(preview, 600); }

async function preview() {
  const t = curTpl(); if (!t) return;
  const body = payloadFor(t, false); if (!body) return;
  const key = JSON.stringify(body);
  const state = $('#dxState');
  if (key === lastKey) return;
  lastKey = key;
  const seq = ++renderSeq;
  if (state) state.textContent = 'Updating the letter…';
  const r = await api('render', body);
  if (seq !== renderSeq) return;
  if (!r.ok) { if (state) state.textContent = r.body.detail || 'The letter preview could not be made.'; lastKey = ''; return; }
  const miss = r.body.missing || [];
  if (state) state.innerHTML = (miss.length ? `<span class="chip warn">${miss.length} still empty</span> ${esc(miss.map(pretty).join(', '))} · highlighted in yellow. Fill them in (Offer letters, or the boxes above) before approving.`
    : '<span class="chip ok">Ready to approve</span> Every placeholder is filled.') + (status.pdf ? '' : ' <span class="note">The PDF converter is not connected yet, so this letter cannot be sent. Use a text template until it is.</span>');
  const lp = $('#letterPrev');
  try {
    docxLib = docxLib || await import('docx-preview');
    const holder = document.createElement('div');
    holder.className = 'dx-doc';
    await docxLib.renderAsync(b64Blob(r.body.docxBase64, DOCX), holder, null, { className: 'docx', inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: false, experimental: false, renderHeaders: true, renderFooters: true });
    if (seq !== renderSeq) return;
    lp.replaceChildren(holder);
    lp.classList.add('dx-on');
    const fit = () => { const w = lp.clientWidth - 16; const page = holder.querySelector('section.docx'); const pw = page ? page.offsetWidth : 816; holder.style.zoom = String(Math.min(1, Math.max(0.3, w / (pw + 20)))); };
    fit();
  } catch (e) { console.warn(e); lp.innerHTML = '<p class="note">The preview could not be shown here; use "Download Word" to check the letter.</p>'; }
}

window.tcmplDocxPreview = off => {
  if (off) { panel(null); const lp = $('#letterPrev'); if (lp) lp.classList.remove('dx-on'); lastKey = ''; return; }
  const t = curTpl();
  if (!t) { panel(null); return; }
  panel(t);
  schedule();
};

async function finalLetter() {
  const t = curTpl(); if (!t) return null;
  const body = payloadFor(t, true);
  if (!body) { toast('Open an offer first.'); return null; }
  const m = mapOf(t);
  const emptyAsk = scanOf(t).fields.filter(f => (m[f.name] || autoMap(f.name)).src === 'ask' && !String((asks[t.id] || {})[f.name] || '').trim());
  if (emptyAsk.length) { toast('Fill in: ' + emptyAsk.map(f => (m[f.name] && m[f.name].label) || pretty(f.name)).join(', ')); const el = document.querySelector(`[data-dxask="${CSS.escape(emptyAsk[0].name)}"]`); if (el) el.focus(); return null; }
  toast('Making the signed letter…');
  const r = await api('render', body);
  if (!r.ok) {
    if (r.body.error === 'missing') toast('Not sent. Still empty: ' + (r.body.missing || []).map(pretty).join(', '));
    else toast(r.body.detail || 'The letter could not be made, so nothing was sent.');
    return null;
  }
  if (r.body.note) toast(r.body.note);
  const s = sigs.find(x => x.id === body.signatoryId);
  return { blob: b64Blob(r.body.base64, r.body.mime), fileName: r.body.fileName, protected: Boolean(r.body.protected), pdf: Boolean(r.body.pdf), signatory: s ? s.data.name : '', text: r.body.text || '' };
}
window.tcmplDocxFinal = finalLetter;

window.tcmplDocxDownload = async kind => {
  const t = curTpl(); if (!t) return;
  if (kind === 'pdf') {
    if (!status.pdf) { toast('The PDF converter is not connected yet. Use "Download Word" to check the draft.'); return; }
    if (!window.confirm('This makes the approved, signed letter (it is recorded as approved by you). Continue?')) return;
    const L = await finalLetter(); if (L) saveAs(L.blob, L.fileName);
    return;
  }
  const body = payloadFor(t, false); if (!body) return;
  const r = await api('render', body);
  if (!r.ok) { toast(r.body.detail || 'Could not make the Word file.'); return; }
  const data = window.tcmplOfferData();
  saveAs(b64Blob(r.body.docxBase64, DOCX), `${data.fileBase}_draft.docx`);
  if ((r.body.missing || []).length) toast('Draft downloaded. Empty placeholders are highlighted in yellow; the signature is added on approval.');
};

/* ---------- start ---------- */
function start(n) {
  if (!$('#docxCard') || !$('#letterPrev') || !window.tcmplOfferData) { if (n < 100) setTimeout(() => start(n + 1), 150); return; }
  load();
  const sel = $('#clientSel');
  if (sel) sel.addEventListener('change', () => { editing = null; setTimeout(() => { renderCard(); if (window.tcmplRefreshTpls) window.tcmplRefreshTpls(); }, 50); });
  window.addEventListener('resize', () => { const h = $('#letterPrev .dx-doc'); if (h) { lastKey = ''; schedule(); } });
}
if (!loaded) start(0);
