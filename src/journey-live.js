// Live candidate journey: one working screen per real candidate.
//   Left   – the client's touchpoints, with what has been sent and what is due
//   Middle – the candidate's real WhatsApp conversation (live), with an HR reply box
//   Right  – the selected touchpoint's standard message (editable) + candidate details
// The original click-through simulation is kept behind "Demo mode".

const U = () => window.tcmplWAUtil;
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const POLL_MS = 5000;
const DEMO_KEY = 'tcmpl-journey-demo';

let cands = [], selected = null, plan = [], tpSel = null, preview = null, msgs = [], lastSig = '', docs = [], docEdit = null, health = {};

function fmtDate(iso) {
  if (!iso) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + 'T00:00:00') : new Date(iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtTime(iso) { return iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''; }
const inr = n => n ? '₹' + Math.round(n).toLocaleString('en-IN') : '—';

function demoOn() { try { return localStorage.getItem(DEMO_KEY) === '1'; } catch { return false; } }
function setDemo(on) { try { localStorage.setItem(DEMO_KEY, on ? '1' : '0'); } catch { /* storage unavailable */ } applyMode(); }

function profileOf(c) {
  const p = Object.assign({ name: c.name, first: c.first, role: c.role, doj: c.doj, client: c.client, mobile: c.phone, email: c.email }, c.profile || {});
  p.accepted = /accept/i.test(c.stage || '');
  return p;
}
const current = () => cands.find(c => c.id === selected);
// Some app styles set display on these blocks, so toggle display directly rather than the hidden attribute.
const show = (el, on) => { if (el) el.style.display = on ? '' : 'none'; };

/* ---------- mount ---------- */
function mount() {
  const sec = $('#tab-journey');
  if (!sec || $('#jlive')) return Boolean($('#jlive'));
  const intro = sec.querySelector('.intro');
  const wrap = document.createElement('div');
  wrap.id = 'jlive';
  wrap.innerHTML = `
  <div class="card jl-top">
    <div class="row" style="gap:10px">
      <label class="lbl" for="jlCand">Candidate</label>
      <select id="jlCand"></select>
      <span class="chip" id="jlStage"></span><span class="chip" id="jlRisk"></span><span class="chip" id="jlWindow"></span>
    </div>
    <div class="row">
      <button class="btn small" id="jlLetter" type="button">Send offer letter again</button>
      <button class="btn small" id="jlRefresh" type="button">Refresh</button>
      <label class="note" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="jlDemo"> Demo mode</label>
    </div>
  </div>
  <div id="jlEmpty" class="card jl-empty" style="display:none">
    <h3>No released offers yet</h3>
    <p class="note">Release an offer from the Offer desk with the candidate's WhatsApp number. The candidate then appears here with their journey and their real WhatsApp chat.</p>
  </div>
  <div class="jl-grid" id="jlGrid">
    <div class="card jl-tps" id="jlTps"></div>
    <div>
      <div class="phone">
        <div class="phead"><div class="avatar" id="jlAvatar">WA</div><div><div class="t" id="jlName">—</div><div class="s" id="jlSub">WhatsApp</div></div></div>
        <div class="msgs" id="jlMsgs" aria-live="polite"></div>
        <form class="composer" id="jlForm" style="display:flex;gap:8px;padding:8px">
          <input id="jlText" type="text" placeholder="Write your own message to the candidate…" style="flex:1;min-width:0">
          <button class="btn primary small" id="jlSend">Send</button>
        </form>
      </div>
    </div>
    <div class="jl-side">
      <div class="card jl-prev" id="jlPrev"><h3>Touchpoint</h3><p class="note">Click a touchpoint on the left to see its standard message and send it on WhatsApp.</p></div>
      <div class="card jl-docs" style="margin-top:16px" id="jlDocs"></div>
      <div class="card" style="margin-top:16px" id="jlFacts"></div>
    </div>
  </div>
  <div id="jlDemoBar" class="card" style="padding:8px 14px;margin-bottom:12px;display:none"><label class="note" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="jlDemo2" checked> Demo mode: simulated journey for presentations. Untick to work with real candidates.</label></div>`;
  intro.after(wrap);
  $('#jlCand').onchange = () => { selected = $('#jlCand').value; tpSel = null; preview = null; lastSig = ''; docs = []; docEdit = null; renderAll(); loadMsgs(true); loadDocs(); };
  $('#jlRefresh').onclick = () => reload(selected);
  $('#jlDemo').onchange = () => setDemo($('#jlDemo').checked);
  $('#jlDemo2').onchange = () => setDemo($('#jlDemo2').checked);
  $('#jlLetter').onclick = sendLetter;
  $('#jlForm').onsubmit = sendOwn;
  // poll the chat while the journey tab is open
  setInterval(() => { if (!sec.hidden && !demoOn() && document.visibilityState === 'visible') { loadMsgs(false); } }, POLL_MS);
  document.querySelectorAll('nav.tabs button').forEach(b => b.addEventListener('click', () => { if (b.dataset.tab === 'journey' && !demoOn()) reload(selected); }));
  applyMode();
  return true;
}

function applyMode() {
  const sec = $('#tab-journey'); if (!sec) return;
  const demo = demoOn();
  [...sec.children].forEach(el => {
    if (el.classList.contains('intro')) return;
    if (el.id === 'jlive') return;
    show(el, demo);
  });
  show($('.jl-top'), !demo);
  show($('#jlGrid'), !demo && cands.length > 0);
  show($('#jlEmpty'), !demo && cands.length === 0);
  show($('#jlDemoBar'), demo);
  if ($('#jlDemo')) $('#jlDemo').checked = demo;
  if ($('#jlDemo2')) $('#jlDemo2').checked = demo;
  const p = sec.querySelector('.intro p');
  if (p) p.textContent = demo
    ? "Demo mode: step through the agent's touchpoints from offer to Day 90 and reply as the candidate with the buttons."
    : 'Work with candidates whose offer was released: see their real WhatsApp chat, send each touchpoint\'s standard message, or write your own.';
  if (!demo) reload(selected);
}

/* ---------- data ---------- */
async function reload(want) {
  const u = U(); if (!u) return;
  const h = await u.loadHealth();
  health = h || {};
  if (!h.db) { cands = []; renderAll(); return; }
  const r = await u.getJson('/api/data/candidates').catch(() => ({ ok: false }));
  if (!r.ok) return;
  cands = (r.body.items || []).map(i => Object.assign({ id: i.id }, i.data))
    .filter(c => c.profile || c.offerId || (c.stage && c.stage !== 'Unknown contact'))
    .sort((a, b) => String(b.releasedAt || b.lastMessageAt).localeCompare(String(a.releasedAt || a.lastMessageAt)));
  if (want && cands.some(c => c.id === want)) { if (selected !== want) { tpSel = null; preview = null; } selected = want; }
  if (!cands.some(c => c.id === selected)) { selected = cands[0] ? cands[0].id : null; tpSel = null; preview = null; }
  renderAll();
  loadMsgs(true);
  loadDocs();
}

async function loadDocs() {
  const u = U(); if (!u || !selected) { docs = []; renderDocs(); return; }
  const want = selected;
  const r = await u.getJson('/api/data/documents').catch(() => ({ ok: false }));
  if (!r.ok || want !== selected) return;
  docs = (r.body.items || []).map(i => i.data).filter(d => d && d.candidateId === selected);
  renderDocs();
}

async function loadMsgs(force) {
  const u = U(); if (!u || !selected) return;
  const r = await u.getJson('/api/data/messages').catch(() => ({ ok: false }));
  if (!r.ok) return;
  msgs = (r.body.items || []).map(i => i.data).filter(m => m && m.candidateId === selected).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const sig = JSON.stringify([selected, msgs.length, msgs.length && msgs[msgs.length - 1].at]);
  if (!force && sig === lastSig) return;
  lastSig = sig;
  renderChat();
  // new inbound messages may have changed stage / risk / window
  if (!force) { const r2 = await u.getJson('/api/data/candidates/' + encodeURIComponent(selected)).catch(() => ({ ok: false })); if (r2.ok) { const i = cands.findIndex(c => c.id === selected); if (i >= 0) { cands[i] = Object.assign({ id: selected }, r2.body.data); renderHeader(); renderFacts(); renderTps(); } } loadDocs(); }
}

/* ---------- rendering ---------- */
function renderAll() {
  if (!$('#jlive')) return;
  const sel = $('#jlCand');
  sel.innerHTML = cands.map(c => `<option value="${esc(c.id)}">${esc(c.name || '+' + c.phone)} · ${esc((c.profile && c.profile.role) || c.role || '')}${c.clientLabel ? ' · ' + esc(c.clientLabel) : ''}</option>`).join('');
  if (selected) sel.value = selected;
  const none = !cands.length;
  show($('#jlEmpty'), !demoOn() && none);
  show($('#jlGrid'), !demoOn() && !none);
  show($('.jl-top'), !demoOn());
  ['#jlLetter', '#jlCand'].forEach(q => { $(q).disabled = none; });
  const c = current();
  plan = c && window.tcmplPlanFor ? (() => { try { return window.tcmplPlanFor(profileOf(c)); } catch (e) { console.warn(e); return []; } })() : [];
  renderHeader(); renderTps(); renderPreview(); renderDocs(); renderFacts(); renderChat();
}

function windowState(c) {
  if (!c || !c.lastInboundAt) return { open: false, until: null };
  const until = new Date(new Date(c.lastInboundAt).getTime() + 24 * 3600 * 1000);
  return { open: until > new Date(), until };
}

function renderHeader() {
  const c = current();
  const st = $('#jlStage'), rk = $('#jlRisk'), wn = $('#jlWindow');
  if (!c) { st.textContent = ''; rk.textContent = ''; wn.textContent = ''; return; }
  st.textContent = c.stage || 'Offer released';
  st.className = 'chip ' + (/accept/i.test(c.stage || '') ? 'ok' : 'info');
  const sc = c.riskScore || 0;
  rk.textContent = 'Risk: ' + (sc >= 50 ? 'High' : sc >= 25 ? 'Medium' : 'Low');
  rk.className = 'chip ' + (sc >= 50 ? 'bad' : sc >= 25 ? 'warn' : 'ok');
  const w = windowState(c);
  wn.textContent = w.open ? 'WhatsApp open until ' + w.until.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : 'Waiting for candidate to reply';
  wn.className = 'chip ' + (w.open ? 'teal' : 'warn');
  wn.title = w.open ? 'You can send any message or touchpoint until then.' : 'WhatsApp only allows free messages within 24 hours of the candidate\'s last message. Ask them to reply once (e.g. "Hi").';
  $('#jlName').textContent = c.name || '+' + c.phone;
  $('#jlSub').textContent = '+' + c.phone + (c.clientLabel ? ' · ' + c.clientLabel : '');
  $('#jlAvatar').textContent = (c.name || 'WA').split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase();
}

function renderTps() {
  const c = current(), box = $('#jlTps');
  if (!c) { box.innerHTML = ''; return; }
  const sent = c.touchpoints || {};
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const trk = { c: 'Candidate', m: 'Manager', s: 'Stakeholders' };
  box.innerHTML = '<h3>Touchpoints</h3>' + (plan.length ? plan.map(tp => {
    const s = sent[tp.key];
    const due = new Date(tp.date + 'T00:00:00') <= today;
    const forCand = tp.track === 'c';
    const status = s ? `<span style="color:var(--ok)">✓ Sent ${esc(fmtTime(s.at))}</span>`
      : !forCand ? '<span class="note">Not sent to the candidate</span>'
      : due ? '<span style="color:var(--warn)">Due now</span>' : '<span class="note">Upcoming</span>';
    return `<button type="button" class="tlitem jl-tp ${tpSel === tp.key ? 'sel' : ''} ${forCand ? '' : 'off'}" data-k="${esc(tp.key)}" ${forCand ? '' : 'disabled'}>
      <div class="when">${esc(tp.rel)}<br><span style="font-weight:500">${esc(fmtDate(tp.date).replace(/ \d{4}$/, ''))}</span></div>
      <div><div class="trk ${esc(tp.track)}">${trk[tp.track] || ''}</div>${esc(tp.label)}<div class="st">${status}</div></div></button>`;
  }).join('') : '<p class="note">No touchpoints set for this client.</p>');
  box.querySelectorAll('.jl-tp[data-k]').forEach(b => { if (!b.disabled) b.onclick = () => selectTp(b.dataset.k); });
}

function selectTp(key) {
  const c = current(); if (!c) return;
  tpSel = key;
  let nodes = [];
  try { nodes = window.tcmplRenderTouchpoint(profileOf(c), key) || []; } catch (e) { console.warn(e); }
  const texts = [], buttons = []; let letter = key === 'offer', extraDocs = 0;
  for (const n of nodes) {
    if (n.classList.contains('b') && n.classList.contains('in')) { const t = U().toWaText(n); if (t) texts.push(t); }
    else if (n.classList.contains('qr')) [...n.querySelectorAll('button')].forEach(b => buttons.push(b.textContent.trim()));
    else if (n.classList.contains('doc')) { if (/offer_letter/i.test(n.textContent)) letter = true; else extraDocs++; }
  }
  const tp = plan.find(x => x.key === key) || { label: key };
  preview = { key, label: tp.label, text: texts.join('\n\n'), buttons: buttons.filter(Boolean), letter, extraDocs };
  renderTps(); renderPreview();
}

function renderPreview() {
  const box = $('#jlPrev');
  if (!preview) { box.innerHTML = '<h3>Touchpoint</h3><p class="note">Click a touchpoint on the left to see its standard message, edit it if you like, and send it on WhatsApp.</p>'; return; }
  const c = current();
  const sent = c && c.touchpoints && c.touchpoints[preview.key];
  const btnOk = preview.buttons.length && preview.buttons.length <= 3 && preview.buttons.every(b => b.length <= 20);
  box.innerHTML = `<h3>${esc(preview.label)}</h3>
    <p class="note">${sent ? 'Already sent ' + esc(fmtTime(sent.at)) + '. You can send it again.' : 'Standard message for this touchpoint. Edit it before sending if needed.'}</p>
    <textarea id="jlPrevText" aria-label="Message to send">${esc(preview.text)}</textarea>
    ${preview.buttons.length ? `<div class="note" style="margin-top:8px">${btnOk ? 'Reply buttons the candidate can tap:' : 'Reply options (sent as text):'}</div><div class="jl-btns">${preview.buttons.map(b => `<span class="chip teal">${esc(b)}</span>`).join('')}</div>
      <label class="note" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="jlPrevBtns" checked> Include reply ${btnOk ? 'buttons' : 'options'}</label>` : ''}
    <label class="note" style="display:flex;gap:6px;align-items:center;margin-top:6px"><input type="checkbox" id="jlPrevLetter" ${preview.letter ? 'checked' : ''}> Attach the offer letter PDF</label>
    ${preview.extraDocs ? `<p class="note">${preview.extraDocs} other attachment(s) in this step are demo-only and are not sent.</p>` : ''}
    <div class="row" style="margin-top:10px"><button class="btn primary" id="jlPrevSend" type="button">Send on WhatsApp</button></div>`;
  $('#jlPrevSend').onclick = sendPreview;
}

function renderFacts() {
  const c = current(), box = $('#jlFacts');
  if (!c) { box.innerHTML = ''; return; }
  const p = c.profile || {};
  const risk = (c.risk || []).map(r => esc(r.label)).join('; ') || 'None';
  const ho = (c.handovers || []).filter(h => h.open !== false).map(h => `${esc(h.why)} <span class="note">${esc(fmtTime(h.at))}</span>`).join('<br>') || 'None';
  box.innerHTML = `<h3 style="margin-bottom:8px">Candidate</h3><dl class="kv">
    <dt>Name</dt><dd>${esc(c.name || '')}</dd>
    <dt>WhatsApp</dt><dd>+${esc(c.phone || '')}</dd>
    <dt>Client</dt><dd>${esc(c.clientLabel || c.client || '')}</dd>
    <dt>Role</dt><dd>${esc(p.role || c.role || '')}</dd>
    <dt>Joining</dt><dd>${esc(fmtDate(p.doj || c.doj))}</dd>
    <dt>Annual CTC</dt><dd>${inr(p.ctc)}</dd>
    <dt>Manager</dt><dd>${esc(p.mgr || '—')}</dd>
    <dt>Offer released</dt><dd>${esc(fmtTime(c.releasedAt))}</dd>
    <dt>Offer letter</dt><dd>${c.letterSent ? 'Sent on WhatsApp' : 'Not sent yet'}</dd>
    <dt>Risk signals</dt><dd>${risk}</dd>
    <dt>Handed to people</dt><dd>${ho}</dd></dl>`;
}

function renderChat() {
  const box = $('#jlMsgs'); if (!box) return;
  const f = t => t ? new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
  const who = m => m.direction === 'in' ? '' : ' · ' + (m.source === 'hr' ? 'HR' : m.source === 'journey' ? 'Touchpoint' : m.source === 'ai' ? 'Agent (AI)' : 'Agent');
  box.innerHTML = msgs.map(m => `<div class="b ${m.direction === 'in' ? 'in' : 'out'}"><p style="white-space:pre-wrap;margin:0">${esc(m.text)}</p><span class="meta">${esc(f(m.at))}${esc(who(m))}${m.error ? ' · not delivered' : ''}</span></div>`).join('')
    || '<div class="note" style="padding:12px">No messages yet.</div>';
  box.scrollTop = box.scrollHeight;
}


/* ---------- documents ---------- */
const DOC_TYPES = [
  { type: 'aadhaar', label: 'Aadhaar card', fields: [['name', 'Name'], ['dob', 'Date of birth'], ['gender', 'Gender'], ['aadhaarLast4', 'Aadhaar (last 4)'], ['address', 'Address']] },
  { type: 'pan', label: 'PAN card', fields: [['pan', 'PAN'], ['name', 'Name'], ['father', "Father's name"], ['dob', 'Date of birth']] },
  { type: 'bank', label: 'Bank proof', fields: [['holder', 'Account holder'], ['accountLast4', 'Account (last 4)'], ['ifsc', 'IFSC'], ['bank', 'Bank']] }
];
const LOCKED = { aadhaarLast4: true, accountLast4: true };

function docStatus(d) {
  if (!d) return ['Not received', ''];
  if (d.status === 'confirmed' && d.reviewedBy) return ['Approved by HR', 'ok'];
  if (d.status === 'confirmed') return ['Confirmed by candidate', 'ok'];
  if (d.status === 'needs_review') return ['Needs HR review', 'warn'];
  if (d.status === 'rejected') return ['Rejected, ask again', 'bad'];
  return ['Read, waiting for candidate', 'info'];
}

function renderDocs() {
  const box = $('#jlDocs'); if (!box) return;
  const c = current();
  if (!c) { box.innerHTML = ''; return; }
  const cd = c.docs || {};
  const ready = health.ocr && health.storage;
  const consent = cd.consentAt ? 'Consent given ' + esc(fmtTime(cd.consentAt)) : cd.declinedAt ? 'Candidate said "Not now" ' + esc(fmtTime(cd.declinedAt)) : cd.requestedAt ? 'Consent asked ' + esc(fmtTime(cd.requestedAt)) + ', not given yet' : 'Not asked yet';
  const rows = DOC_TYPES.map(t => {
    const d = docs.find(x => x.type === t.type);
    const [st, cls] = docStatus(d);
    let body = '';
    if (d) {
      const f = d.fields || {};
      const editing = docEdit === t.type;
      body += '<dl class="kv">' + t.fields.map(([k, lab]) => {
        let v = f[k] || '';
        if (k === 'dob' && v) v = fmtDate(v);
        const low = (d.low || []).includes(k) ? ' <span class="chip warn" title="Hard to read">check</span>' : '';
        return `<dt>${esc(lab)}</dt><dd>${editing && !LOCKED[k] ? `<input class="jl-docin" data-k="${esc(k)}" value="${esc(f[k] || '')}" aria-label="${esc(lab)}">` : (esc(v) || '<span class="note">not read</span>') + low}</dd>`;
      }).join('') + (editing && t.type === 'bank' ? '<dt>Full account no.</dt><dd><input class="jl-docin" data-k="account" placeholder="Only if correcting it" aria-label="Full account number"></dd>' : '') + '</dl>';
      body += '<ul class="jl-checks">' + (d.checks || []).map(ch => `<li class="${ch.ok ? 'ok' : 'bad'}">${ch.ok ? '✓' : '✗'} ${esc(ch.label)}</li>`).join('') + '</ul>';
      if (d.candidateCorrection) body += `<p class="note"><b>Candidate says:</b> ${esc(d.candidateCorrection)}</p>`;
      if (d.fileNote) body += `<p class="note">${esc(d.fileNote)}</p>`;
      if (d.reviewedBy) body += `<p class="note">Reviewed by ${esc(d.reviewedBy)} ${esc(fmtTime(d.reviewedAt))}</p>`;
      body += '<div class="row" style="gap:6px;margin-top:6px">' +
        (d.fileStored ? `<a class="btn small" href="/api/docs/file?candidateId=${encodeURIComponent(c.id)}&type=${t.type}" target="_blank" rel="noopener">View file</a>` : '') +
        (editing ? `<button class="btn primary small" data-act="save" data-t="${t.type}" type="button">Save and approve</button><button class="btn small" data-act="cancel" type="button">Cancel</button>`
          : `<button class="btn small" data-act="approve" data-t="${t.type}" type="button">Approve</button><button class="btn small" data-act="edit" data-t="${t.type}" type="button">Edit</button><button class="btn small" data-act="reject" data-t="${t.type}" type="button">Reject</button>`) + '</div>';
    }
    return `<div class="jl-doc"><div class="jl-dochead"><b>${esc(t.label)}</b><span class="chip ${cls}">${esc(st)}</span></div>${body}</div>`;
  }).join('');
  box.innerHTML = `<div class="jl-dochead"><h3 style="margin:0">Documents</h3><button class="btn small primary" id="jlAskDocs" type="button" ${ready ? '' : 'disabled'}>Ask for documents</button></div>
    <p class="note" style="margin:6px 0 10px">${ready ? consent : 'Document reading is not connected yet (needs DOCINTEL_ENDPOINT, DOCINTEL_KEY and STORAGE_CONNECTION_STRING).'}</p>${rows}`;
  if ($('#jlAskDocs')) $('#jlAskDocs').onclick = askDocs;
  box.querySelectorAll('button[data-act]').forEach(b => { b.onclick = () => docAction(b.dataset.act, b.dataset.t); });
}

async function askDocs() {
  const c = current(); if (!c) return;
  $('#jlAskDocs').disabled = true;
  const r = await U().getJson('/api/docs/request', { method: 'POST', body: JSON.stringify({ candidateId: c.id }) }).catch(() => ({ ok: false }));
  if ($('#jlAskDocs')) $('#jlAskDocs').disabled = false;
  await afterSend(r, `Asked ${c.name} for documents on WhatsApp.`);
}

async function docAction(act, type) {
  const c = current(); if (!c) return;
  if (act === 'edit') { docEdit = type; renderDocs(); return; }
  if (act === 'cancel') { docEdit = null; renderDocs(); return; }
  const body = { candidateId: c.id, type, action: act === 'reject' ? 'reject' : 'approve' };
  if (act === 'save') { body.fields = {}; document.querySelectorAll('#jlDocs .jl-docin').forEach(i => { if (i.value.trim()) body.fields[i.dataset.k] = i.value.trim(); }); }
  if (act === 'reject') { const note = window.prompt('Why is this document rejected? (saved for the record)', 'Not clear'); if (note === null) return; body.note = note; }
  const r = await U().getJson('/api/docs/review', { method: 'POST', body: JSON.stringify(body) }).catch(() => ({ ok: false }));
  if (!r.ok) { U().toast('Not saved' + (r.body && r.body.error ? ': ' + r.body.error : '')); return; }
  docEdit = null;
  U().toast(act === 'reject' ? 'Rejected. Click "Ask for documents" to ask the candidate again.' : 'Approved.');
  await reload(selected);
}

/* ---------- actions ---------- */
async function afterSend(r, okMsg) {
  const u = U();
  if (r.ok) { u.toast(okMsg); await reload(selected); } else u.toast(u.explain(r));
}

async function sendPreview() {
  const c = current(); if (!c || !preview) return;
  const text = ($('#jlPrevText').value || '').trim();
  const withBtns = $('#jlPrevBtns') ? $('#jlPrevBtns').checked : false;
  const items = [];
  if ($('#jlPrevLetter').checked) {
    const it = { type: 'letter' };
    // Use the freshly generated letter when the Offer desk has this same candidate open.
    const cur = window.tcmplCurrent && window.tcmplCurrent();
    const pdf = window.tcmplLetterPdf && window.tcmplLetterPdf();
    if (cur && U().candId(cur.mobile) === c.id && pdf && pdf.blob instanceof Blob) { it.pdfBase64 = await U().blobToBase64(pdf.blob); it.filename = pdf.name; }
    items.push(it);
  }
  if (text) {
    const it = { type: 'text', text };
    const btns = preview.buttons;
    if (withBtns && btns.length) {
      if (btns.length <= 3 && btns.every(b => b.length <= 20)) it.buttons = btns;
      else it.text += '\n\nReply with: ' + btns.join(' / ');
    }
    items.push(it);
  }
  if (!items.length) { U().toast('Nothing to send.'); return; }
  $('#jlPrevSend').disabled = true;
  const r = await U().push(c.id, items, preview.label, preview.key);
  if ($('#jlPrevSend')) $('#jlPrevSend').disabled = false;
  await afterSend(r, `Sent "${preview.label}" to ${c.name} on WhatsApp.`);
}

async function sendLetter() {
  const c = current(); if (!c) return;
  const r = await U().push(c.id, [{ type: 'letter' }], 'Offer letter resent');
  await afterSend(r, `Offer letter sent to ${c.name} on WhatsApp.`);
}

async function sendOwn(e) {
  e.preventDefault();
  const c = current(); const text = $('#jlText').value.trim();
  if (!c || !text) return;
  $('#jlSend').disabled = true;
  const r = await U().getJson('/api/wa/send', { method: 'POST', body: JSON.stringify({ candidateId: c.id, text }) }).catch(() => ({ ok: false }));
  $('#jlSend').disabled = false;
  if (r.ok) { $('#jlText').value = ''; loadMsgs(true); } else U().toast(U().explain(r));
}

window.tcmplLive = { reload };

(function waitForApp(n) {
  if (window.tcmplWAUtil && mount()) return;
  if (n > 100) return;
  setTimeout(() => waitForApp(n + 1), 100);
})(0);
