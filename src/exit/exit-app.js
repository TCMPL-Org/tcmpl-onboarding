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
  attrition: ['Attrition rate, cost of attrition and early warning need the headcount and pay of everyone who stays, so they come with the HRMS headcount feed.', 'Tenure at exit, exits per month and by department are already on the HR dashboard.']
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
  if (k === 'clear') renderClear();
  if (k === 'approvals') renderApprovals();
  if (k === 'interviews') renderInterviews();
  if (k === 'dashboard') renderDashboard();
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
  if (k.status === 'intent') return 'Thinking of leaving (private)';
  if (k.status === 'cancelled') return 'Cancelled';
  if (k.status === 'closed') return 'Closed';
  const st = (setupRec && setupRec.options.stages) || [];
  const s = k.next ? st.find(x => x[0] === k.next.stage) : null;
  return s ? s[1] : 'All steps done';
}

function renderCases() {
  const t = $('#exCases'); if (!t) return;
  const all = $('#exShowAll') && $('#exShowAll').checked;
  const list = cases.filter(k => all || k.status === 'open' || k.status === 'intent');
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
  sec.innerHTML = `<div class="intro"><div><h2>Case journey</h2><p>Every step of the case on one screen, grouped by stage, with today marked. Send a step on WhatsApp and email, or let Exit setup send due steps by themselves. Approvers and clearance owners answer with one click in their email.</p></div>
    <div class="row"><select id="exPick">${cases.map(k => `<option value="${esc(k.id)}" ${k.id === curId ? 'selected' : ''}>${esc(k.name)} · ${esc(k.typeName)} · ${fmtD(k.lwd)}${k.status !== 'open' ? ' (' + k.status + ')' : ''}</option>`).join('')}</select></div></div>
    <div id="exCase">${curId ? '<div class="note">Loading…</div>' : '<div class="card note">No cases yet. Raise one on the Exit desk.</div>'}</div>`;
  if ($('#exPick')) $('#exPick').onchange = () => { curId = $('#exPick').value; renderJourney(); };
  if (!curId) return;
  const r = await post('case', { id: curId });
  if (!r.ok) { $('#exCase').innerHTML = '<div class="card">This case could not be loaded.</div>'; return; }
  drawCase(r.body);
}

const CH = { both: 'WhatsApp and email', whatsapp: 'WhatsApp', email: 'Email' };
const ST = { planned: 'planned', due: 'due', sent: 'sent', held: 'held for reply', failed: 'not sent', missed: 'missed', done: 'done', skipped: 'skipped' };

