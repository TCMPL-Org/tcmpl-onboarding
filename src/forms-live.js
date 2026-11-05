// Joining forms for real candidates.
// Fills Form 11, Form 2 (A and B), ESIC Form 1 and Form F from the candidate's confirmed documents
// (Aadhaar, PAN, bank proof), their WhatsApp answers and the offer. HR can correct any field,
// send the forms to the candidate on WhatsApp to confirm, approve them and download the PDFs.
// "Offer desk session (demo)" keeps the original sample view.

const U = () => window.tcmplWAUtil;
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const DEMO = '__demo';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SRCC = { 'Aadhaar scan': 'info', 'PAN scan': 'info', 'Bank proof scan': 'info', Offer: 'teal', 'Employer (client HR)': 'teal', 'Previous UAN record': 'info', 'Candidate (WhatsApp)': '', 'Candidate to fill': 'warn' };

let cands = [], selected = DEMO, forms = [], fSel = 'f11', vals = {}, states = {}, editing = null, busy = false, missingQ = null, inProgress = false;
// What each WhatsApp question is about, in plain words.
const QLABEL = { marital: 'marital status', maritalOther: 'marital status', spouse: "spouse's name", presConfirm: 'present address', presAddr: 'present address', permSame: 'permanent address', permAddr: 'permanent address', family: 'family members', livesWith: 'whether family lives with them', familyPlace: "family's town", nominees: 'nominees and shares', guardian: "minor nominee's guardian", prevEpf: 'previous PF membership', uan: 'UAN', prevPf: 'previous PF member ID', exitDate: 'last working day at previous job', prevEps: 'previous pension (EPS) membership', intl: 'international worker', religion: 'religion' };

