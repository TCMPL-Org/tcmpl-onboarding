// Exit module screens. Loaded by src/module-switch.js only when Exit is chosen and switched on for the client.
// Everything is read and saved through /api/exit/... ; nothing here touches the onboarding screens.

import './exit.css';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtD = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${+m[3]} ${MON[+m[2] - 1]} ${m[1]}` : (iso || ''); };
const fmtDT = iso => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
const todayIso = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

const TABS = [
  ['desk', '1 · Exit desk'], ['journey', '2 · Case journey'], ['approvals', '3 · Approvals'], ['clear', '4 · Clearances and F&F'],
  ['interviews', '5 · Interviews and alumni'], ['dashboard', '6 · HR dashboard'], ['attrition', '7 · Attrition analysis'], ['setup', '8 · Exit setup']
];
const LATER = {
  approvals: ['Every approval request across cases, worked out from level, department, separation type and amount.', 'Approvers answer by one-click email links; reminders after the SLA, then the delegate is asked.', 'A "Who approves?" tester for any combination.'],
  clear: ['Clearance board per case: owners confirm by one-click email links, provisionally from acceptance.', 'Employee declares assets with photos on WhatsApp; the last day is only a confirmation.', 'Full and final settlement worked out from the rules, letters as PDF, wages within the legal deadline.'],
  interviews: ['Exit interview on WhatsApp in the employee\'s language.', 'Anonymous reports: groups smaller than the threshold in Exit setup are hidden.', 'Alumni opt-in on the last day (consent recorded) and job sharing.'],
  dashboard: ['Open cases, exits per month, attrition by department and manager hotspots.', 'Everything read from this client\'s exit cases only.'],
  attrition: ['Cost of attrition, early warning, cohorts and tenure, regretted loss.', 'Any sample data is clearly marked.']
};

let root = null, ctx = null, tab = 'desk', setupRec = null, cases = [], curId = '', previewT = null, importRows = [];
const $ = s => root.querySelector(s);
const $$ = s => [...root.querySelectorAll(s)];

async function post(action, body) {
  try {
    const res = await fetch('/api/exit/' + action, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body || {}) });
    const data = (res.headers.get('content-type') || '').includes('application/json') ? await res.json().catch(() => null) : null;
    return { ok: res.ok, status: res.status, body: data || {} };
  } catch { return { ok: false, status: 0, body: { error: 'network' } }; }
}
const client = () => ctx.clientId();
function toast(t) { if (window.tcmplWAUtil && window.tcmplWAUtil.toast) window.tcmplWAUtil.toast(t); }
function download(name, text, type = 'text/csv') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
const csvCell = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCsv = rows => '\ufeff' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = String(text || '').replace(/^\ufeff/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const clean = rows.filter(r => r.some(x => String(x).trim()));
  if (clean.length < 2) return [];
  const head = clean[0].map(h => String(h).trim());
  return clean.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, String(r[i] == null ? '' : r[i]).trim()])));
}

/* ---------------- shell ---------------- */
export function mount(el, c) {
  root = el; ctx = c;
  root.innerHTML = `<nav class="ex-tabs" role="tablist" aria-label="Exit sections">${TABS.map(([k, l]) => `<button role="tab" type="button" data-x="${k}" aria-selected="${k === tab}">${l}</button>`).join('')}</nav>
    <div class="ex-body">${TABS.map(([k]) => `<section class="ex-sec" id="ex-${k}" ${k === tab ? '' : 'hidden'}></section>`).join('')}</div>`;
  $$('.ex-tabs button').forEach(b => { b.onclick = () => show(b.dataset.x); });
  for (const k of Object.keys(LATER)) renderLater(k);
  refresh();
}

export async function refresh() {
  if (!root) return;
  const r = await post('setup', { client: client() });
  setupRec = r.ok ? r.body : null;
  await loadCases();
  show(tab);
}

function show(k) {
  tab = k;
  $$('.ex-tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.x === k)));
  $$('.ex-sec').forEach(s => { s.hidden = s.id !== 'ex-' + k; });
  if (k === 'desk') renderDesk();
  if (k === 'journey') renderJourney();
  if (k === 'setup') renderSetup();
}

function renderLater(k) {
  const name = TABS.find(t => t[0] === k)[1].replace(/^\d · /, '');
  root.querySelector('#ex-' + k).innerHTML = `<div class="intro"><div><h2>${esc(name)}</h2><p>Coming in the next build batches.</p></div></div>
    <div class="card ex-later"><h3>What this tab will do</h3><ul>${LATER[k].map(x => `<li>${esc(x)}</li>`).join('')}</ul>
    <p class="note">The rules it uses are already editable in Exit setup.</p></div>`;
}

async function loadCases() {
  const r = await post('cases', { client: client() });
  cases = r.ok ? r.body.items || [] : [];
}

/* ---------------- 1 · Exit desk ---------------- */
function typeOptions(by) {
  const types = (setupRec && setupRec.setup.types) || [];
  return ['Voluntary', 'Involuntary', 'Natural'].map(cat => {
    const list = types.filter(t => t.cat === cat && (!by || String(t.raise).split(/,\s*/).includes(by)));
    return list.length ? `<optgroup label="${cat}">${list.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</optgroup>` : '';
  }).join('');
}

function renderDesk() {
  const sec = $('#ex-desk');
  if (!setupRec) { sec.innerHTML = '<div class="card">Exit setup could not be loaded. Check that you are signed in and the database is connected.</div>'; return; }
  const o = setupRec.options;
  if (!$('#exRaise')) {
    sec.innerHTML = `<div class="intro"><div><h2>Exit desk</h2><p>Raise an exit here, or import exits already raised in any HRMS. The agent works out notice, last working day, approvals and every step from ${esc(ctx.clientLabel())}'s rules in Exit setup.</p></div></div>
    <div class="ex-grid">
      <div class="card" id="exRaise">
        <h3>Raise an exit</h3>
        <div class="ex-form">
          <label>Employee name *<input id="exName" type="text" autocomplete="off"></label>
          <label>Employee code<input id="exCode" type="text" autocomplete="off"></label>
          <label>Mobile (WhatsApp)<input id="exMobile" type="tel" placeholder="98xxxxxxxx" autocomplete="off"></label>
          <label>Personal email<input id="exEmail" type="email" autocomplete="off"></label>
          <label>Designation<input id="exDesig" type="text"></label>
          <label>Department<input id="exDept" type="text" placeholder="Sales"></label>
          <label>Level<input id="exLevel" type="text" placeholder="L3"></label>
          <label>Location<input id="exLoc" type="text"></label>
          <label>Date of joining<input id="exDoj" type="date"></label>
          <label>Manager<input id="exMgr" type="text" placeholder="Anil Kumar"></label>
          <label>Manager email<input id="exMgrEmail" type="email"></label>
          <label>Raised by<select id="exBy">${o.raisers.map(r => `<option>${r}</option>`).join('')}</select></label>
          <label class="ex-wide">Separation type *<select id="exType"></select></label>
          <label>First told the manager<input id="exFirst" type="datetime-local"></label>
          <label>Formal date *<input id="exFormal" type="date"></label>
          <label>Requested last day (optional)<input id="exReq" type="date"></label>
          <label>Last working day (if already fixed)<input id="exLwd" type="date"></label>
          <label>Notice starts from (this case)<select id="exStart"><option value="">Use the rule</option>${Object.entries(o.start).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
          <label>Announcement<select id="exAnn"><option value="">As set for the type</option>${o.announce.map(x => `<option>${esc(x)}</option>`).join('')}</select></label>
          <label>Tell recruitment<select id="exTa"><option value="">As set for the type</option>${o.ta.map(x => `<option>${esc(x)}</option>`).join('')}</select></label>
          <label>Replacement<select id="exRep">${o.replace.map(x => `<option>${esc(x)}</option>`).join('')}</select></label>
          <label class="ex-wide">Reason (optional)<input id="exReason" type="text"></label>
        </div>
        <div class="row" style="margin-top:12px"><button class="btn primary" id="exCreate" type="button">Create case and start the agent</button><span class="note" id="exState"></span></div>
      </div>
      <div class="card" id="exPreview"><h3>What the agent will do</h3><div id="exSum" class="note">Fill in the employee, type and formal date.</div></div>
    </div>
    <div class="card" style="margin-top:16px">
      <h3>Import exits from any HRMS</h3>
      <p class="note">Upload a CSV (in Excel: File → Save as → CSV). Column names can be the HRMS's own, e.g. Emp ID, Employee Name, Separation Type, Resignation Date, Relieving Date, Mobile.</p>
      <div class="row" style="flex-wrap:wrap;gap:8px"><input type="file" id="exFile" accept=".csv,text/csv"><button class="btn small" id="exTpl" type="button">Blank import template</button><button class="btn small primary" id="exImport" type="button" disabled>Import and let the agent pick up</button><span class="note" id="exImpState"></span></div>
      <div id="exImpPrev"></div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px"><h3 style="margin:0">Exit cases</h3>
        <div class="row" style="gap:8px"><label class="note" style="display:inline-flex;gap:4px;align-items:center"><input type="checkbox" id="exShowAll"> Show closed and cancelled</label><button class="btn small" id="exCsv" type="button">Download CSV</button><button class="btn small" id="exReload" type="button">Refresh</button></div></div>
      <div class="tscroll"><table class="ex-tbl" id="exCases"></table></div>
    </div>`;
    $('#exBy').onchange = () => { $('#exType').innerHTML = typeOptions($('#exBy').value); preview(); };
    $$('#exRaise input, #exRaise select').forEach(i => i.addEventListener(i.tagName === 'SELECT' ? 'change' : 'input', () => { clearTimeout(previewT); previewT = setTimeout(preview, 350); }));
    $('#exCreate').onclick = create;
    $('#exFile').onchange = readImport;
    $('#exImport').onclick = doImport;
    $('#exTpl').onclick = () => download('Exit_import_template.csv', toCsv([['Emp ID', 'Employee Name', 'Mobile', 'Email', 'Designation', 'Department', 'Level', 'Location', 'Date of joining', 'Manager', 'Manager email', 'Separation Type', 'Resignation Date', 'Relieving Date', 'Reason', 'Initiated By']]));
    $('#exCsv').onclick = casesCsv;
    $('#exReload').onclick = async () => { await loadCases(); renderCases(); };
    $('#exShowAll').onchange = renderCases;
    $('#exFormal').value = todayIso();
  }
  $('#exType').innerHTML = typeOptions($('#exBy').value);
  $('#exStart').disabled = !setupRec.setup.noticeStart.allowCase;
  renderCases();
  preview();
}

function draft() {
  const v = id => ($('#' + id) ? $('#' + id).value.trim() : '');
  return {
    employee: { name: v('exName'), code: v('exCode'), mobile: v('exMobile'), email: v('exEmail'), designation: v('exDesig'), dept: v('exDept'), level: v('exLevel'), location: v('exLoc'), doj: v('exDoj'), manager: v('exMgr'), managerEmail: v('exMgrEmail') },
    raisedBy: v('exBy'), typeId: v('exType'), first: v('exFirst'), formal: v('exFormal'), requestedLwd: v('exReq'), lwd: v('exLwd'),
    startOverride: v('exStart'), announce: v('exAnn'), ta: v('exTa'), replace: v('exRep'), reason: v('exReason')
  };
}

async function preview() {
  const d = draft();
  if (!d.employee.name || !d.typeId || !d.formal) { $('#exSum').innerHTML = 'Fill in the employee, type and formal date.'; return; }
  const r = await post('preview', { client: client(), clientLabel: ctx.clientLabel(), case: d });
  if (!r.ok) { $('#exSum').textContent = 'Could not work it out right now.'; return; }
  if (r.body.errors) { $('#exSum').innerHTML = `<ul class="ex-err">${r.body.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>`; return; }
  const k = r.body.case;
  $('#exSum').innerHTML = `<dl class="ex-dl">
    <dt>Type</dt><dd>${esc(k.typeName)} <span class="chip">${esc(k.category)}</span></dd>
    <dt>Notice</dt><dd>${k.noticeDays ? `${k.noticeDays} days <span class="note">(rule: ${esc(k.noticeRule)})</span>` : esc(k.noticeText)}</dd>
    ${k.noticeDays ? `<dt>Notice starts</dt><dd>${fmtD(k.noticeStart)} <span class="note">(${esc(k.noticeStartRule)})</span></dd><dt>Last day as per notice</dt><dd>${fmtD(k.noticeLwd)}</dd>` : ''}
    <dt>Last working day</dt><dd><b>${fmtD(k.lwd)}</b>${k.waiverDays ? ` <span class="chip ex-amber">${k.waiverDays} days' waiver needs approval</span>` : ''}</dd>
    <dt>Approvals</dt><dd>${k.approvals.length ? k.approvals.map(a => `${esc(a.action)}: ${a.chain.map(s => esc(s.person === s.role ? s.role : `${s.person} (${s.role})`)).join(a.mode === 'Parallel' ? ' + ' : ' → ') || 'no rule found'}`).join('<br>') : 'None'}</dd>
    <dt>Announcement</dt><dd>${esc(k.announce)}</dd><dt>Recruitment</dt><dd>${esc(k.ta)}</dd>
    <dt>Steps</dt><dd>${k.plan.length} steps from ${fmtD(k.plan[0] && k.plan[0].date)} to ${fmtD(k.plan[k.plan.length - 1] && k.plan[k.plan.length - 1].date)}</dd></dl>`;
}

async function create() {
  const btn = $('#exCreate'); btn.disabled = true; $('#exState').textContent = 'Creating…';
  const r = await post('raise', { client: client(), clientLabel: ctx.clientLabel(), case: draft() });
  btn.disabled = false;
  if (!r.ok) {
    $('#exState').textContent = r.body.error === 'case_exists' ? 'An open case already exists for this employee and date.' : r.body.error === 'exit_off_for_client' ? 'Exit is off for this client.' : (r.body.errors || []).join(' ') || 'Not created.';
    return;
  }
  $('#exState').textContent = '';
  toast(`Exit case created for ${r.body.case.employee.name}.`);
  ['exName', 'exCode', 'exMobile', 'exEmail', 'exDesig', 'exLevel', 'exLoc', 'exDoj', 'exMgr', 'exMgrEmail', 'exFirst', 'exReq', 'exLwd', 'exReason'].forEach(id => { $('#' + id).value = ''; });
  await loadCases();
  curId = r.body.case.id;
  show('journey');
}

async function readImport() {
  const f = $('#exFile').files[0];
  importRows = [];
  $('#exImport').disabled = true; $('#exImpPrev').innerHTML = '';
  if (!f) return;
  if (!/\.csv$/i.test(f.name)) { $('#exImpState').textContent = 'Please save the file as CSV first.'; return; }
  importRows = parseCsv(await f.text());
  $('#exImpState').textContent = importRows.length ? `${importRows.length} rows read from ${f.name}.` : 'No rows found.';
  $('#exImport').disabled = !importRows.length;
  if (importRows.length) {
    const cols = Object.keys(importRows[0]).slice(0, 8);
    $('#exImpPrev').innerHTML = `<div class="tscroll"><table class="ex-tbl"><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr>${importRows.slice(0, 5).map(r => `<tr>${cols.map(c => `<td>${esc(r[c])}</td>`).join('')}</tr>`).join('')}</table></div>${importRows.length > 5 ? `<p class="note">…and ${importRows.length - 5} more.</p>` : ''}`;
  }
}

async function doImport() {
  if (!importRows.length) return;
  $('#exImport').disabled = true; $('#exImpState').textContent = 'Importing…';
  const r = await post('import', { client: client(), clientLabel: ctx.clientLabel(), rows: importRows });
  if (!r.ok) { $('#exImpState').textContent = r.body.error === 'too_many_rows' ? `At most ${r.body.max} rows at a time.` : r.body.error === 'exit_off_for_client' ? 'Exit is off for this client.' : 'Import failed.'; $('#exImport').disabled = false; return; }
  const bad = r.body.results.filter(x => !x.ok);
  $('#exImpState').textContent = `${r.body.created} created, ${r.body.failed} not imported.`;
  $('#exImpPrev').innerHTML = bad.length ? `<ul class="ex-err">${bad.map(b => `<li>Row ${b.row}${b.name ? ' (' + esc(b.name) + ')' : ''}: ${esc(b.errors.join(' '))}</li>`).join('')}</ul>` : '';
  importRows = []; $('#exFile').value = '';
  await loadCases(); renderCases();
}

function stageLabel(k) {
  if (k.status === 'cancelled') return 'Cancelled';
  if (k.status === 'closed') return 'Closed';
  const st = (setupRec && setupRec.options.stages) || [];
  const s = k.next ? st.find(x => x[0] === k.next.stage) : null;
  return s ? s[1] : 'All steps done';
}

function renderCases() {
  const t = $('#exCases'); if (!t) return;
  const all = $('#exShowAll') && $('#exShowAll').checked;
  const list = cases.filter(k => all || k.status === 'open');
  t.innerHTML = list.length ? `<tr><th>Employee</th><th>Type</th><th>Raised</th><th>Last day</th><th>Stage</th><th>Next step</th><th></th></tr>` + list.map(k => `<tr data-id="${esc(k.id)}" class="ex-click">
      <td><b>${esc(k.name)}</b><div class="note">${esc([k.code, k.designation, k.dept, k.level].filter(Boolean).join(' · '))}</div></td>
      <td>${esc(k.typeName)}<div class="note">by ${esc(k.raisedBy)} · ${esc(k.source)}</div></td><td>${fmtD(k.formal)}</td>
      <td>${fmtD(k.lwd)}${k.waiverDays ? `<div class="note">${k.waiverDays} days' waiver asked</div>` : ''}</td><td>${esc(stageLabel(k))}</td>
      <td>${k.next ? `${esc(k.next.title)}<div class="note">${fmtD(k.next.date)}</div>` : ''}</td><td>${k.red ? `<span class="chip ex-red">${k.red} for HR</span>` : ''}</td></tr>`).join('')
    : '<tr><td class="note">No exit cases yet for this client. Raise one above or import from the HRMS.</td></tr>';
  t.querySelectorAll('tr[data-id]').forEach(tr => { tr.onclick = () => { curId = tr.dataset.id; show('journey'); }; });
}

function casesCsv() {
  download(`Exit_cases_${client()}.csv`, toCsv([['Case', 'Employee code', 'Name', 'Mobile', 'Designation', 'Department', 'Level', 'Type', 'Category', 'Raised by', 'Source', 'Formal date', 'Notice days', 'Waiver days', 'Last working day', 'Stage', 'Status', 'Next step', 'Next step date', 'Open HR items']]
    .concat(cases.map(k => [k.id, k.code, k.name, k.phone, k.designation, k.dept, k.level, k.typeName, k.category, k.raisedBy, k.source, k.formal, k.noticeDays, k.waiverDays, k.lwd, stageLabel(k), k.status, k.next ? k.next.title : '', k.next ? k.next.date : '', k.red]))));
}

/* ---------------- 2 · Case journey ---------------- */
async function renderJourney() {
  const sec = $('#ex-journey');
  const open = cases.filter(k => k.status === 'open');
  if (!curId || !cases.some(k => k.id === curId)) curId = (open[0] || cases[0] || {}).id || '';
  sec.innerHTML = `<div class="intro"><div><h2>Case journey</h2><p>Every step of the case on one screen, grouped by stage, with today marked. Sending each step on WhatsApp and email is the next build batch; today the plan, the employee's WhatsApp messages and HR items are live.</p></div>
    <div class="row"><select id="exPick">${cases.map(k => `<option value="${esc(k.id)}" ${k.id === curId ? 'selected' : ''}>${esc(k.name)} · ${esc(k.typeName)} · ${fmtD(k.lwd)}${k.status !== 'open' ? ' (' + k.status + ')' : ''}</option>`).join('')}</select></div></div>
    <div id="exCase">${curId ? '<div class="note">Loading…</div>' : '<div class="card note">No cases yet. Raise one on the Exit desk.</div>'}</div>`;
  if ($('#exPick')) $('#exPick').onchange = () => { curId = $('#exPick').value; renderJourney(); };
  if (!curId) return;
  const r = await post('case', { id: curId });
  if (!r.ok) { $('#exCase').innerHTML = '<div class="card">This case could not be loaded.</div>'; return; }
  const k = r.body.case, msgs = r.body.messages || [], today = r.body.today || todayIso();
  const e = k.employee || {};
  const stages = setupRec ? setupRec.options.stages : [];
  let todayShown = false;
  const plan = stages.map(([key, label]) => {
    const steps = (k.plan || []).filter(s => s.stage === key);
    if (!steps.length) return '';
    return `<div class="ex-stage"><h4>${esc(label)}</h4>${steps.map(s => {
      let line = '';
      if (!todayShown && s.date > today) { todayShown = true; line = `<div class="ex-today">Today · ${fmtD(today)}</div>`; }
      return `${line}<div class="ex-step ex-${esc(s.status)}"><div class="ex-when">${fmtD(s.date)}<span>${esc(s.time)}</span></div>
        <div><b>${esc(s.title)}</b><div class="note">To ${esc(s.to)} · ${s.channel === 'both' ? 'WhatsApp and email' : esc(s.channel === 'whatsapp' ? 'WhatsApp' : 'Email')}</div></div>
        <span class="chip">${esc(s.status)}</span></div>`;
    }).join('')}</div>`;
  }).join('') + (todayShown ? '' : `<div class="ex-today">Today · ${fmtD(today)}</div>`);
  const alerts = (k.alerts || []).map((a, i) => ({ a, i })).filter(x => x.a.open);
  $('#exCase').innerHTML = `<div class="ex-grid">
    <div>
      ${alerts.length ? `<div class="card ex-redcard"><h3>Needs HR</h3>${alerts.map(({ a, i }) => `<div class="row" style="justify-content:space-between;gap:8px;margin:4px 0"><span>${esc(a.why)} <span class="note">${fmtDT(a.at)}${a.alertedAt ? ' · HR emailed' : ''}</span></span><button class="btn small" data-close="${i}" type="button">Done</button></div>`).join('')}</div>` : ''}
      <div class="card"><h3>Steps</h3>${plan || '<p class="note">No steps apply to this case.</p>'}</div>
    </div>
    <div>
      <div class="card"><h3>Case facts</h3><dl class="ex-dl">
        <dt>Employee</dt><dd>${esc(e.name)}${e.code ? ' · ' + esc(e.code) : ''}<div class="note">${esc([e.designation, e.dept, e.level, e.location].filter(Boolean).join(' · '))}</div></dd>
        <dt>Contact</dt><dd>${esc(e.phone ? '+' + e.phone : 'no mobile')}${e.email ? '<br>' + esc(e.email) : ''}</dd>
        <dt>Manager</dt><dd>${esc(e.manager || '')}${e.managerEmail ? '<br>' + esc(e.managerEmail) : ''}</dd>
        <dt>Type</dt><dd>${esc(k.typeName)} · ${esc(k.category)} · raised by ${esc(k.raisedBy)} (${esc(k.source)})</dd>
        <dt>Formal date</dt><dd>${fmtD(k.formal)}${k.first && k.first.slice(0, 10) !== k.formal ? ` <span class="note">(first told manager ${fmtD(k.first)})</span>` : ''}</dd>
        <dt>Notice</dt><dd>${k.noticeDays ? `${k.noticeDays} days · ${esc(k.noticeRule)}<div class="note">from ${fmtD(k.noticeStart)} · ${esc(k.noticeStartRule)}</div>` : esc(k.noticeText)}</dd>
        <dt>Last working day</dt><dd><b>${fmtD(k.lwd)}</b>${k.waiverDays ? ` <span class="note">(${k.waiverDays} days' waiver asked; as per notice ${fmtD(k.noticeLwd)})</span>` : ''}</dd>
        <dt>Approvals</dt><dd>${(k.approvals || []).map(a => `${esc(a.action)}: ${esc(a.status)}<div class="note">${a.chain.map(s => esc(s.person === s.role ? s.role : `${s.person} (${s.role})`)).join(a.mode === 'Parallel' ? ' + ' : ' → ')}</div>`).join('') || 'None'}</dd>
        <dt>Announcement</dt><dd>${esc(k.announce)}</dd><dt>Recruitment</dt><dd>${esc(k.ta)} · ${esc(k.replace)}</dd>
        ${k.reason ? `<dt>Reason</dt><dd>${esc(k.reason)}</dd>` : ''}
        <dt>Status</dt><dd>${esc(k.status)}</dd></dl>
        ${k.status === 'open' ? '<div class="row" style="margin-top:10px"><button class="btn small" id="exCancel" type="button">Cancel this case</button></div>' : ''}</div>
      <div class="card" style="margin-top:16px"><h3>WhatsApp with ${esc((e.name || '').split(' ')[0] || 'the employee')}</h3>
        ${msgs.length ? `<div class="ex-msgs">${msgs.map(m => `<div class="ex-msg ${m.direction === 'in' ? 'ex-in' : 'ex-out'}">${esc(m.text)}<span>${fmtDT(m.at)}${m.error ? ' · not sent' : ''}</span></div>`).join('')}</div>` : '<p class="note">No messages yet. When the employee writes to the HR WhatsApp number, it shows here and HR is alerted.</p>'}</div>
      <div class="card" style="margin-top:16px"><h3>Activity</h3>${(k.log || []).slice().reverse().map(l => `<div class="ex-log"><span class="note">${fmtDT(l.at)} · ${esc(l.by)}</span><br>${esc(l.text)}</div>`).join('')}</div>
    </div></div>`;
  $$('#exCase [data-close]').forEach(b => { b.onclick = async () => { const x = await post('alert-close', { id: k.id, index: Number(b.dataset.close) }); if (x.ok) { await loadCases(); renderJourney(); } }; });
  if ($('#exCancel')) $('#exCancel').onclick = async () => {
    const why = window.prompt('Why is this case cancelled? (e.g. resignation withdrawn)');
    if (why === null) return;
    const x = await post('cancel', { id: k.id, reason: why });
    if (x.ok) { toast('Case cancelled.'); await loadCases(); renderJourney(); } else toast('Not cancelled.');
  };
}

/* ---------------- 8 · Exit setup ---------------- */
let draftSetup = null;
const COLS = o => ({
  types: [['name', 'Name', 'text', 'w14'], ['cat', 'Category', o.categories], ['raise', 'Who can raise', 'text', 'w10'], ['notice', 'Notice', o.notice], ['announce', 'Announcement', o.announce], ['ta', 'Tell recruitment', o.ta], ['interview', 'Interview', 'chk'], ['alumni', 'Alumni', 'chk'], ['letters', 'Letters', 'text', 'w16']],
  noticeRules: [['level', 'Level (L3, L3-L5, Any)', 'text'], ['dept', 'Department (or Any)', 'text'], ['prob', 'Days in probation', 'num'], ['conf', 'Days when confirmed', 'num']],
  seg: [['level', 'Level', 'text'], ['dept', 'Department', 'text'], ['start', 'Notice starts from', Object.keys(o.start), Object.values(o.start)]],
  approvals: [['action', 'Request', 'text', 'w12'], ['level', 'Level', 'text'], ['dept', 'Department', 'text'], ['type', 'Type id (or Any)', 'text'], ['over', 'Amount over (₹)', 'num'], ['chain', 'Approvers (A > B, or A + B)', 'text', 'w14'], ['mode', 'Mode', ['Sequential', 'Parallel']], ['sla', 'Reply within (h)', 'num'], ['delegate', 'If no reply, ask', 'text']],
  people: [['role', 'Role', 'text'], ['contact', 'Person (Name <email>)', 'text', 'w20']],
  owners: [['area', 'Area', 'text'], ['owner', 'Owner', 'text'], ['contact', 'Email (Name <email>)', 'text', 'w16'], ['channel', 'Channel', o.channels], ['sla', 'SLA (h)', 'num'], ['items', 'What they clear', 'text', 'w20']],
  steps: [['on', 'On', 'chk'], ['stage', 'Stage', o.stages.map(s => s[0]), o.stages.map(s => s[1])], ['title', 'Step', 'text', 'w16'], ['to', 'To', o.recipients], ['channel', 'Channel', o.channels], ['anchor', 'Counted from', Object.keys(o.anchors), Object.values(o.anchors)], ['day', 'Day', 'num'], ['time', 'Time', 'text', 'w5'], ['when', 'For', Object.keys(o.when), Object.values(o.when)], ['text', 'Message', 'area']]
});

function cellInput(path, i, col, val) {
  const [k, , type, extra] = col;
  const attr = `data-p="${path}" data-i="${i}" data-k="${k}"`;
  if (type === 'chk') return `<input type="checkbox" ${attr} ${val ? 'checked' : ''}>`;
  if (type === 'num') return `<input type="number" ${attr} value="${esc(val)}" class="ex-num">`;
  if (type === 'area') return `<textarea ${attr} rows="2">${esc(val)}</textarea>`;
  if (Array.isArray(type)) { const labels = Array.isArray(extra) ? extra : type; return `<select ${attr}>${type.map((v, j) => `<option value="${esc(v)}" ${v === val ? 'selected' : ''}>${esc(labels[j])}</option>`).join('')}</select>`; }
  return `<input type="text" ${attr} value="${esc(val)}" class="${esc(extra || '')}">`;
}

function table(path, rows, cols) {
  return `<div class="tscroll"><table class="ex-tbl ex-edit"><tr>${cols.map(c => `<th>${esc(c[1])}</th>`).join('')}<th></th></tr>${rows.map((r, i) => `<tr>${cols.map(c => `<td>${cellInput(path, i, c, r[c[0]])}</td>`).join('')}<td><button class="btn small" type="button" data-del="${path}" data-i="${i}" title="Remove">✕</button></td></tr>`).join('')}</table></div>
    <button class="btn small" type="button" data-add="${path}">+ Add row</button>`;
}

function getList(path) { return path === 'seg' ? draftSetup.noticeStart.seg : draftSetup[path]; }

function renderSetup() {
  const sec = $('#ex-setup');
  if (!setupRec) { sec.innerHTML = '<div class="card">Exit setup could not be loaded.</div>'; return; }
  if (!draftSetup || draftSetup._client !== client()) draftSetup = Object.assign(JSON.parse(JSON.stringify(setupRec.setup)), { _client: client() });
  const o = setupRec.options, c = COLS(o), s = draftSetup;
  sec.innerHTML = `<div class="intro"><div><h2>Exit setup · ${esc(ctx.clientLabel())}</h2><p>Every client starts from the TCMPL default and changes only what differs. Changes apply to new cases. ${setupRec.isDefault ? '<b>This client uses the TCMPL default.</b>' : `Saved ${fmtDT(setupRec.updated)}.`}</p></div>
      <div class="row"><button class="btn primary" id="exSave" type="button">Save exit setup</button><button class="btn" id="exReset" type="button">Reset to TCMPL default</button><span class="note" id="exSaveState"></span></div></div>
    <details class="card ex-det" open><summary>Company and contacts</summary><div class="ex-form">
      ${[['company', 'Company name used in messages'], ['hr', 'HR (gets red-item alerts)'], ['replyTo', 'Reply-to on emails'], ['cc', 'CC on every email'], ['payroll', 'Payroll (F&F)'], ['recruitment', 'Recruitment (vacancies)']].map(([k, l]) => `<label>${esc(l)}<input type="text" data-c="${k}" value="${esc(s.contacts[k])}"></label>`).join('')}</div></details>
    <details class="card ex-det"><summary>Separation types</summary><p class="note">Who can raise: any of Employee, Manager, HR, separated by commas.</p>${table('types', s.types, c.types)}</details>
    <details class="card ex-det"><summary>Notice period</summary>
      <div class="ex-form"><label>Probation (months)<input type="number" id="exProb" value="${esc(s.probationMonths)}" class="ex-num"></label>
      <label>Notice starts from (company-wide)<select id="exNsCo">${Object.entries(o.start).map(([k, v]) => `<option value="${k}" ${k === s.noticeStart.company ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
      <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="exNsCase" ${s.noticeStart.allowCase ? 'checked' : ''}> HR may change it for one case</label></div>
      <h4>Notice days by level and department (the most specific rule wins)</h4>${table('noticeRules', s.noticeRules, c.noticeRules)}
      <h4>Notice start by level and department</h4>${table('seg', s.noticeStart.seg, c.seg)}</details>
    <details class="card ex-det"><summary>Approval rules</summary><p class="note">The most specific rule wins (level, department, type, amount). "Manager" is always the employee's own manager.</p>${table('approvals', s.approvals, c.approvals)}
      <h4>People behind the roles</h4>${table('people', s.people, c.people)}</details>
    <details class="card ex-det"><summary>Clearance owners</summary>${table('owners', s.owners, c.owners)}</details>
    <details class="card ex-det"><summary>Journey steps (who gets what, when, on which channel)</summary><p class="note">Day is counted from the anchor: −14 with "Last working day" means two weeks before the last day. Placeholders: {first} {name} {code} {designation} {dept} {location} {company} {type} {formal} {lwd} {notice} {manager} {replace}.</p>${table('steps', s.steps, c.steps)}</details>
    <details class="card ex-det"><summary>F&F, interview and alumni</summary><div class="ex-form">
      <label>F&F approver<input type="text" data-g="fnf.approver" value="${esc(s.fnf.approver)}"></label>
      <label>Wages paid within (working days)<input type="number" data-g="fnf.wageDays" value="${esc(s.fnf.wageDays)}" class="ex-num"></label>
      <label>Gratuity after (years)<input type="number" data-g="fnf.gratYears" value="${esc(s.fnf.gratYears)}" class="ex-num"></label>
      <label>Gratuity paid within (days)<input type="number" data-g="fnf.gratDays" value="${esc(s.fnf.gratDays)}" class="ex-num"></label>
      <label>Interview reports: smallest group shown<input type="number" data-g="interview.threshold" value="${esc(s.interview.threshold)}" class="ex-num"></label>
      <label>Alumni: leave out<input type="text" data-g="alumni.exclude" value="${esc(s.alumni.exclude)}"></label>
      <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-g="alumni.on" ${s.alumni.on ? 'checked' : ''}> Alumni network on</label></div></details>`;

  sec.querySelectorAll('[data-p]').forEach(el => el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
    const row = getList(el.dataset.p)[+el.dataset.i];
    row[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
  }));
  sec.querySelectorAll('[data-c]').forEach(el => el.addEventListener('input', () => { s.contacts[el.dataset.c] = el.value; }));
  sec.querySelectorAll('[data-g]').forEach(el => el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
    const [a, b] = el.dataset.g.split('.');
    s[a][b] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
  }));
  $('#exProb').oninput = e => { s.probationMonths = Number(e.target.value); };
  $('#exNsCo').onchange = e => { s.noticeStart.company = e.target.value; };
  $('#exNsCase').onchange = e => { s.noticeStart.allowCase = e.target.checked; };
  sec.querySelectorAll('[data-del]').forEach(b => { b.onclick = () => { getList(b.dataset.del).splice(+b.dataset.i, 1); keepOpen(renderSetup); }; });
  sec.querySelectorAll('[data-add]').forEach(b => { b.onclick = () => { getList(b.dataset.add).push(blankRow(b.dataset.add)); keepOpen(renderSetup); }; });
  $('#exSave').onclick = saveSetup;
  $('#exReset').onclick = async () => {
    if (!window.confirm(`Reset ${ctx.clientLabel()}'s exit setup to the TCMPL default? Saved changes for this client are removed.`)) return;
    const r = await post('setup-reset', { client: client() });
    if (r.ok) { draftSetup = null; await refresh(); toast('Exit setup is back on the TCMPL default.'); } else $('#exSaveState').textContent = 'Not reset.';
  };
}

function keepOpen(fn) {
  const open = $$('#ex-setup details').map(d => d.open);
  fn();
  $$('#ex-setup details').forEach((d, i) => { d.open = Boolean(open[i]); });
}

function blankRow(path) {
  const n = Date.now().toString(36);
  return ({
    types: { id: 't' + n, name: 'New type', cat: 'Voluntary', raise: 'HR', notice: 'Serve notice', announce: 'None', ta: 'After manager confirms', interview: false, alumni: false, letters: '' },
    noticeRules: { id: 'n' + n, level: 'Any', dept: 'Any', prob: 30, conf: 60 },
    seg: { id: 's' + n, level: 'Any', dept: 'Any', start: 'formal' },
    approvals: { id: 'a' + n, action: 'Accept resignation', level: 'Any', dept: 'Any', type: 'Any', over: 0, chain: 'Manager', mode: 'Sequential', sla: 48, delegate: 'HR business partner' },
    people: { id: 'p' + n, role: 'New role', contact: '' },
    owners: { id: 'o' + n, area: 'New area', owner: '', contact: '', channel: 'email', sla: 48, items: '' },
    steps: { key: 'step' + n, on: true, stage: 'raised', title: 'New step', to: 'employee', channel: 'whatsapp', anchor: 'formal', day: 0, time: '11:00', when: 'all', text: '' }
  })[path];
}

async function saveSetup() {
  const btn = $('#exSave'); btn.disabled = true; $('#exSaveState').textContent = 'Saving…';
  const body = Object.assign({}, draftSetup); delete body._client;
  const r = await post('setup-save', { client: client(), setup: body });
  btn.disabled = false;
  if (!r.ok) { $('#exSaveState').textContent = 'Not saved.'; return; }
  setupRec = Object.assign({}, setupRec, { setup: r.body.setup, isDefault: false, updated: r.body.updated });
  draftSetup = Object.assign(JSON.parse(JSON.stringify(r.body.setup)), { _client: client() });
  keepOpen(renderSetup);
  $('#exSaveState').textContent = 'Saved · applies to new cases';
}