function drawCase(data) {
  const k = data.case, msgs = data.messages || [], today = data.today || todayIso();
  const e = k.employee || {}, isOpen = k.status === 'open', auto = Boolean(setupRec && setupRec.setup.sending && setupRec.setup.sending.auto);
  const stages = setupRec ? setupRec.options.stages : [];
  let todayShown = false;
  const plan = stages.map(([key, label]) => {
    const steps = (k.plan || []).filter(s => s.stage === key);
    if (!steps.length) return '';
    return `<div class="ex-stage"><h4>${esc(label)}</h4>${steps.map(s => {
      let line = '';
      if (!todayShown && s.date > today) { todayShown = true; line = `<div class="ex-today">Today · ${fmtD(today)}</div>`; }
      const canSend = isOpen && ['planned', 'due', 'failed', 'missed', 'held'].includes(s.status);
      return `${line}<div class="ex-step ex-${esc(s.status)}"><div class="ex-when">${fmtD(s.date)}<span>${esc(s.time)}</span></div>
        <div><b>${esc(s.title)}</b><div class="note">To ${esc(s.to)} · ${esc(CH[s.channel] || s.channel)}</div>
          ${s.note ? `<div class="note ex-stepnote">${esc(s.note)}${s.at ? ' · ' + fmtDT(s.at) : ''}</div>` : ''}
          ${isOpen ? `<div class="ex-stepbtns">${canSend ? `<button class="btn small primary" type="button" data-send="${esc(s.key)}">Send now</button>` : ''}${!['done', 'skipped'].includes(s.status) ? `<button class="btn small" type="button" data-mark="${esc(s.key)}" data-v="done">Mark done</button><button class="btn small" type="button" data-mark="${esc(s.key)}" data-v="skipped">Skip</button>` : `<button class="btn small" type="button" data-mark="${esc(s.key)}" data-v="planned">Undo</button>`}</div>` : ''}</div>
        <span class="chip">${esc(ST[s.status] || s.status)}</span></div>`;
    }).join('')}</div>`;
  }).join('') + (todayShown ? '' : `<div class="ex-today">Today · ${fmtD(today)}</div>`);
  const alerts = (k.alerts || []).map((a, i) => ({ a, i })).filter(x => x.a.open);
  const owners = (setupRec && setupRec.setup.owners) || [];
  const clr = k.clearances || {};
  const chainTxt = a => a.chain.map(s => `${esc(s.person && s.person !== s.role ? `${s.person} (${s.role})` : s.role)} <span class="chip${s.status === 'Approved' ? ' ex-green' : s.status === 'Rejected' ? ' ex-red' : s.status === 'Asked' ? ' ex-amber' : ''}">${esc(s.status)}</span>`).join(a.mode === 'Parallel' ? ' + ' : ' → ');
  $('#exCase').innerHTML = `${isOpen ? `<div class="card ex-walk"><b>Walkthrough clock</b>${data.clock ? ` <span class="chip ex-amber">Case clock: ${esc(fmtDT(data.clock))}</span>` : ' <span class="note">real time</span>'}
      <span class="row" style="gap:6px;flex-wrap:wrap"><select id="exWAnchor"><option value="formal">Formal date</option><option value="lwd">Last working day</option></select>
      <label class="note">day <input type="number" id="exWDay" value="0" class="ex-num"></label><input type="text" id="exWTime" value="10:30" style="width:64px">
      <button class="btn small" type="button" data-walk="jump">Jump</button><button class="btn small primary" type="button" data-walk="run">Run due steps</button>
      <button class="btn small" type="button" data-walk="realtime">Back to real time</button><button class="btn small" type="button" data-walk="reset">Reset case</button></span>
      <span class="note">Auto-send is ${auto ? '<b>on</b>: due steps go out by themselves between 8 am and 9 pm' : '<b>off</b>: HR sends each step (switch it on in Exit setup)'}.</span></div>` : ''}
    <div class="ex-grid">
    <div>
      ${alerts.length ? `<div class="card ex-redcard"><h3>Needs HR</h3>${alerts.map(({ a, i }) => `<div class="row" style="justify-content:space-between;gap:8px;margin:4px 0"><span>${esc(a.why)} <span class="note">${fmtDT(a.at)}${a.alertedAt ? ' · HR emailed' : ''}</span></span><button class="btn small" data-close="${i}" type="button">Done</button></div>`).join('')}</div>` : ''}
      <div class="card"><h3>Steps</h3>${plan || '<p class="note">No steps apply to this case.</p>'}</div>
    </div>
    <div>
      <div class="card"><h3>Case facts</h3><dl class="ex-dl">
        <dt>Employee</dt><dd>${esc(e.name)}${e.code ? ' · ' + esc(e.code) : ''}<div class="note">${esc([e.designation, e.dept, e.level, e.location].filter(Boolean).join(' · '))}</div></dd>
        <dt>Contact</dt><dd>${esc(e.phone ? '+' + e.phone : 'no mobile')}${e.email ? '<br>' + esc(e.email) : ''}</dd>
        <dt>Manager</dt><dd>${esc(e.manager || '')}${e.managerEmail ? '<br>' + esc(e.managerEmail) : '<div class="note">no email: approvals and handover cannot be sent</div>'}</dd>
        <dt>Type</dt><dd>${esc(k.typeName)} · ${esc(k.category)} · raised by ${esc(k.raisedBy)} (${esc(k.source)})</dd>
        <dt>Formal date</dt><dd>${fmtD(k.formal)}${k.first && k.first.slice(0, 10) !== k.formal ? ` <span class="note">(first told manager ${fmtD(k.first)})</span>` : ''}</dd>
        <dt>Notice</dt><dd>${k.noticeDays ? `${k.noticeDays} days · ${esc(k.noticeRule)}<div class="note">from ${fmtD(k.noticeStart)} · ${esc(k.noticeStartRule)}</div>` : esc(k.noticeText)}</dd>
        <dt>Last working day</dt><dd><b>${fmtD(k.lwd)}</b>${k.waiverDays ? ` <span class="note">(${k.waiverDays} days' waiver asked; as per notice ${fmtD(k.noticeLwd)})</span>` : ''}</dd>
        <dt>Approvals</dt><dd>${(k.approvals || []).map(a => `<div style="margin-bottom:6px">${esc(a.action)}: <b>${esc(a.status)}</b><div class="note">${chainTxt(a) || 'no rule'}</div></div>`).join('') || 'None'}</dd>
        <dt>Clearances</dt><dd>${owners.map(o => { const c = clr[o.id] || {}; return `<span class="chip${c.status === 'cleared' ? ' ex-green' : c.status === 'issue' ? ' ex-red' : ''}" title="${esc(o.items)}">${esc(o.area)}: ${esc(c.status === 'cleared' ? 'cleared' : c.status === 'issue' ? 'pending item' : c.askedAt ? 'asked' : 'not started')}</span>`; }).join(' ')}</dd>
        <dt>Announcement</dt><dd>${esc(k.announce)}</dd><dt>Recruitment</dt><dd>${esc(k.ta)} · ${esc(k.replace)}</dd>
        ${k.reason ? `<dt>Reason</dt><dd>${esc(k.reason)}</dd>` : ''}
        <dt>Assets declared</dt><dd>${(k.assets || []).length ? k.assets.map((a, i) => `<div>${esc(a.caption || 'Item ' + a.n)} <span class="note">${fmtDT(a.at)}</span>${a.path ? ` <button class="btn small" type="button" data-asset="${i}">View</button>` : a.error ? ` <span class="note">(${esc(a.error)})</span>` : ''}</div>`).join('') : k.assetsDone ? 'None (employee said so)' : '<span class="note">none yet; the employee sends photos on WhatsApp</span>'}${k.assetsDone && (k.assets || []).length ? '<div class="note">employee said that is everything</div>' : ''}</dd>
        <dt>Exit interview</dt><dd>${k.interview ? (k.interview.status === 'done' ? 'Completed' : `In progress (question ${k.interview.i + 1})`) : '<span class="note">not started</span>'}</dd>
        <dt>Alumni</dt><dd>${k.alumni ? esc({ asked: 'Invited', joined: 'Joined', declined: 'Declined' }[k.alumni.status] || k.alumni.status) : '<span class="note">not invited</span>'}</dd>
        ${k.status === 'intent' ? `<dt>Private conversation</dt><dd>${esc({ menu: 'Choosing how to go ahead', told: 'Asked when the manager was told', lwd: 'Asked about the last day', hr: 'Waiting for a confidential HR call' }[k.intent.step] || k.intent.step)}<div class="note">First message: "${esc(k.intent.firstText || '')}"</div></dd>` : ''}
        <dt>Status</dt><dd>${esc(k.status)}${(k.held || []).length ? ` · ${k.held.length} WhatsApp message${k.held.length > 1 ? 's' : ''} waiting for the employee to write` : ''}</dd></dl>
        ${isOpen ? '<div class="row" style="margin-top:10px"><button class="btn small" id="exCancel" type="button">Cancel this case</button></div>' : ''}</div>
      <div class="card" style="margin-top:16px"><h3>WhatsApp with ${esc((e.name || '').split(' ')[0] || 'the employee')}</h3>
        ${msgs.length ? `<div class="ex-msgs">${msgs.map(m => `<div class="ex-msg ${m.direction === 'in' ? 'ex-in' : 'ex-out'}">${esc(m.text)}<span>${fmtDT(m.at)}${m.by ? ' · ' + esc(m.by) : ''}${m.error ? ' · ' + esc(m.error) : ''}</span></div>`).join('')}</div>` : '<p class="note">No messages yet. When the employee writes to the HR WhatsApp number, it shows here and HR is alerted.</p>'}
        ${isOpen && e.phone ? '<form class="row ex-reply" id="exReply" style="margin-top:8px;gap:6px"><input type="text" id="exReplyText" placeholder="Reply as HR (sent on WhatsApp)…" style="flex:1;min-width:0"><button class="btn small primary" type="submit">Send</button></form>' : ''}</div>
      <div class="card" style="margin-top:16px"><h3>Activity</h3>${(k.log || []).slice().reverse().map(l => `<div class="ex-log"><span class="note">${fmtDT(l.at)} · ${esc(l.by)}</span><br>${esc(l.text)}</div>`).join('')}</div>
    </div></div>`;

  const busy = async (btn, fn) => { if (btn) btn.disabled = true; try { await fn(); } finally { if (btn) btn.disabled = false; } };
  const after = async (x, okText) => {
    if (!x.ok) { toast(x.body.error === 'exit_off_for_client' ? 'Exit is off for this client.' : x.body.error === 'not_open' ? 'This case is closed.' : 'Not done.'); return; }
    if (okText) toast(okText);
    await loadCases();
    const c = await post('case', { id: k.id });
    if (c.ok) drawCase(c.body);
  };
  $$('#exCase [data-asset]').forEach(b => { b.onclick = async () => {
    const x = await post('asset', { id: k.id, index: Number(b.dataset.asset) });
    if (!x.ok) { toast('The file could not be opened.'); return; }
    const bin = atob(x.body.base64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    window.open(URL.createObjectURL(new Blob([bytes], { type: x.body.mime })), '_blank', 'noopener');
  }; });
  $$('#exCase [data-close]').forEach(b => { b.onclick = () => busy(b, async () => after(await post('alert-close', { id: k.id, index: Number(b.dataset.close) }))); });
  $$('#exCase [data-send]').forEach(b => { b.onclick = () => busy(b, async () => { const x = await post('send', { id: k.id, key: b.dataset.send }); await after(x, x.ok ? `${x.body.result.status === 'sent' ? 'Sent' : x.body.result.status === 'held' ? 'Held until the employee writes' : 'Not sent'}: ${(x.body.result.notes || []).join(' · ')}` : ''); }); });
  $$('#exCase [data-mark]').forEach(b => { b.onclick = () => busy(b, async () => after(await post('step', { id: k.id, key: b.dataset.mark, status: b.dataset.v }))); });
  $$('#exCase [data-walk]').forEach(b => { b.onclick = () => busy(b, async () => {
    const a = b.dataset.walk;
    if (a === 'reset' && !window.confirm('Reset this case for a new walkthrough? All step statuses, approvals, clearances and its WhatsApp messages are cleared.')) return;
    const x = await post('walk', { id: k.id, action: a, anchor: $('#exWAnchor').value, day: Number($('#exWDay').value), time: $('#exWTime').value });
    await after(x, a === 'run' && x.ok ? `${x.body.sent} step${x.body.sent === 1 ? '' : 's'} sent.` : '');
  }); });
  if ($('#exReply')) $('#exReply').onsubmit = ev => { ev.preventDefault(); const t = $('#exReplyText').value.trim(); if (!t) return; busy(null, async () => { const x = await post('reply', { id: k.id, text: t }); await after(x, x.ok ? (x.body.result.ok ? 'Sent on WhatsApp.' : x.body.result.held ? 'Held until the employee writes (24-hour window closed).' : 'Not sent: ' + (x.body.result.note || '')) : ''); }); };
  if ($('#exCancel')) $('#exCancel').onclick = async () => {
    const why = window.prompt('Why is this case cancelled? (e.g. resignation withdrawn)');
    if (why === null) return;
    const x = await post('cancel', { id: k.id, reason: why });
    if (x.ok) { toast('Case cancelled.'); await loadCases(); renderJourney(); } else toast('Not cancelled.');
  };
}

/* ---------------- 3 · Approvals ---------------- */
async function renderApprovals() {
  const sec = $('#ex-approvals');
  const actions = [...new Set(((setupRec && setupRec.setup.approvals) || []).map(a => a.action))];
  sec.innerHTML = `<div class="intro"><div><h2>Approvals</h2><p>Every approval waiting across ${esc(ctx.clientLabel())}'s cases. Approvers answer with one click in their email; after the reply time the rule's delegate is asked and HR is told. HR can remind, or record a decision given on a call.</p></div></div>
    <div class="card"><div class="row" style="justify-content:space-between"><h3 style="margin:0">Waiting for a decision</h3><button class="btn small" id="exApRefresh" type="button">Refresh</button></div><div id="exApList" class="note" style="margin-top:8px">Loading…</div></div>
    <div class="card" style="margin-top:16px"><h3>Who approves?</h3><p class="note">Test any combination against this client's rules in Exit setup.</p>
      <div class="ex-form"><label>Request<select id="exWhoAct">${actions.map(a => `<option>${esc(a)}</option>`).join('')}</select></label>
        <label>Level<input type="text" id="exWhoLvl" placeholder="L3"></label><label>Department<input type="text" id="exWhoDept" placeholder="Sales"></label>
        <label>Separation type<select id="exWhoType"><option value="Any">Any</option>${((setupRec && setupRec.setup.types) || []).map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select></label>
        <label>Amount (₹, for recoveries)<input type="number" id="exWhoAmt" value="0"></label></div>
      <div id="exWhoOut" class="note" style="margin-top:8px"></div></div>`;
  $('#exApRefresh').onclick = loadApprovals;
  const who = async () => {
    const r = await post('who', { client: client(), action: $('#exWhoAct').value, level: $('#exWhoLvl').value, dept: $('#exWhoDept').value, typeId: $('#exWhoType').value, amount: Number($('#exWhoAmt').value) });
    if (!r.ok) return;
    $('#exWhoOut').innerHTML = r.body.rule ? `<b>${r.body.chain.map(s => esc(s.person && s.person !== s.role ? `${s.person} (${s.role})` : s.role)).join(r.body.rule.mode === 'Parallel' ? ' + ' : ' → ')}</b> · reply within ${r.body.rule.sla} h, then ${esc(r.body.rule.delegate || 'HR')} is asked <span class="note">(rule: ${esc([r.body.rule.level, r.body.rule.dept, r.body.rule.type].join(' · '))}${r.body.rule.over ? ', over ₹' + r.body.rule.over : ''})</span>` : 'No rule matches: HR decides.';
  };
  ['#exWhoAct', '#exWhoLvl', '#exWhoDept', '#exWhoType', '#exWhoAmt'].forEach(q => $(q).addEventListener('input', who));
  who();
  loadApprovals();
}

async function loadApprovals() {
  const box = $('#exApList'); if (!box) return;
  const r = await post('approvals', { client: client() });
  if (!r.ok) { box.textContent = 'Could not load.'; return; }
  const items = r.body.items || [];
  box.classList.toggle('note', !items.length);
  box.innerHTML = items.length ? `<div class="tscroll"><table class="ex-tbl"><tr><th>Employee</th><th>Request</th><th>Chain</th><th>Waiting since</th><th></th></tr>${items.map(x => `<tr>
      <td><b>${esc(x.name)}</b><div class="note">${esc(x.typeName)} · last day ${fmtD(x.lwd)}${x.waiverDays ? ` · ${x.waiverDays} days' waiver` : ''}</div></td>
      <td>${esc(x.action)}</td>
      <td>${x.chain.map(s => `${esc(s.person && s.person !== s.role ? s.person : s.role)} <span class="chip${s.status === 'Approved' ? ' ex-green' : s.status === 'Asked' ? ' ex-amber' : ''}">${esc(s.status)}</span>`).join(x.mode === 'Parallel' ? ' + ' : ' → ')}</td>
      <td>${x.notAsked ? '<span class="note">not asked yet (send "Ask the approvers" in Case journey)</span>' : fmtDT(x.since)}${x.overdue ? ' <span class="chip ex-red">overdue</span>' : ''}</td>
      <td><div class="ex-stepbtns"><button class="btn small" type="button" data-rem="${esc(x.approvalId)}" data-c="${esc(x.caseId)}">Remind</button><button class="btn small" type="button" data-dec="yes" data-a="${esc(x.approvalId)}" data-c="${esc(x.caseId)}">Approve</button><button class="btn small" type="button" data-dec="no" data-a="${esc(x.approvalId)}" data-c="${esc(x.caseId)}">Reject</button><button class="btn small" type="button" data-open="${esc(x.caseId)}">Open case</button></div></td></tr>`).join('')}</table></div>` : 'Nothing is waiting for approval.';
  $$('#exApList [data-rem]').forEach(b => { b.onclick = async () => { b.disabled = true; const x = await post('approval-remind', { id: b.dataset.c, approvalId: b.dataset.rem }); toast(x.ok ? ((x.body.notes || []).join(' · ') || 'Reminded.') : 'Not sent.'); loadApprovals(); }; });
  $$('#exApList [data-dec]').forEach(b => { b.onclick = async () => {
    const note = window.prompt(b.dataset.dec === 'yes' ? 'Approve on behalf of the approvers. Note (e.g. "approved by Priya on call"):' : 'Reject. Reason:');
    if (note === null) return;
    const x = await post('approval-decide', { id: b.dataset.c, approvalId: b.dataset.a, decision: b.dataset.dec, note });
    toast(x.ok ? 'Decision recorded.' : 'Not recorded.'); await loadCases(); loadApprovals();
  }; });
  $$('#exApList [data-open]').forEach(b => { b.onclick = () => { curId = b.dataset.open; show('journey'); }; });
}

/* ---------------- 5 · Interviews and alumni ---------------- */
async function renderInterviews() {
  const sec = $('#ex-interviews');
  sec.innerHTML = `<div class="intro"><div><h2>Exit interviews and alumni</h2><p>Interviews run on WhatsApp, one question at a time. Reports are anonymous: any group smaller than the minimum in Exit setup is hidden.</p></div></div>
    <div class="card"><div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px"><h3 style="margin:0">What leavers say</h3>
      <label class="note">Group by <select id="exIvBy"><option value="dept">Department</option><option value="manager">Manager</option><option value="location">Location</option><option value="level">Level</option><option value="category">Category</option></select></label></div>
      <div id="exIvOut" class="note" style="margin-top:8px">Loading…</div></div>
    <div class="ex-grid" style="margin-top:16px">
      <div class="card"><div class="row" style="justify-content:space-between"><h3 style="margin:0">Alumni network</h3><button class="btn small" id="exAlCsv" type="button">Download CSV</button></div><div id="exAlList" class="note" style="margin-top:8px">Loading…</div></div>
      <div class="card"><h3>Share a job with alumni</h3><div class="ex-form"><label>Role<input type="text" id="exJobRole" placeholder="Area Sales Manager"></label><label>Location<input type="text" id="exJobLoc" placeholder="Pune"></label><label class="ex-wide">Link or details<input type="text" id="exJobLink" placeholder="https://…"></label></div>
        <div class="row" style="margin-top:8px"><button class="btn small primary" id="exJobSend" type="button">Send to alumni</button><span class="note" id="exJobState">By email. WhatsApp needs an approved template (WHATSAPP_ALUMNI_TEMPLATE).</span></div></div></div>`;
  $('#exIvBy').onchange = loadInterviews;
  $('#exJobSend').onclick = async () => {
    const role = $('#exJobRole').value.trim(); if (!role) { toast('Add the role.'); return; }
    const r = await post('alumni-share', { client: client(), role, location: $('#exJobLoc').value, link: $('#exJobLink').value });
    $('#exJobState').textContent = r.ok ? `Sent to ${r.body.emails} of ${r.body.alumni} alumni by email${r.body.whatsappTemplate ? `, ${r.body.whatsapps} on WhatsApp` : ''}.` : 'Not sent.';
  };
  loadInterviews();
  const a = await post('alumni', { client: client() });
  const list = a.ok ? a.body.items || [] : [];
  $('#exAlList').classList.toggle('note', !list.length);
  $('#exAlList').innerHTML = list.length ? `<table class="ex-tbl"><tr><th>Name</th><th>Role</th><th>Left</th><th>Joined</th></tr>${list.map(x => `<tr><td>${esc(x.name)}<div class="note">${esc(x.email || '')}</div></td><td>${esc([x.designation, x.dept].filter(Boolean).join(', '))}</td><td>${fmtD(x.lwd)}</td><td class="note">${fmtD((x.joinedAt || '').slice(0, 10))}</td></tr>`).join('')}</table>` : 'No alumni yet. Leavers are invited with the "Alumni invitation" step and join by replying YES.';
  $('#exAlCsv').onclick = () => download(`Alumni_${client()}.csv`, toCsv([['Name', 'Mobile', 'Email', 'Designation', 'Department', 'Location', 'Last working day', 'Joined', 'Consent']].concat(list.map(x => [x.name, x.phone, x.email, x.designation, x.dept, x.location, x.lwd, x.joinedAt, x.consent]))));
}

async function loadInterviews() {
  const r = await post('interviews', { client: client(), groupBy: $('#exIvBy').value });
  const box = $('#exIvOut'); if (!r.ok || !box) return;
  const d = r.body;
  if (!d.total) { box.textContent = 'No exit interviews completed yet.'; return; }
  const qs = d.questions || [];
  const cell = (q, v) => v == null ? '–' : Array.isArray(v) ? v.map(([k, n]) => `${esc(k)} (${n})`).join(', ') : q.type === 'open' ? `${v} answers` : esc(v);
  box.classList.toggle('note', !d.groups.length);
  box.innerHTML = (d.groups.length ? `<div class="tscroll"><table class="ex-tbl"><tr><th>${esc({ dept: 'Department', manager: 'Manager', location: 'Location', level: 'Level', category: 'Category' }[d.groupBy])}</th><th>People</th>${qs.map(q => `<th title="${esc(q.q)}">${esc(q.q.length > 34 ? q.q.slice(0, 32) + '…' : q.q)}</th>`).join('')}</tr>
      ${d.groups.map(g => `<tr><td><b>${esc(g.group)}</b></td><td>${g.n}</td>${qs.map(q => `<td>${cell(q, g.answers[q.id])}</td>`).join('')}</tr>`).join('')}</table></div>` : '')
    + `<p class="note">${d.total} interview${d.total > 1 ? 's' : ''} in all.${d.hiddenGroups ? ` ${d.hiddenGroups} group${d.hiddenGroups > 1 ? 's' : ''} (${d.hiddenPeople} people) hidden: fewer than ${d.threshold} people.` : ''} Ratings are averages.</p>`;
}

/* ---------------- 6 · HR dashboard ---------------- */
function bars(rows, opts = {}) {
  if (!rows.length) return '<p class="note">No data yet.</p>';
  const max = Math.max(1, ...rows.map(r => r[1]));
  return `<div class="ex-bars">${rows.map(([l, v]) => `<div class="ex-bar"><span class="ex-bl" title="${esc(l)}">${esc(opts.label ? opts.label(l) : l)}</span><span class="ex-bt"><span style="width:${Math.round(100 * v / max)}%"></span></span><span class="ex-bv">${v}</span></div>`).join('')}</div>`;
}

async function renderDashboard() {
  const sec = $('#ex-dashboard');
  const months = (sec.querySelector('#exDashM') || {}).value || '12';
  sec.innerHTML = `<div class="intro"><div><h2>HR dashboard</h2><p>${esc(ctx.clientLabel())}'s exits, read from its exit cases and interviews only. Interview figures appear once a group reaches the minimum size.</p></div>
    <div class="row"><select id="exDashM">${[['3', 'Last 3 months'], ['6', 'Last 6 months'], ['12', 'Last 12 months'], ['24', 'Last 24 months']].map(([v, l]) => `<option value="${v}" ${v === months ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div><div id="exDash" class="note">Loading…</div>`;
  $('#exDashM').onchange = renderDashboard;
  const r = await post('dashboard', { client: client(), months: Number(months) });
  if (!r.ok) { $('#exDash').textContent = 'Could not load.'; return; }
  const d = r.body, t = d.tiles, iv = d.interviews;
  const tile = (v, l, warn) => `<div class="ex-tile${warn ? ' ex-warn' : ''}"><b>${v == null ? '–' : v}</b><span>${esc(l)}</span></div>`;
  $('#exDash').classList.remove('note');
  $('#exDash').innerHTML = `<div class="ex-tiles">${tile(t.open, 'Open cases')}${tile(t.leaving30, 'Leaving in the next 30 days')}${tile(t.exits, 'Exits in the period')}${tile(t.voluntaryPct + '%', 'Voluntary')}
      ${tile(t.pendingApprovals, 'Approvals waiting', t.pendingApprovals > 0)}${tile(t.red, 'Items needing HR', t.red > 0)}${tile(t.fnfOnTimePct == null ? null : t.fnfOnTimePct + '%', 'F&F wages paid on time', t.fnfOnTimePct != null && t.fnfOnTimePct < 100)}
      ${tile(t.thinking, 'Thinking of leaving (private)', t.thinking > 0)}${tile(t.interviews, 'Exit interviews')}${tile(t.alumni, 'Alumni')}</div>
    <div class="ex-grid" style="margin-top:16px">
      <div class="card"><h3>Exits per month (by last working day)</h3>${bars(d.perMonth, { label: m => { const [y, mo] = m.split('-'); return MON[+mo - 1] + ' ' + y.slice(2); } })}</div>
      <div class="card"><h3>By department</h3>${bars(d.byDept)}</div>
      <div class="card"><h3>By separation type</h3>${bars(d.byType)}</div>
      <div class="card"><h3>Tenure at exit</h3>${bars(d.byTenure)}</div>
      <div class="card"><h3>Managers with 2 or more exits</h3>${bars(d.byManager)}</div>
      <div class="card"><h3>What leavers say</h3>${iv.n >= iv.threshold ? `<dl class="ex-dl"><dt>Overall experience</dt><dd>${iv.overall ?? '–'} / 5</dd><dt>Manager support</dt><dd>${iv.manager ?? '–'} / 5</dd><dt>Employee NPS</dt><dd>${iv.enps ?? '–'}</dd></dl><h4>Main reasons</h4>${bars(iv.reasons)}` : `<p class="note">${iv.n} interview${iv.n === 1 ? '' : 's'} in the period; figures show from ${iv.threshold}.</p>`}</div>
    </div>
    <div class="card" style="margin-top:16px"><h3>Open cases: what could go wrong</h3>${d.risks.length ? `<table class="ex-tbl"><tr><th>Employee</th><th>Last day</th><th>Needs HR</th><th>Approvals waiting</th></tr>${d.risks.map(x => `<tr class="ex-click" data-open="${esc(x.id)}"><td>${esc(x.name)}</td><td>${fmtD(x.lwd)}</td><td>${x.items || ''}</td><td>${esc(x.pending.join(', '))}</td></tr>`).join('')}</table>` : '<p class="note">Nothing at risk right now.</p>'}</div>`;
  $$('#exDash [data-open]').forEach(tr => { tr.onclick = () => { curId = tr.dataset.open; show('journey'); }; });
}

/* ---------------- 4 · Clearances and F&F ---------------- */
const inr = n => (n < 0 ? '−' : '') + '₹' + Math.round(Math.abs(Number(n) || 0)).toLocaleString('en-IN');
const FNF_FIELDS = [['gross', 'Monthly gross (₹)'], ['basic', 'Monthly basic (₹)'], ['leaveDays', 'Leave balance (days)'], ['loans', 'Loans and advances (₹)'], ['other', 'Other recoveries (₹)'], ['otherNote', 'Other recoveries: what', 'text'], ['extra', 'Other earnings (₹)'], ['extraNote', 'Other earnings: what', 'text'], ['pt', 'Professional tax (₹)'], ['tds', 'Income tax / TDS (₹)']];

async function renderClear() {
  const sec = $('#ex-clear');
  const open = cases.filter(k => k.status === 'open');
  if (!curId || !cases.some(k => k.id === curId)) curId = (open[0] || cases[0] || {}).id || '';
  sec.innerHTML = `<div class="intro"><div><h2>Clearances and F&F</h2><p>No-dues start at acceptance, not on the last day. Owners confirm with one click in their email, or HR sets the status here. The F&F is worked out from the pay figures below and the client's rules, approved by payroll by email, and paid within the legal deadline.</p></div>
    <div class="row"><select id="exPick2">${cases.map(k => `<option value="${esc(k.id)}" ${k.id === curId ? 'selected' : ''}>${esc(k.name)} · ${esc(k.typeName)} · ${fmtD(k.lwd)}${k.status !== 'open' ? ' (' + k.status + ')' : ''}</option>`).join('')}</select></div></div>
    <div id="exClr">${curId ? '<div class="note">Loading…</div>' : '<div class="card note">No cases yet. Raise one on the Exit desk.</div>'}</div>`;
  if ($('#exPick2')) $('#exPick2').onchange = () => { curId = $('#exPick2').value; renderClear(); };
  if (!curId) return;
  const r = await post('case', { id: curId });
  if (!r.ok) { $('#exClr').innerHTML = '<div class="card">This case could not be loaded.</div>'; return; }
  drawClear(r.body);
}

function drawClear(data) {
  const k = data.case, c = data.fnf, isOpen = k.status === 'open';
  const owners = (setupRec && setupRec.setup.owners) || [];
  const clr = k.clearances || {};
  const inp = (k.fnf && k.fnf.inputs) || {};
  const st = (k.fnf && k.fnf.status) || 'Not started';
  const sentLetters = k.letters || {};
  const statusChip = s => `<span class="chip${s === 'cleared' ? ' ex-green' : s === 'issue' ? ' ex-red' : ''}">${s === 'cleared' ? 'cleared' : s === 'issue' ? 'pending item' : 'open'}</span>`;
  const table = c ? `<table class="ex-tbl ex-fnf"><tr><th>Item</th><th class="ex-r">Amount</th></tr>
      ${c.earn.map(([l, v]) => `<tr><td>${esc(l)}</td><td class="ex-r">${inr(v)}</td></tr>`).join('')}
      <tr class="ex-b"><td>Total earnings</td><td class="ex-r">${inr(c.earnTotal)}</td></tr>
      ${c.ded.map(([l, v]) => `<tr><td>Less: ${esc(l)}</td><td class="ex-r">−${inr(v)}</td></tr>`).join('')}
      <tr class="ex-b"><td>Wages part (net)${c.wagesNet < 0 ? ' <span class="note">employee to pay the company</span>' : ''}</td><td class="ex-r">${inr(c.wagesNet)}</td></tr>
      ${c.gratuity ? `<tr><td>Gratuity (${c.yrs} years)</td><td class="ex-r">${inr(c.gratuity)}</td></tr>` : `<tr><td class="note" colspan="2">No gratuity: ${c.yrsExact} years of service${c.gratElig ? '' : ' (below the minimum in Exit setup)'}.</td></tr>`}
      <tr class="ex-b"><td>Net payable</td><td class="ex-r">${inr(c.net)}</td></tr></table>
      <p class="note">Wages part by <b>${fmtD(c.wageDue)}</b>${c.gratuity ? `, gratuity by <b>${fmtD(c.gratDue)}</b>` : ''}.${c.shortfall ? ` Notice: ${c.shortfall} days short, recovered.` : ''} Figures are indicative until payroll approves.</p>` : '<p class="note">The F&F needs a last working day.</p>';
  $('#exClr').innerHTML = `<div class="ex-grid">
    <div>
      <div class="card"><h3>Clearance board</h3>
        <table class="ex-tbl"><tr><th>Area</th><th>What they clear</th><th>Status</th><th></th></tr>
        ${owners.map(o => { const x = clr[o.id] || {}; return `<tr><td><b>${esc(o.area)}</b><div class="note">${esc(o.contact || o.owner || '')}</div></td><td class="note">${esc(o.items)}</td>
          <td>${statusChip(x.status)}<div class="note">${x.at ? fmtDT(x.at) + (x.by ? ' · ' + esc(x.by) : '') : x.askedAt ? 'asked ' + fmtDT(x.askedAt) : 'not asked yet'}</div></td>
          <td>${isOpen ? `<div class="ex-stepbtns">${x.status !== 'cleared' ? `<button class="btn small" type="button" data-clr="${esc(o.id)}" data-v="cleared">Cleared</button>` : ''}${x.status !== 'issue' ? `<button class="btn small" type="button" data-clr="${esc(o.id)}" data-v="issue">Pending item</button>` : ''}${x.status ? `<button class="btn small" type="button" data-clr="${esc(o.id)}" data-v="open">Reopen</button>` : ''}</div>` : ''}</td></tr>`; }).join('')}</table>
        <p class="note">Owners get their email with the steps "Start clearances" and "Reminder to owners" in Case journey. Relieving and experience letters wait until every area is cleared.</p></div>
      <div class="card" style="margin-top:16px"><h3>Letters</h3>
        ${(data.letters || []).length ? `<table class="ex-tbl">${data.letters.map(n => `<tr><td><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-lt="${esc(n)}"> ${esc(n)}</label></td><td class="note">${sentLetters[n] ? 'sent ' + fmtDT(sentLetters[n].sentAt) : 'not sent'}</td><td><button class="btn small" type="button" data-dl="${esc(n)}">Download PDF</button></td></tr>`).join('')}</table>
        ${isOpen ? '<div class="row" style="margin-top:8px"><button class="btn small primary" type="button" id="exSendLetters">Send ticked letters to the employee</button><span class="note">by email and WhatsApp</span></div>' : ''}` : '<p class="note">No letters are set for this separation type (Exit setup → Separation types).</p>'}</div>
    </div>
    <div>
      <div class="card"><div class="row" style="justify-content:space-between"><h3 style="margin:0">Full and final settlement</h3><span class="chip${/paid|Approved|Closed/.test(st) ? ' ex-green' : st === 'Needs correction' ? ' ex-red' : st === 'Sent for approval' ? ' ex-amber' : ''}">${esc(st)}</span></div>
        <div class="ex-form" style="margin-top:10px">${FNF_FIELDS.map(([f, l, t]) => `<label>${esc(l)}<input type="${t === 'text' ? 'text' : 'number'}" data-ff="${f}" value="${esc(inp[f] == null || inp[f] === 0 ? '' : inp[f])}" ${isOpen ? '' : 'disabled'}></label>`).join('')}
          ${k.typeId === 'misconduct' ? `<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-ff="gratForfeit" ${inp.gratForfeit ? 'checked' : ''}> Gratuity forfeited (misconduct, as per law)</label>` : ''}</div>
        ${isOpen ? '<div class="row" style="margin:10px 0"><button class="btn small" type="button" id="exFnfSave">Save and calculate</button></div>' : ''}
        ${c && c.missing.length ? `<p class="ex-err">Still needed: ${esc(c.missing.join(', '))}.</p>` : table}
        ${isOpen && c && !c.missing.length ? `<div class="ex-stepbtns"><button class="btn small primary" type="button" id="exFnfSend">Send to payroll for approval</button>
          ${st !== 'Approved' && !/paid/.test(st) ? '<button class="btn small" type="button" data-fs="Approved">Mark approved</button>' : ''}
          ${!/paid/.test(st) ? '<button class="btn small" type="button" data-fs="Wages paid">Wages paid</button>' : ''}
          ${c.gratuity && st !== 'Gratuity paid' ? '<button class="btn small" type="button" data-fs="Gratuity paid">Gratuity paid</button>' : ''}
          <button class="btn small" type="button" data-dl="F&F statement">Download statement</button>
          ${/paid/.test(st) ? '<button class="btn small" type="button" data-fs="Closed">Close the case</button>' : ''}</div>` : ''}
        <p class="note">Payroll: ${esc((setupRec && setupRec.setup.contacts.payroll) || 'not set (Exit setup → Company and contacts)')}.</p></div>
    </div></div>`;

  const reload = async (x, okText) => {
    if (!x.ok) { toast(x.body.error === 'exit_off_for_client' ? 'Exit is off for this client.' : 'Not done.'); return; }
    if (okText) toast(okText);
    await loadCases();
    const y = await post('case', { id: k.id });
    if (y.ok) drawClear(y.body);
  };
  $$('#exClr [data-clr]').forEach(b => { b.onclick = async () => { b.disabled = true; await reload(await post('clearance', { id: k.id, owner: b.dataset.clr, status: b.dataset.v })); }; });
  $$('#exClr [data-fs]').forEach(b => { b.onclick = async () => {
    if (b.dataset.fs === 'Closed' && !window.confirm('Close this case? Nothing more is sent for it.')) return;
    b.disabled = true; await reload(await post('fnf-status', { id: k.id, status: b.dataset.fs }), `F&F: ${b.dataset.fs.toLowerCase()}.`);
  }; });
  $$('#exClr [data-dl]').forEach(b => { b.onclick = async () => {
    const x = await post('letter', { id: k.id, name: b.dataset.dl });
    if (!x.ok) { toast('Not ready yet.'); return; }
    const bin = atob(x.body.base64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })); a.download = x.body.name; document.body.append(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }; });
  if ($('#exFnfSave')) $('#exFnfSave').onclick = async () => {
    const inputs = {};
    $$('#exClr [data-ff]').forEach(i => { inputs[i.dataset.ff] = i.type === 'checkbox' ? i.checked : i.type === 'number' ? Number(i.value || 0) : i.value; });
    await reload(await post('fnf', { id: k.id, inputs }), 'F&F saved and calculated.');
  };
  if ($('#exFnfSend')) $('#exFnfSend').onclick = async () => { const x = await post('send', { id: k.id, key: 'fnf-draft' }); await reload(x, x.ok ? (x.body.result.status === 'sent' ? 'Sent to payroll with the statement attached.' : 'Not sent: ' + (x.body.result.notes || []).join(' · ')) : ''); };
  if ($('#exSendLetters')) $('#exSendLetters').onclick = async () => {
    const names = $$('#exClr [data-lt]').filter(i => i.checked).map(i => i.dataset.lt);
    if (!names.length) { toast('Tick the letters to send.'); return; }
    const x = await post('letters-send', { id: k.id, names });
    await reload(x, x.ok ? (x.body.result.ok ? 'Letters sent: ' : 'Not sent: ') + (x.body.result.notes || []).join(' · ') : '');
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
  questions: [['q', 'Question', 'text', 'w20'], ['type', 'Answer', Object.keys(o.qtypes), Object.values(o.qtypes)], ['options', 'Options (Choice only, comma separated)', 'text', 'w16']],
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

function getList(path) { return path === 'seg' ? draftSetup.noticeStart.seg : path === 'questions' ? draftSetup.interview.questions : draftSetup[path]; }

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
    <details class="card ex-det" open><summary>Sending</summary>
      <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-g="sending.auto" ${s.sending && s.sending.auto ? 'checked' : ''}> Send due steps by themselves (8 am to 9 pm India time). When off, HR sends each step from Case journey.</label>
      <p class="note" style="margin:6px 0 0">WhatsApp goes only to the employee, and only within 24 hours of their last message; otherwise it waits until they write (email copies go at once). Approvers, owners, payroll and recruitment get email with one-click buttons.</p></details>
    <details class="card ex-det"><summary>Exit interview questions</summary><p class="note">Asked on WhatsApp one at a time after the "Exit interview" step. Answers are stored for anonymous group reports.</p>${table('questions', s.interview.questions || [], c.questions)}</details>
    <details class="card ex-det"><summary>F&F, interview and alumni</summary><div class="ex-form">
      <label>F&F approver<input type="text" data-g="fnf.approver" value="${esc(s.fnf.approver)}"></label>
      <label>Wages paid within (working days)<input type="number" data-g="fnf.wageDays" value="${esc(s.fnf.wageDays)}" class="ex-num"></label>
      <label>Gratuity after (years)<input type="number" data-g="fnf.gratYears" value="${esc(s.fnf.gratYears)}" class="ex-num"></label>
      <label>Gratuity paid within (days)<input type="number" data-g="fnf.gratDays" value="${esc(s.fnf.gratDays)}" class="ex-num"></label>
      <label>Gratuity after, fixed term (years)<input type="number" data-g="fnf.fteGratYears" value="${esc(s.fnf.fteGratYears)}" class="ex-num"></label>
      <label>Gratuity cap (₹)<input type="number" data-g="fnf.gratCap" value="${esc(s.fnf.gratCap)}"></label>
      <label>Leave encashment rate<select data-g="fnf.encash"><option value="basic26" ${s.fnf.encash === 'basic26' ? 'selected' : ''}>Basic ÷ 26 per day</option><option value="gross30" ${s.fnf.encash === 'gross30' ? 'selected' : ''}>Gross ÷ 30 per day</option></select></label>
      <label>Notice shortfall recovered at<select data-g="fnf.recovery"><option value="basic" ${s.fnf.recovery === 'basic' ? 'selected' : ''}>Basic ÷ 30 per day</option><option value="gross" ${s.fnf.recovery === 'gross' ? 'selected' : ''}>Gross ÷ 30 per day</option></select></label>
      <label>Interview reports: smallest group shown<input type="number" data-g="interview.threshold" value="${esc(s.interview.threshold)}" class="ex-num"></label>
      <label>Alumni: leave out<input type="text" data-g="alumni.exclude" value="${esc(s.alumni.exclude)}"></label>
      <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-g="alumni.on" ${s.alumni.on ? 'checked' : ''}> Alumni network on</label></div></details>`;

  sec.querySelectorAll('[data-p]').forEach(el => el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
    const row = getList(el.dataset.p)[+el.dataset.i];
    row[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
  }));
  sec.querySelectorAll('[data-c]').forEach(el => el.addEventListener('input', () => { s.contacts[el.dataset.c] = el.value; }));
  sec.querySelectorAll('[data-g]').forEach(el => el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
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
    questions: { id: 'q' + n, q: 'New question', type: 'open', options: '' },
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