const nd = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[3]} ${MON[+m[2] - 1]} ${m[1]}` : (iso || ''); };
const fmtTime = iso => iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
const current = () => cands.find(c => c.id === selected);
const show = (el, on) => { if (el) el.style.display = on ? '' : 'none'; };

function ageOn(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); if (!m) return 99;
  const t = new Date(); let a = t.getFullYear() - +m[1];
  if (t.getMonth() + 1 < +m[2] || (t.getMonth() + 1 === +m[2] && t.getDate() < +m[3])) a--;
  return a;
}

function profileOf(c) {
  return Object.assign({ name: (c.kyc && c.kyc.name) || c.name, first: c.first, role: c.role, doj: c.doj, client: c.client, mobile: c.phone ? '+' + c.phone : '', email: c.email }, c.profile || {}, { name: c.name || (c.kyc && c.kyc.name) });
}

// The candidate's real data in the shape the form layouts use.
function pdOf(c) {
  const k = c.kyc || {}, d = c.details || {}, b = k.bank || {};
  const fam = d.family || [], place = d.familyPlace || '';
  const pres = d.presAddr || '', perm = d.permSame === false ? (d.permAddr || '') : pres;
  return {
    father: k.father || '', spouse: d.marital === 'Married' ? (d.spouse || '') : '',
    dob: nd(k.dob), gender: k.gender || '', marital: d.marital || '',
    email: c.email || (c.profile && c.profile.email) || '',
    addrPerm: perm, addrPres: pres,
    aadhaar: k.aadhaarLast4 ? 'XXXX XXXX ' + k.aadhaarLast4 : '',
    pan: k.pan || '',
    bank: [b.bank, b.accountLast4 ? 'a/c ending ' + b.accountLast4 : '', b.ifsc ? 'IFSC ' + b.ifsc : ''].filter(Boolean).join(', '),
    uan: d.uan || '', prevEpf: d.prevEpf || '', prevEps: d.prevEps || '', prevPf: d.prevPf || '', exitDate: nd(d.exitDate),
    intl: d.intl || '', religion: d.religion || '',
    family: fam.map(f => [f.name, f.relation, nd(f.dob), f.livesWith === false ? 'No' + (place ? ' (' + place + ')' : '') : 'Yes']),
    nominees: (d.nominees || []).map(n => { const f = fam.find(x => x.name === n.name) || {}; return [n.name, f.livesWith === false && place ? place : pres, n.relation, nd(n.dob), n.share + '%', ageOn(n.dob) < 18 ? (d.guardian || '') : '']; })
  };
}

/* ---------- mount ---------- */
function mount() {
  const sec = $('#tab-forms');
  if (!sec || $('#flive')) return Boolean($('#flive'));
  const bar = document.createElement('div');
  bar.id = 'flive';
  bar.innerHTML = `
  <div class="card jl-top" style="margin-bottom:12px">
    <div class="row" style="gap:10px">
      <label class="lbl" for="flCand">Candidate</label>
      <select id="flCand"></select>
      <span class="chip" id="flDocs"></span><span class="chip" id="flDetails"></span><span class="chip" id="flStatus"></span>
    </div>
    <div class="row" id="flActions">
      <button class="btn small teal" id="flJourney" type="button" title="Asking details and sending forms to the candidate is done from Candidate journey">Send from Candidate journey</button>
      <button class="btn small primary" id="flApprove" type="button">Approve forms</button>
      <button class="btn small" id="flRefresh" type="button">Refresh</button>
    </div>
  </div>
  <div class="fgrid" id="flGrid" style="display:none">
    <div class="card" id="flList"></div>
    <div class="card"><div class="row" style="justify-content:flex-end;margin-bottom:8px"><button class="btn small" id="flPdf" type="button">Download this form (PDF)</button><button class="btn small" id="flPdfAll" type="button">Download all forms</button></div><div class="govform" id="flView"></div></div>
  </div>`;
  sec.querySelector('.intro').after(bar);
  $('#flCand').onchange = () => { selected = $('#flCand').value; editing = null; load(); };
  $('#flRefresh').onclick = () => reload();
  $('#flJourney').onclick = () => openJourney();
  $('#flApprove').onclick = approve;
  $('#flPdf').onclick = () => download([fSel]);
  $('#flPdfAll').onclick = () => download(forms.filter(f => f.applies).map(f => f.id));
  document.querySelectorAll('nav.tabs button').forEach(b => b.addEventListener('click', () => { if (b.dataset.tab === 'forms') reload(); }));
  reload();
  return true;
}

function applyMode() {
  const sec = $('#tab-forms'); if (!sec) return;
  const demo = selected === DEMO;
  show(sec.querySelector('.intro .row'), demo);
  [...sec.children].forEach(el => { if (el.classList.contains('fgrid') && el.id !== 'flGrid') show(el, demo); });
  const exportRow = $('#fmExport') && $('#fmExport').closest('.row'); show(exportRow, demo);
  show($('#flGrid'), !demo);
  show($('#flActions'), !demo);
  ['#flDocs', '#flDetails', '#flStatus'].forEach(q => show($(q), !demo));
}

/* ---------- data ---------- */
async function reload() {
  const u = U(); if (!u) return;
  const h = await u.loadHealth();
  if (h.db) {
    const r = await u.getJson('/api/data/candidates').catch(() => ({ ok: false }));
    if (r.ok) cands = (r.body.items || []).map(i => Object.assign({ id: i.id }, i.data)).filter(c => c.profile || c.offerId)
      .sort((a, b) => String(b.releasedAt || '').localeCompare(String(a.releasedAt || '')));
  }
  if (selected !== DEMO && !cands.some(c => c.id === selected)) selected = DEMO;
  $('#flCand').innerHTML = `<option value="${DEMO}">Offer desk session (demo)</option>` + cands.map(c => `<option value="${esc(c.id)}">${esc(c.name || '+' + c.phone)} · ${esc((c.profile && c.profile.role) || c.role || '')}</option>`).join('');
  $('#flCand').value = selected;
  load();
}

function load() {
  applyMode();
  const c = current();
  if (!c) return;
  try { forms = window.tcmplFormDefs(profileOf(c), pdOf(c)) || []; } catch (e) { console.warn(e); forms = []; }
  vals = Object.assign({}, c.forms && c.forms.vals);
  states = Object.assign({}, c.forms && c.forms.states);
  if (!forms.some(f => f.id === fSel && f.applies)) fSel = 'f11';
  missingQ = null;
  renderHead(); renderList(); renderView();
  loadMissing(c.id);
}

async function loadMissing(id) {
  const r = await post('/api/forms/missing', { candidateId: id });
  if (!r.ok || selected !== id) return;
  missingQ = r.body.missing || {}; inProgress = Boolean(r.body.inProgress);
  renderView();
}

/* ---------- values ---------- */
const key = (fid, k) => fid + ':' + k;
const fv = (f, fl) => vals[key(f.id, fl.k)] !== undefined ? vals[key(f.id, fl.k)] : fl.val;
const fst = (f, k) => states[key(f.id, k)] || 'pending';
function items(f) { const out = []; f.sections.forEach(s => { (s.fields || []).forEach(x => out.push({ k: x.k, v: fv(f, x) })); if (s.table) out.push({ k: s.table.k, v: s.table.rows.length || s.table.empty ? 'x' : '' }); }); return out; }
function progress(f) { const it = items(f); return { filled: it.filter(x => x.v).length, total: it.length }; }

/* ---------- rendering ---------- */
function renderHead() {
  const c = current(); if (!c) return;
  const items = (c.docs && c.docs.items) || {};
  const done = ['aadhaar', 'pan', 'bank'].filter(t => items[t] && /confirmed|needs_review/.test(items[t].status)).length;
  $('#flDocs').textContent = `Documents: ${done} of 3`;
  $('#flDocs').className = 'chip ' + (done === 3 ? 'ok' : 'warn');
  const d = c.details || {};
  $('#flDetails').textContent = d.completedAt ? 'Details: answered' : d.step ? 'Details: in progress on WhatsApp' : 'Details: not asked';
  $('#flDetails').className = 'chip ' + (d.completedAt ? 'ok' : d.step ? 'info' : 'warn');
  const f = c.forms || {};
  const st = f.approvedBy ? ['Approved by ' + f.approvedBy, 'ok'] : f.candidateConfirmedAt ? ['Confirmed by candidate ' + fmtTime(f.candidateConfirmedAt), 'ok'] : f.candidateNote ? ['Candidate asked for a change', 'bad'] : f.sentAt ? ['Sent to candidate ' + fmtTime(f.sentAt), 'info'] : ['Not sent yet', ''];
  $('#flStatus').textContent = st[0]; $('#flStatus').className = 'chip ' + st[1];
  $('#flApprove').textContent = f.approvedBy ? 'Undo approval' : 'Approve forms';
}

function renderList() {
  const c = current();
  const f = c.forms || {};
  $('#flList').innerHTML = `<h3 style="margin-bottom:6px">${esc(c.name)}</h3><p class="note" style="margin:0 0 10px">${esc((c.profile && c.profile.role) || c.role || '')} · joins ${esc(nd(c.doj || (c.profile && c.profile.doj)))}</p>` +
    (f.candidateNote ? `<div class="callout" style="margin-bottom:10px"><b>Candidate says:</b> ${esc(f.candidateNote)}</div>` : '') +
    forms.map(x => { const p = progress(x); return `<button class="fmitem ${x.id === fSel ? 'on' : ''}" data-fm="${x.id}" ${x.applies ? '' : 'disabled'}><b>${esc(x.title)}</b><span class="note">${esc(x.applies ? x.sub : x.why)}</span>${x.applies ? `<span class="meter" style="margin-top:6px"><span style="width:${Math.round(100 * p.filled / p.total)}%;background:var(--teal)"></span></span><span class="note">${p.filled} of ${p.total} filled</span>` : ''}</button>`; }).join('');
  document.querySelectorAll('#flList [data-fm]').forEach(b => { b.onclick = () => { fSel = b.dataset.fm; editing = null; renderList(); renderView(); }; });
}

function renderView() {
  const c = current(), f = forms.find(x => x.id === fSel);
  if (!f) { $('#flView').innerHTML = ''; return; }
  const confirmed = c.forms && c.forms.candidateConfirmedAt;
  let h = '';
  if (missingQ && missingQ[f.id]) {
    const qs = [...new Set(missingQ[f.id].map(k => QLABEL[k] || k))];
    h += qs.length
      ? `<div class="callout fl-miss"><div><b>${esc(f.title)} still needs from the candidate:</b> ${esc(qs.join(', '))}.${inProgress ? ' <span class="note">(The candidate is answering questions on WhatsApp right now.)</span>' : ' <span class="note">Ask for them from Candidate journey → Joining forms step.</span>'}</div><button class="btn small teal" id="flAskForm" type="button">Open in Candidate journey</button></div>`
      : `<div class="callout fl-miss ok"><b>Nothing missing from the candidate for ${esc(f.title)}.</b></div>`;
  }
  h += `<div class="gfhead"><div class="lbl">${esc(f.org)}</div><h3>${esc(f.title)}</h3><div>${esc(f.sub)}</div></div>`;
  f.sections.forEach(s => {
    h += `<div class="gfsec">${esc(s.h)}</div>`;
    (s.fields || []).forEach(fl => {
      const st = fst(f.id, fl.k), v = fv(f, fl), k = key(f.id, fl.k);
      h += `<div class="gfrow ${st}"><div class="gfn">${esc(fl.num)}</div><div class="gfl">${esc(fl.label)}</div><div class="gfv">${editing === k ? `<input type="text" id="flEdit" value="${esc(v)}" aria-label="${esc(fl.label)}"> <button class="btn small primary" data-save="${esc(fl.k)}" type="button">Save</button>` : (v ? esc(v) : '<span class="note">Awaiting candidate</span>')}<div class="gfm"><span class="chip ${SRCC[fl.src] || ''}">${esc(fl.src)}</span>${st === 'corrected' ? '<span class="chip info">Corrected by HR</span>' : confirmed ? '<span class="chip ok">Confirmed by candidate</span>' : ''}</div></div><div class="gfa"><button class="btn small" data-edit="${esc(fl.k)}" type="button">${v ? 'Correct' : 'Fill'}</button></div></div>`;
    });
    if (s.table) {
      const t = s.table;
      h += `<div class="tscroll"><table class="gft"><tr>${t.cols.map(x => `<th>${esc(x)}</th>`).join('')}</tr>${t.rows.length ? t.rows.map(r => `<tr>${t.cols.map((_, i) => `<td>${esc(r[i] || '')}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${t.cols.length}" class="note">${esc(t.empty || 'Awaiting candidate')}</td></tr>`}</table></div><div class="row" style="margin:6px 0 10px"><span class="chip ${SRCC[t.src] || ''}">${esc(t.src)}</span>${confirmed ? '<span class="chip ok">Confirmed by candidate</span>' : ''}<span class="note">To change family or nominees, ask the candidate again from "Ask missing details on WhatsApp".</span></div>`;
    }
  });
  $('#flView').innerHTML = h;
  if ($('#flAskForm')) $('#flAskForm').onclick = () => openJourney();
  document.querySelectorAll('#flView [data-edit]').forEach(b => { b.onclick = () => { editing = key(f.id, b.dataset.edit); renderView(); const e = $('#flEdit'); if (e) { e.focus(); e.select(); } }; });
  document.querySelectorAll('#flView [data-save]').forEach(b => { b.onclick = () => saveField(f, b.dataset.save); });
  const e = $('#flEdit'); if (e) e.onkeydown = ev => { if (ev.key === 'Enter') saveField(f, editing.split(':')[1]); if (ev.key === 'Escape') { editing = null; renderView(); } };
}

/* ---------- actions ---------- */
async function post(path, body) {
  return U().getJson(path, { method: 'POST', body: JSON.stringify(body) }).catch(() => ({ ok: false, body: null }));
}

async function saveField(f, k) {
  const c = current(); const v = ($('#flEdit') && $('#flEdit').value.trim()) || '';
  vals[key(f.id, k)] = v; states[key(f.id, k)] = 'corrected'; editing = null;
  const r = await post('/api/forms/save', { candidateId: c.id, vals, states });
  if (!r.ok) U().toast('Not saved. Please try again.');
  else c.forms = r.body.forms;
  renderList(); renderView(); renderHead();
}

async function approve() {
  const c = current(); if (!c || busy) return;
  const undo = c.forms && c.forms.approvedBy;
  if (!undo && !(c.forms && c.forms.candidateConfirmedAt) && !window.confirm('The candidate has not confirmed these forms on WhatsApp yet. Approve anyway?')) return;
  busy = true;
  const r = await post('/api/forms/save', { candidateId: c.id, vals, states, approve: !undo });
  busy = false;
  if (!r.ok) { U().toast('Not saved. Please try again.'); return; }
  c.forms = r.body.forms; U().toast(undo ? 'Approval removed.' : 'Forms approved.');
  renderHead();
}

// All messages go from Candidate journey: jump there with this candidate on the Joining forms step.
function openJourney() {
  const c = current(); if (!c) return;
  const b = document.querySelector('nav.tabs button[data-tab="journey"]');
  if (b) b.click();
  setTimeout(() => { if (window.tcmplLive) window.tcmplLive.reload(c.id, 'tp:confirm'); }, 50);
}

function footer(c) {
  return `Pre-filled by the AI Onboarding Agent from ${c.name}'s documents (Aadhaar, PAN, bank proof), WhatsApp answers and offer. Generated ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}. ${window.tcmplFormNote ? window.tcmplFormNote() : ''}`;
}

function pdfs(ids) {
  const c = current();
  return ids.map(id => {
    const f = forms.find(x => x.id === id);
    const blob = window.tcmplFormPdf(profileOf(c), pdOf(c), id, vals, states, footer(c));
    return blob ? { blob, filename: `${f.title.replace(/\W+/g, '_')}_${c.name.replace(/\W+/g, '_')}.pdf`, title: f.title } : null;
  }).filter(Boolean);
}

function download(ids) {
  const c = current(); if (!c) return;
  const files = pdfs(ids);
  if (!files.length) { U().toast('PDF tool is still loading. Try again in a moment.'); return; }
  files.forEach((x, i) => setTimeout(() => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(x.blob); a.download = x.filename;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, i * 400));
}

// Used by Candidate journey (all sending happens there): PDFs for a candidate, empty-field count, open the full forms.
window.tcmplFormsKit = {
  defs(c) { try { return (window.tcmplFormDefs(profileOf(c), pdOf(c)) || []).filter(f => f.applies); } catch (e) { console.warn(e); return []; } },
  empty(c) {
    const v = (c.forms && c.forms.vals) || {};
    let n = 0;
    for (const f of this.defs(c)) f.sections.forEach(s => { (s.fields || []).forEach(x => { const k = f.id + ':' + x.k; if (!(v[k] !== undefined ? v[k] : x.val)) n++; }); if (s.table && !s.table.rows.length && !s.table.empty) n++; });
    return n;
  },
  async files(c) {
    const v = (c.forms && c.forms.vals) || {}, st = (c.forms && c.forms.states) || {};
    const out = [];
    for (const f of this.defs(c)) {
      const blob = window.tcmplFormPdf(profileOf(c), pdOf(c), f.id, v, st, footer(c));
      if (blob) out.push({ filename: `${f.title.replace(/\W+/g, '_')}_${String(c.name || '').replace(/\W+/g, '_')}.pdf`, pdfBase64: await U().blobToBase64(blob), caption: f.title });
    }
    return out;
  },
  open(id) {
    selected = id;
    const b = document.querySelector('nav.tabs button[data-tab="forms"]');
    if (b) b.click();
    setTimeout(reload, 50);
  }
};

(function waitForApp(n) {
  if (window.tcmplWAUtil && window.tcmplFormDefs && mount()) return;
  if (n > 100) return;
  setTimeout(() => waitForApp(n + 1), 100);
})(0);
