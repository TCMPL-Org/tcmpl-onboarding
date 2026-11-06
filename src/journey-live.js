// Candidate journey: the one screen HR runs each candidate from.
//   Top    – a big stage bar: Offer → Documents → Joining forms → Pre-joining → Day-1 readiness → Joining day → Induction → First 90 days
//   Left   – every step, day by day, grouped by stage, each with a live status (✓ done · Now · Waiting · 🔴 needs HR)
//   Middle – the candidate's real WhatsApp conversation, with an HR message box
//   Right  – the selected step, always the same four parts: what it is · what is sent · one main button · result
// All messages to the candidate are sent from here. The other tabs (Joining forms, Day-1 readiness, Induction,
// Client setup) are for setting things up. The original click-through simulation is kept behind "Demo mode".

const U = () => window.tcmplWAUtil;
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const POLL_MS = 5000;
const DEMO_KEY = 'tcmpl-journey-demo';

const PHASES = [
  { id: 'offer', label: 'Offer' },
  { id: 'docs', label: 'Documents' },
  { id: 'forms', label: 'Joining forms' },
  { id: 'pre', label: 'Pre-joining' },
  { id: 'ready', label: 'Day-1 readiness' },
  { id: 'day1', label: 'Joining day' },
  { id: 'induct', label: 'Induction' },
  { id: 'p90', label: 'First 90 days' },
  { id: 'close', label: 'Closure' }
];
// Legacy demo steps that the client's journey check-ins replace (when check-ins are on).
const REPLACED = new Set(['resign', 'checkin', 'call', 'day1kit', 'survey_d1', 'week1', 'pulse15', 'pulse30', 'pulse45', 'pulse60', 'pulse75', 'final90', 'm_1on1', 'm_goals', 'm_prob']);
const TO_LABEL = { candidate: 'the candidate', manager: 'the manager', hr: 'HR', buddy: 'the buddy', email: 'an email address' };
const CH_LABEL = { whatsapp: 'WhatsApp', email: 'email', both: 'WhatsApp and email' };
const PHASE_OF = {
  offer: 'offer', docs: 'docs', forms: 'forms', confirm: 'forms',
  resign: 'pre', story: 'pre', checkin: 'pre', manager_intro: 'pre',
  it_15: 'ready', m_prep: 'ready', it_7: 'ready', day1kit: 'ready', m_prep2: 'ready', it_2: 'ready', call: 'ready', ann: 'ready',
  welcome: 'day1', stat: 'day1', induct: 'induct',
  survey_d1: 'p90', week1: 'p90', pulse15: 'p90', pulse30: 'p90', pulse45: 'p90', pulse60: 'p90', pulse75: 'p90', final90: 'p90', m_1on1: 'p90', m_goals: 'p90', m_prob: 'p90'
};
const KIND_LABEL = { session: 'Meeting / connect', content: 'Deck or document', task: 'Task', quiz: 'Quiz' };
// Day-1 readiness: which checklist tasks each owner step covers, and the candidate's WhatsApp checks.
const OWNER_TASKS = { it_15: ['laptop', 'email', 'seat', 'card', 'cp*'], it_7: ['laptop', 'email', 'seat', 'card', 'cp*'], it_2: ['laptop', 'email', 'seat', 'card', 'cp*'], m_prep: ['welcome', 'buddy'], m_prep2: ['welcome', 'buddy'], ann: ['announce'], stat: ['statutory'] };
const CHECKS = [
  { id: 'email', k: 'email', day: -2, time: '10:00', phase: 'ready', label: 'Candidate check: email ID received?', text: 'Quick check before you join: have you received your company email ID and login details?' },
  { id: 'card', k: 'card', day: 0, time: '11:00', phase: 'day1', label: 'Candidate check: access card?', text: 'Did you get your access card or ID badge?' },
  { id: 'laptop', k: 'laptop', day: 0, time: '12:00', phase: 'day1', label: 'Candidate check: laptop working?', text: 'Is your laptop set up, and can you log in?' },
  { id: 'buddy', k: 'buddy', day: 0, time: '16:00', phase: 'day1', label: 'Candidate check: met your buddy?', text: 'Have you met your buddy today?' }
];
const RST = { not_started: ['Not started', ''], requested: ['Requested', 'info'], done: ['Done', 'ok'], issue: ['Problem', 'bad'] };
const dueOff = d => { const m = /^D([+-]\d+)$/.exec(d || ''); return m ? +m[1] : 0; };
const emailIn = s => { const m = /([\w.+-]+@[\w-]+\.[\w.-]+)/.exec(s || ''); return m ? m[1] : ''; };
let readyTpl = [];

const IND_ST = { done: ['✓ Done', 'ok'], sent: ['Waiting for candidate', 'info'], not_yet: ['Not yet, will ask again', 'warn'], rescheduled: ['Rescheduled', 'info'], escalated: ['Needs HR: not confirmed', 'bad'], help: ['Needs HR: candidate asked for help', 'bad'], retry: ['Quiz not passed yet', 'warn'], failed: ['Needs HR: quiz not passed', 'bad'], skipped: ['Skipped', ''] };

let ckSetups = {}, cands = [], selected = null, plan = [], steps = [], sel = null, msgs = [], lastSig = '', docs = [], docEdit = null, health = {}, preview = null, plans = {}, missingQ = null;

function fmtDate(iso) {
  if (!iso) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + 'T00:00:00') : new Date(iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
const shortDate = iso => fmtDate(iso).replace(/ \d{4}$/, '');
function fmtTime(iso) { return iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''; }
const inr = n => n ? '₹' + Math.round(n).toLocaleString('en-IN') : '—';
function addDays(iso, n) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); if (!m) return ''; const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n)); return d.toISOString().slice(0, 10); }
// "Today" for the candidate on screen: real time, or the Walkthrough clock when it has been moved.
let clockOff = 0;
const nowMs = () => Date.now() + clockOff;
const todayIso = () => { const d = new Date(nowMs()); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const JUMPS = [[-28, 'D-28 Resignation'], [-21, 'D-21 Relieving date'], [-15, 'D-15 Owners'], [-7, 'D-7'], [-3, 'D-3 Joining details'], [-2, 'D-2'], [-1, 'D-1'], [0, 'Day 1'], [1, 'D+1 Infra'], [7, 'D+7'], [14, 'D+14 Fortnightly'], [30, 'D+30 Goals'], [45, 'D+45'], [60, 'D+60'], [89, 'D+89 Survey'], [90, 'D+90 Closing call'], [94, 'D+94 Closure']];

function demoOn() { try { return localStorage.getItem(DEMO_KEY) === '1'; } catch { return false; } }
function setDemo(on) { try { localStorage.setItem(DEMO_KEY, on ? '1' : '0'); } catch { /* storage unavailable */ } applyMode(); }

function profileOf(c) {
  const p = Object.assign({ name: c.name, first: c.first, role: c.role, doj: c.doj, client: c.client, mobile: c.phone, email: c.email }, c.profile || {});
  p.accepted = /accept/i.test(c.stage || '');
  return p;
}
const current = () => cands.find(c => c.id === selected);
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
      <span class="chip" id="jlRisk"></span><span class="chip" id="jlWindow"></span>
    </div>
    <div class="row">
      <button class="btn small primary" id="jlNext" type="button">Go to next step</button>
      <button class="btn small" id="jlRefresh" type="button">Refresh</button>
      <label class="note" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="jlDemo"> Demo mode</label>
    </div>
  </div>
  <div class="card jl-stagebar" id="jlStages"></div>
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
      <div class="card jl-prev jl-step" id="jlStep"></div>
      <div class="card" style="margin-top:16px" id="jlFacts"></div>
    </div>
  </div>
  <div id="jlDemoBar" class="card" style="padding:8px 14px;margin-bottom:12px;display:none"><label class="note" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="jlDemo2" checked> Demo mode: simulated journey for presentations. Untick to work with real candidates.</label></div>`;
  intro.after(wrap);
  $('#jlCand').onchange = () => { selected = $('#jlCand').value; sel = null; preview = null; lastSig = ''; docs = []; docEdit = null; missingQ = null; renderAll(); loadMsgs(true); loadDocs(); };
  $('#jlRefresh').onclick = () => reload(selected);
  $('#jlNext').onclick = () => { const n = nextStep(); if (n) selectStep(n.id, true); };
  $('#jlDemo').onchange = () => setDemo($('#jlDemo').checked);
  $('#jlDemo2').onchange = () => setDemo($('#jlDemo2').checked);
  $('#jlForm').onsubmit = sendOwn;
  setInterval(() => { if (!sec.hidden && !demoOn() && document.visibilityState === 'visible') loadMsgs(false); }, POLL_MS);
  document.querySelectorAll('nav.tabs button').forEach(b => b.addEventListener('click', () => { if (b.dataset.tab === 'journey' && !demoOn()) reload(selected); }));
  applyMode();
  return true;
}

function applyMode() {
  const sec = $('#tab-journey'); if (!sec) return;
  const demo = demoOn();
  [...sec.children].forEach(el => { if (el.classList.contains('intro') || el.id === 'jlive') return; show(el, demo); });
  show($('.jl-top'), !demo);
  show($('#jlStages'), !demo && cands.length > 0);
  show($('#jlGrid'), !demo && cands.length > 0);
  show($('#jlEmpty'), !demo && cands.length === 0);
  show($('#jlDemoBar'), demo);
  if ($('#jlDemo')) $('#jlDemo').checked = demo;
  if ($('#jlDemo2')) $('#jlDemo2').checked = demo;
  const p = sec.querySelector('.intro p');
  if (p) p.textContent = demo
    ? "Demo mode: step through the agent's touchpoints from offer to Day 90 and reply as the candidate with the buttons."
    : 'Run each candidate from here: follow the steps on the left from top to bottom. Click a step to see what is sent and press its button. Everything the candidate receives on WhatsApp goes from this screen.';
  if (!demo) reload(selected);
}

/* ---------- data ---------- */
async function reload(want, stepId) {
  if (stepId) { sel = stepId; preview = null; }
  const u = U(); if (!u) return;
  health = (await u.loadHealth()) || {};
  if (!health.db) { cands = []; renderAll(); return; }
  const r = await u.getJson('/api/data/candidates').catch(() => ({ ok: false }));
  if (!r.ok) return;
  cands = (r.body.items || []).map(i => Object.assign({ id: i.id }, i.data))
    .filter(c => c.profile || c.offerId || (c.stage && c.stage !== 'Unknown contact'))
    .sort((a, b) => String(b.releasedAt || b.lastMessageAt).localeCompare(String(a.releasedAt || a.lastMessageAt)));
  if (want && cands.some(c => c.id === want)) { if (selected !== want && !stepId) { sel = null; preview = null; } selected = want; }
  if (!cands.some(c => c.id === selected)) { selected = cands[0] ? cands[0].id : null; sel = null; preview = null; }
  await loadPlan(current());
  renderAll();
  if (stepId) selectStep(stepId, true);
  loadMsgs(true);
  loadDocs();
  loadMissing();
}

async function loadPlan(c) {
  const client = c && c.profile && c.profile.client;
  if (client && ckSetups[client] === undefined) {
    const r = await U().getJson('/api/checkins/setup', { method: 'POST', body: JSON.stringify({ client }) }).catch(() => ({ ok: false }));
    ckSetups[client] = r.ok ? r.body : null;
  }
  if (!client || plans[client] !== undefined) return;
  const r = await U().getJson(`/api/data/plans/${encodeURIComponent(client)}`).catch(() => ({ ok: false }));
  plans[client] = r.ok && r.body.data ? r.body.data : null;
}

async function loadDocs() {
  const u = U(); if (!u || !selected) { docs = []; return; }
  const want = selected;
  const r = await u.getJson('/api/data/documents').catch(() => ({ ok: false }));
  if (!r.ok || want !== selected) return;
  docs = (r.body.items || []).map(i => i.data).filter(d => d && d.candidateId === selected);
  rerender();
}

async function loadMissing() {
  if (!selected) return;
  const want = selected;
  const r = await U().getJson('/api/forms/missing', { method: 'POST', body: JSON.stringify({ candidateId: want }) }).catch(() => ({ ok: false }));
  if (r.ok && want === selected) { missingQ = r.body.missing || {}; rerender(); }
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
  if (!force) {
    const r2 = await u.getJson('/api/data/candidates/' + encodeURIComponent(selected)).catch(() => ({ ok: false }));
    if (r2.ok) { const i = cands.findIndex(c => c.id === selected); if (i >= 0) cands[i] = Object.assign({ id: selected }, r2.body.data); }
    await loadDocs(); loadMissing(); rerender();
  }
}

/* ---------- steps and their status ---------- */
const S = (text, cls, done = false, red = false, waiting = false) => ({ text, cls, done, red, waiting });

function docsStatus(c) {
  const d = c.docs || {}, items = d.items || {};
  const st = ['aadhaar', 'pan', 'bank'].map(t => (items[t] || {}).status);
  if (st.some(s => s === 'needs_review' || s === 'rejected') || docs.some(x => x.status === 'needs_review')) return S('Needs HR: review documents', 'bad', false, true);
  if (st.every(s => s === 'confirmed')) return S('✓ All 3 confirmed', 'ok', true);
  if (d.declinedAt) return S('Needs HR: candidate said "Not now"', 'bad', false, true);
  if (d.requestedAt && !d.consentAt) return S('Waiting for consent', 'info', false, false, true);
  if (d.consentAt) return S(`Waiting for candidate: ${st.filter(s => s === 'confirmed').length} of 3 in`, 'info', false, false, true);
  return null;
}
function formsStatus(c) {
  const f = c.forms || {}, d = c.details || {};
  if (f.approvedBy) return S('✓ Approved by HR', 'ok', true);
  if (f.candidateNote && !f.candidateConfirmedAt) return S('Needs HR: candidate asked for a change', 'bad', false, true);
  if (f.candidateConfirmedAt) return S('Needs HR: approve forms', 'bad', false, true);
  if (f.pendingConfirm) return S('Waiting for candidate to confirm forms', 'info', false, false, true);
  if (d.step) return S('Waiting: answering questions on WhatsApp', 'info', false, false, true);
  if (d.completedAt) return S('Ready: send forms to confirm', 'warn');
  return null;
}
function indStatus(c, it) {
  const s = ((c.induction && c.induction.items) || {})[it.id] || {};
  if (IND_ST[s.status]) { const [t, cls] = IND_ST[s.status]; return S(t + (s.score ? ' · ' + s.score : ''), cls, s.status === 'done' || s.status === 'skipped', cls === 'bad', cls === 'info'); }
  if (s.remindedAt) return S('Reminded, waiting', 'info', false, false, true);
  return null;
}

function ownerTasks(key) {
  const want = OWNER_TASKS[key] || [];
  return readyTpl.filter(t => want.includes(t.k) || (want.includes('cp*') && t.k.startsWith('cp')));
}
function ownerStatus(c, s) {
  const tasks = ownerTasks(s.key);
  if (!tasks.length) return null;
  const items = (c.readiness && c.readiness.items) || {};
  const doj = (c.profile && c.profile.doj) || c.doj, today = todayIso();
  const st = tasks.map(t => ({ t, i: items[t.k] || {}, due: addDays(doj, dueOff(t.due)) }));
  if (st.some(x => x.i.status === 'issue')) return S('Needs HR: problem reported', 'bad', false, true);
  if (st.every(x => x.i.status === 'done')) return S(`✓ Done (${st.length} of ${st.length})`, 'ok', true);
  // From D-2, anything still open is escalated.
  if (s.key === 'it_2' || s.key === 'm_prep2' ? s.date <= today : st.some(x => x.due < today && x.i.status !== 'done')) {
    const open = st.filter(x => x.i.status !== 'done').length;
    if (s.date <= today) return S(`Needs HR: ${open} still open`, 'bad', false, true);
  }
  if (st.some(x => x.i.status === 'requested')) return S(`Requested, ${st.filter(x => x.i.status === 'done').length} of ${st.length} done`, 'info', false, false, true);
  return null;
}
function checkStatus(c, q) {
  const r = c.readiness || {}, a = (r.asks || {})[q.id] || {};
  if (a.answer === 'yes') return S('✓ Candidate said yes', 'ok', true);
  if (a.answer === 'not_yet') return S('Needs HR: candidate says not yet', 'bad', false, true);
  if (a.skipped) return S('Skipped (too late)', '', true);
  if (a.sentAt) return S('Asked, waiting for reply', 'info', false, false, true);
  return null;
}

function ckStatus(c, s) {
  const a = ((c.checkins || {}).asks || {})[s.key];
  if (!a) return null;
  if (a.answer && a.flagged) return S('Needs HR: ' + a.answer, 'bad', false, true);
  if (a.answer) return S('✓ ' + (s.o.item.answer === 'rating' ? 'Rated ' + a.answer + '/5' : a.answer), 'ok', true);
  if (a.escalatedAt) return S('Needs HR: no answer', 'bad', false, true);
  if (a.missingAt) return S('Needs HR: ' + (a.why || 'no recipient'), 'bad', false, true);
  if (a.skipped) return S(a.why === 'not needed' ? 'Not needed' : 'Skipped (too late)', '', true);
  if (a.sentAt && s.o.item.answer === 'none') return S('✓ Sent ' + fmtTime(a.sentAt), 'ok', true);
  if (a.sentAt) return S((a.remindedAt ? 'Reminded, ' : 'Sent, ') + 'waiting for answer', 'info', false, false, true);
  return null;
}

function buildSteps(c) {
  clockOff = +c.clockOffsetMs || 0;
  const out = [];
  const doj = (c.profile && c.profile.doj) || c.doj;
  const sent = c.touchpoints || {};
  const p = plans[c.profile && c.profile.client];
  const indItems = p && Array.isArray(p.items) ? p.items : null;
  const ck = ckSetups[c.profile && c.profile.client];
  const ckOn = Boolean(ck && ck.setup && ck.setup.enabled !== false);
  for (const tp of plan) {
    if (tp.key === 'induct' && indItems && indItems.length) continue; // replaced by the client's real induction plan
    if (ckOn && REPLACED.has(tp.key)) continue; // replaced by the client's journey check-ins
    const phase = PHASE_OF[tp.key] || (tp.date < doj ? 'pre' : 'p90');
    const kind = tp.key === 'docs' ? 'docs' : tp.key === 'confirm' ? 'forms' : tp.track !== 'c' ? 'owner' : 'tp';
    out.push({ id: 'tp:' + tp.key, key: tp.key, kind, phase, date: tp.date, rel: tp.rel, label: tp.label, track: tp.track, sentAt: sent[tp.key] && sent[tp.key].at });
  }
  for (const q of CHECKS) {
    if (!readyTpl.some(t => t.k === q.k)) continue;
    out.push({ id: 'rc:' + q.id, kind: 'rcheck', q, phase: q.phase, date: addDays(doj, q.day), rel: q.day < 0 ? 'D' + q.day : 'D-day', label: q.label, track: 'c', time: q.time });
  }
  if (ckOn) for (const o of ck.occ || []) {
    const it = o.item;
    const rel = o.day === 0 ? 'Day 1' : o.day < 0 ? 'D' + o.day : 'D+' + o.day;
    out.push({ id: 'ck:' + o.key, kind: 'ck', key: o.key, o, phase: it.stage, date: addDays(doj, o.day), rel, time: it.time, track: it.to === 'candidate' ? 'c' : 'm',
      label: it.title + (/@/.test(o.key) && !/\(D/.test(it.title) ? ` (${rel})` : '') });
  }
  for (const it of indItems || []) {
    out.push({ id: 'ind:' + it.id, kind: 'ind', item: it, phase: 'induct', date: addDays(doj, +it.day || 0), rel: 'Day ' + (+it.day || 0), label: it.title, track: 'c', time: it.time });
  }
  const today = todayIso();
  for (const s of out) {
    let st = null;
    if (s.kind === 'docs') st = docsStatus(c);
    else if (s.kind === 'forms') st = formsStatus(c);
    else if (s.kind === 'ind') st = indStatus(c, s.item);
    else if (s.kind === 'owner') st = ownerStatus(c, s);
    else if (s.kind === 'rcheck') st = checkStatus(c, s.q);
    else if (s.kind === 'ck') st = ckStatus(c, s);
    if (!st && s.sentAt) st = S('✓ Sent ' + fmtTime(s.sentAt), 'ok', true);
    if (!st) st = s.date <= today ? S('Due now', 'warn') : S('Upcoming', '');
    s.status = st;
  }
  const order = PHASES.map(x => x.id);
  out.sort((a, b) => order.indexOf(a.phase) - order.indexOf(b.phase) || String(a.date).localeCompare(String(b.date)) || String(a.time || '').localeCompare(String(b.time || '')));
  return out;
}

function phaseState(id) {
  const ss = steps.filter(s => s.phase === id);
  if (!ss.length) return 'empty';
  if (ss.some(s => s.status.red)) return 'red';
  if (ss.every(s => s.status.done)) return 'done';
  if (ss.some(s => s.status.done || s.status.waiting)) return 'active';
  return 'todo';
}
function currentPhase() {
  const red = PHASES.find(p => phaseState(p.id) === 'red');
  if (red) return red.id;
  const act = PHASES.find(p => ['active', 'todo'].includes(phaseState(p.id)));
  return act ? act.id : PHASES[PHASES.length - 1].id;
}
// The step HR should look at now: anything red, else the earliest step that is due and not done.
function nextStep() {
  const today = todayIso();
  return steps.find(s => s.status.red)
    || steps.find(s => !s.status.done && !s.status.waiting && s.date <= today)
    || steps.find(s => !s.status.done && !s.status.waiting)
    || steps.find(s => s.status.waiting);
}

function relDay(c) {
  const doj = (c.profile && c.profile.doj) || c.doj; if (!doj) return '';
  const d = Math.round((new Date(todayIso() + 'T00:00:00') - new Date(doj + 'T00:00:00')) / 864e5);
  return d === 0 ? 'Day 1 (joining day)' : d < 0 ? `D${d}` : `D+${d}`;
}

async function walk(action, extra, okMsg) {
  const c = current(); if (!c) return;
  const r = await U().getJson('/api/notify/' + action, { method: 'POST', body: JSON.stringify(Object.assign({ candidateId: c.id }, extra)) }).catch(() => ({ ok: false }));
  if (!r.ok) { U().toast('Not done: ' + ((r.body && (r.body.detail || r.body.error)) || 'please try again')); return; }
  U().toast(okMsg || (action === 'run' ? (r.body.sent ? `Sent ${r.body.sent} due item(s).` : 'Nothing is due at this moment.') : 'Done.'));
  if (action === 'reset') { sel = null; lastSig = ''; docs = []; }
  await reload(selected);
}

/* ---------- rendering ---------- */
function rerender() { const c = current(); if (!c) return; steps = buildSteps(c); renderHeader(); renderStages(); renderTps(); renderStep(); renderPicker(); }

function renderAll() {
  if (!$('#jlive')) return;
  const none = !cands.length;
  show($('#jlEmpty'), !demoOn() && none);
  show($('#jlGrid'), !demoOn() && !none);
  show($('#jlStages'), !demoOn() && !none);
  show($('.jl-top'), !demoOn());
  ['#jlCand', '#jlNext'].forEach(q => { $(q).disabled = none; });
  const c = current();
  plan = c && window.tcmplPlanFor ? (() => { try { return window.tcmplPlanFor(profileOf(c)); } catch (e) { console.warn(e); return []; } })() : [];
  readyTpl = c && window.tcmplReadyFor ? (() => { try { return window.tcmplReadyFor(profileOf(c)) || []; } catch (e) { console.warn(e); return []; } })() : [];
  steps = c ? buildSteps(c) : [];
  if (c && !sel) { const n = nextStep(); sel = n ? n.id : null; preview = null; }
  renderPicker(); renderHeader(); renderStages(); renderTps(); renderStep(); renderFacts(); renderChat();
}

function renderPicker() {
  const s = $('#jlCand'); if (!s) return;
  s.innerHTML = cands.map(c => {
    let label = c.stage || '';
    if (c.id === selected && steps.length) { const ph = PHASES.find(p => p.id === currentPhase()); const red = steps.filter(x => x.status.red).length; label = ph.label + (red ? ` · ${red} need${red > 1 ? '' : 's'} HR` : ''); }
    return `<option value="${esc(c.id)}">${esc(c.name || '+' + c.phone)}${label ? ' · ' + esc(label) : ''}</option>`;
  }).join('');
  if (selected) s.value = selected;
}

function windowState(c) {
  if (!c || !c.lastInboundAt) return { open: false, until: null };
  const until = new Date(new Date(c.lastInboundAt).getTime() + 24 * 3600 * 1000);
  return { open: until > new Date(), until };
}

function renderHeader() {
  const c = current();
  const rk = $('#jlRisk'), wn = $('#jlWindow');
  if (!c) { rk.textContent = ''; wn.textContent = ''; return; }
  const sc = c.riskScore || 0;
  rk.textContent = 'Risk: ' + (sc >= 50 ? 'High' : sc >= 25 ? 'Medium' : 'Low');
  rk.className = 'chip ' + (sc >= 50 ? 'bad' : sc >= 25 ? 'warn' : 'ok');
  const w = windowState(c);
  const held = (c.held || []).length;
  wn.textContent = (w.open ? 'WhatsApp open until ' + w.until.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : 'Waiting for candidate to reply') + (held ? ` · ${held} message${held > 1 ? 's' : ''} queued` : '');
  wn.className = 'chip ' + (w.open ? 'teal' : 'warn');
  wn.title = w.open ? 'You can send any step until then.' : 'WhatsApp only allows free messages within 24 hours of the candidate\'s last message. Ask them to reply once (e.g. "Hi").';
  $('#jlName').textContent = c.name || '+' + c.phone;
  $('#jlSub').textContent = '+' + c.phone + (c.clientLabel ? ' · ' + c.clientLabel : '');
  $('#jlAvatar').textContent = (c.name || 'WA').split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase();
}

function renderStages() {
  const c = current(), box = $('#jlStages');
  if (!c || !box) return;
  const cur = currentPhase();
  const ns = nextStep();
  const ico = { done: '✓', red: '!', active: '●', todo: '○', empty: '–' };
  box.innerHTML = `<div class="jl-sb-head"><div><div class="lbl">${esc(c.name || '')} is at</div><div class="jl-sb-now">${esc(PHASES.find(p => p.id === cur).label)}</div></div>
    <div class="jl-sb-next">${ns ? `Next: <b>${esc(ns.label)}</b> <span class="chip ${ns.status.cls}">${esc(ns.status.text)}</span>` : 'All steps done'}</div></div>
    <div class="jl-sb">${PHASES.map(p => { const st = phaseState(p.id); return `<button type="button" class="jl-sb-step ${st} ${p.id === cur ? 'cur' : ''}" data-ph="${p.id}"><span class="jl-sb-ico">${ico[st]}</span>${esc(p.label)}</button>`; }).join('')}</div>
    <div class="jl-walk"><span class="lbl">Walkthrough clock</span>
      <span class="${clockOff ? 'chip warn' : 'note'}">${clockOff ? 'Simulated: ' + esc(new Date(nowMs()).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })) + ' · ' + esc(relDay(c)) : 'Real time'}</span>
      <select id="jlJump" aria-label="Jump to day"><option value="">Jump to…</option>${JUMPS.map(([d, l]) => `<option value="${d}">${esc(l)}</option>`).join('')}</select>
      <button class="btn small" id="jlRunDue" type="button" title="Send everything that is due at this moment (reminders, checks, induction, owner reminders)">Run due steps</button>
      ${clockOff ? '<button class="btn small" id="jlReal" type="button">Back to real time</button>' : ''}
      <button class="btn small" id="jlReset" type="button" title="Clear this candidate's journey and chat, and start the walkthrough again from the offer">Reset candidate</button></div>`;
  $('#jlJump').onchange = () => { const v = $('#jlJump').value; if (v !== '') walk('jump', { day: +v, time: '10:30' }, `Clock moved to ${JUMPS.find(j => String(j[0]) === v)[1]}, 10:30. Click "Run due steps" to send what is due.`); };
  $('#jlRunDue').onclick = () => walk('run', {}, null);
  if ($('#jlReal')) $('#jlReal').onclick = () => walk('realtime', {}, 'Back to real time.');
  $('#jlReset').onclick = () => { if (window.confirm(`Reset ${c.name}? This clears their documents, forms, readiness, induction and chat, and starts again from the offer.`)) walk('reset', {}, `${c.name} has been reset.`); };
  box.querySelectorAll('[data-ph]').forEach(b => { b.onclick = () => { const s = steps.find(x => x.phase === b.dataset.ph && !x.status.done) || steps.find(x => x.phase === b.dataset.ph); if (s) selectStep(s.id, true); }; });
}

function renderTps() {
  const c = current(), box = $('#jlTps');
  if (!c) { box.innerHTML = ''; return; }
  const ns = nextStep();
  let html = '';
  for (const ph of PHASES) {
    const ss = steps.filter(s => s.phase === ph.id);
    if (!ss.length) continue;
    html += `<div class="jl-ph ${phaseState(ph.id)}" id="jlph-${ph.id}">${esc(ph.label)}</div>`;
    html += ss.map(s => `<button type="button" class="tlitem jl-tp ${sel === s.id ? 'sel' : ''} ${s.kind === 'owner' ? 'owner' : ''} ${ns && ns.id === s.id ? 'now' : ''}" data-id="${esc(s.id)}">
      <div class="when">${esc(s.rel)}<br><span style="font-weight:500">${esc(shortDate(s.date))}</span></div>
      <div>${ns && ns.id === s.id ? '<span class="chip teal" style="float:right">Now</span>' : ''}${s.kind === 'owner' ? '<div class="trk s">' + (s.track === 'm' ? 'Manager' : 'Owners') + '</div>' : ''}${esc(s.label)}<div class="st"><span class="${s.status.cls ? 'jl-st-' + s.status.cls : 'note'}">${esc(s.status.text)}</span></div></div></button>`).join('');
  }
  box.innerHTML = '<h3>Journey</h3>' + (html || '<p class="note">No steps set for this client.</p>');
  box.querySelectorAll('.jl-tp[data-id]').forEach(b => { b.onclick = () => selectStep(b.dataset.id); });
}

function selectStep(id, scroll) {
  sel = id; preview = null; docEdit = null;
  renderTps(); renderStep();
  if (scroll) { const b = document.querySelector(`#jlTps [data-id="${CSS.escape(id)}"]`); if (b) b.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
}

/* ---------- the step panel: same four parts for every step ---------- */
function panel({ title, who, when, status, what, actions, result }) {
  return `<div class="jl-sp-head"><h3>${esc(title)}</h3>${status ? `<span class="chip ${status.cls}">${esc(status.text)}</span>` : ''}</div>
    <p class="note" style="margin:2px 0 10px">${esc(who)}${when ? ' · ' + esc(when) : ''}</p>
    <div class="jl-sp-sec"><div class="lbl">What is sent</div>${what}</div>
    ${actions ? `<div class="row jl-sp-actions">${actions}</div>` : ''}
    <div class="jl-sp-sec"><div class="lbl">Result</div>${result || '<p class="note">Nothing yet.</p>'}</div>`;
}

function renderStep() {
  const box = $('#jlStep'); if (!box) return;
  const c = current(), s = steps.find(x => x.id === sel);
  if (!c || !s) { box.innerHTML = '<h3>Step</h3><p class="note">Click a step on the left, or "Go to next step" at the top.</p>'; return; }
  const when = `${s.rel} · ${fmtDate(s.date)}${s.time ? ', ' + s.time : ''}`;
  if (s.kind === 'docs') return renderDocsStep(box, c, s, when);
  if (s.kind === 'forms') return renderFormsStep(box, c, s, when);
  if (s.kind === 'ind') return renderIndStep(box, c, s, when);
  if (s.kind === 'owner' && ownerTasks(s.key).length) return renderOwnerStep(box, c, s, when);
  if (s.kind === 'rcheck') return renderCheckStep(box, c, s, when);
  if (s.kind === 'ck') return renderCkStep(box, c, s, when);
  return renderMsgStep(box, c, s, when);
}

/* message steps (and owner steps, which are shown but not sent to the candidate) */
function buildPreview(c, s) {
  let nodes = [];
  try { nodes = window.tcmplRenderTouchpoint(profileOf(c), s.key) || []; } catch (e) { console.warn(e); }
  const texts = [], buttons = []; let letter = s.key === 'offer', extraDocs = 0;
  for (const n of nodes) {
    if (n.classList.contains('b') && n.classList.contains('in')) { const t = U().toWaText(n); if (t) texts.push(t); }
    else if (n.classList.contains('qr')) [...n.querySelectorAll('button')].forEach(b => buttons.push(b.textContent.trim()));
    else if (n.classList.contains('doc')) { if (/offer_letter/i.test(n.textContent)) letter = true; else extraDocs++; }
  }
  let text = texts.join('\n\n');
  const map = nodes.map(n => (n.matches && n.matches('a.mapcard')) ? n : (n.querySelector && n.querySelector('a.mapcard'))).find(Boolean);
  if (map && map.href && !text.includes(map.href)) text += '\n\nLocation on Google Maps: ' + map.href;
  // The offer step asks for a clear answer.
  const btns = s.key === 'offer' ? ['Accept offer', 'I have questions', 'Decline'] : buttons.filter(Boolean);
  return { id: s.id, text, buttons: btns, letter, extraDocs };
}

const candEmail = c => c.email || (c.profile && c.profile.email) || '';

function renderMsgStep(box, c, s, when) {
  if (!preview || preview.id !== s.id) preview = buildPreview(c, s);
  const owner = s.kind === 'owner';
  const btnOk = preview.buttons.length && preview.buttons.length <= 3 && preview.buttons.every(b => b.length <= 20);
  const what = `<textarea id="jlPrevText" aria-label="Message" ${owner ? 'readonly' : ''}>${esc(preview.text)}</textarea>
    ${!owner && preview.buttons.length ? `<div class="note" style="margin-top:8px">${btnOk ? 'Reply buttons:' : 'Reply options (sent as text):'}</div><div class="jl-btns">${preview.buttons.map(b => `<span class="chip teal">${esc(b)}</span>`).join('')}</div>
      <label class="note" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="jlPrevBtns" checked> Include reply ${btnOk ? 'buttons' : 'options'}</label>` : ''}
    ${!owner ? `<label class="note" style="display:flex;gap:6px;align-items:center;margin-top:6px"><input type="checkbox" id="jlPrevLetter" ${preview.letter ? 'checked' : ''}> Attach the offer letter PDF</label>` : ''}
    ${preview.extraDocs && !owner ? `<p class="note">${preview.extraDocs} other attachment(s) in this step are examples only and are not sent.</p>` : ''}
    ${!owner ? `<label class="note" style="display:flex;gap:6px;align-items:center;margin-top:6px"><input type="checkbox" id="jlPrevWa" checked> WhatsApp</label>
      <label class="note" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="jlPrevEmail" ${health.email && candEmail(c) ? '' : 'disabled'}> Email to ${esc(candEmail(c) || 'candidate (no email on the offer)')}${health.email ? '' : ' (email not set up yet)'}</label>` : ''}`;
  box.innerHTML = panel({
    title: s.label, status: s.status, when,
    who: owner ? (s.track === 'm' ? 'For the manager, not the candidate' : 'For IT, Admin and Security, not the candidate') : 'To the candidate on WhatsApp',
    what,
    actions: owner ? '<span class="note">Sending to owners and tracking their replies comes with Day-1 readiness (being built next). For now, copy this message to them.</span><button class="btn small" id="jlCopy" type="button">Copy message</button>'
      : `<button class="btn primary" id="jlPrevSend" type="button">${s.sentAt ? 'Send again' : 'Send on WhatsApp'}</button>`,
    result: s.sentAt ? `<p>Sent ${esc(fmtTime(s.sentAt))}. The candidate's reply appears in the chat.</p>` : ''
  });
  if ($('#jlPrevSend')) $('#jlPrevSend').onclick = () => sendPreview(s);
  if ($('#jlCopy')) $('#jlCopy').onclick = async () => { try { await navigator.clipboard.writeText($('#jlPrevText').value); U().toast('Message copied.'); } catch { U().toast('Select the text and copy it.'); } };
}

/* Day-1 readiness: owner tasks (email drafts from HR's own Outlook) */
function mailFor(c, t, due) {
  const p = c.profile || {};
  const short = (window.tcmplShortName && window.tcmplShortName()) || c.clientLabel || '';
  const subject = `New colleague joining on ${fmtDate(p.doj)}: ${t.task}`;
  const body = `Hello,\n\n${c.name} joins ${short} as ${p.role || 'a new colleague'} on ${fmtDate(p.doj)}${p.mgr ? ', reporting to ' + p.mgr : ''}.\n\nPlease arrange: ${t.task}, by ${fmtDate(due)}.\n\nPlease reply to this email once it is done, so we can confirm Day 1 is ready.\n\nThank you`;
  return { to: emailIn(t.owner), subject, body };
}

function renderOwnerStep(box, c, s, when) {
  const tasks = ownerTasks(s.key);
  const doj = (c.profile && c.profile.doj) || c.doj, today = todayIso();
  const items = (c.readiness && c.readiness.items) || {};
  const rows = tasks.map(t => {
    const i = items[t.k] || {}, due = addDays(doj, dueOff(t.due));
    const [lab, cls] = RST[i.status || 'not_started'];
    const late = i.status !== 'done' && due < today;
    return `<div class="jl-rt"><div><b>${esc(t.task)}</b><div class="note">${esc(t.owner)}${emailIn(t.owner) ? '' : ' · <i>no email set</i>'} · due ${esc(shortDate(due))}</div>
      ${i.emailedAt ? `<div class="note">Emailed ${esc(fmtTime(i.emailedAt))}${i.reminderAt ? ' · reminder ' + esc(fmtTime(i.reminderAt)) : ''}${i.escalatedAt ? ' · escalated ' + esc(fmtTime(i.escalatedAt)) : ''}${i.ownerConfirmedAt ? ' · owner confirmed ✓' : ''}</div>` : ''}
      ${i.candidate ? `<div class="note">${esc(i.candidate)}</div>` : ''}${i.note ? `<div class="note">${esc(i.note)}</div>` : ''}</div>
      <div class="jl-rt-a"><span class="chip ${late && cls !== 'bad' ? 'bad' : cls}">${esc(late && i.status !== 'issue' ? 'Overdue' : lab)}</span>
      <button class="btn small" data-mail="${esc(t.k)}" type="button">Email owner</button>
      ${i.status !== 'done' ? `<button class="btn small" data-rs="done" data-k="${esc(t.k)}" type="button">Done</button>` : `<button class="btn small" data-rs="requested" data-k="${esc(t.k)}" type="button">Reopen</button>`}
      ${i.status !== 'issue' ? `<button class="btn small" data-rs="issue" data-k="${esc(t.k)}" type="button">Problem</button>` : ''}</div></div>`;
  }).join('');
  const sample = tasks[0] ? mailFor(c, tasks[0], addDays(doj, dueOff(tasks[0].due))) : null;
  box.innerHTML = panel({
    title: s.label, status: s.status, when,
    who: s.track === 'm' ? 'For the manager, not the candidate' : 'For IT, Admin and Security, not the candidate',
    what: `<p style="margin:0">${health.email ? 'An email to each owner, with <b>Mark as done</b> and <b>Report a problem</b> buttons. They get a reminder the day before it is due; if it is still open the day after, HR is emailed and it turns red here.' : 'An email from your Outlook to each owner (automatic email is not set up yet). "Email owner" opens it ready to send and marks the task <i>Requested</i>.'}</p>
      ${health.email ? '<label class="note" style="display:block;margin-top:8px">CC (optional, besides the client\'s default CC)<input id="jlOwnerCc" type="text" placeholder="manager@company.com, clienthr@company.com" style="width:100%;margin-top:4px"></label>' : ''}${sample ? `<details style="margin-top:6px"><summary class="note">See the email</summary><pre class="jl-mail">Subject: ${esc(sample.subject)}\n\n${esc(sample.body)}</pre></details>` : ''}<p class="note" style="margin:6px 0 0">Add owners' emails in Client setup → People, e.g. <i>Rohit Verma, IT &lt;rohit@company.com&gt;</i>.</p>`,
    actions: '',
    result: rows || '<p class="note">No tasks for this step.</p>'
  });
  box.querySelectorAll('[data-mail]').forEach(b => { b.onclick = async () => {
    const t = tasks.find(x => x.k === b.dataset.mail); const dueDate = addDays(doj, dueOff(t.due)); const m = mailFor(c, t, dueDate);
    if (health.email) {
      if (!m.to) { U().toast(`No email for ${t.owner}. Add it in Client setup → People, e.g. ${t.owner} <name@company.com>.`); return; }
      b.disabled = true;
      const r = await U().getJson('/api/notify/owner', { method: 'POST', body: JSON.stringify({ candidateId: c.id, k: t.k, task: t.task, owner: t.owner, cc: ($('#jlOwnerCc') || {}).value || '', subject: m.subject, body: m.body, dueDate }) }).catch(() => ({ ok: false }));
      b.disabled = false;
      if (!r.ok) { U().toast('Email not sent: ' + ((r.body && (r.body.detail || r.body.error)) || 'error')); return; }
      U().toast(`Emailed ${r.body.to.join(', ')}${r.body.cc.length ? ' (cc ' + r.body.cc.join(', ') + ')' : ''}.`);
      const i = cands.findIndex(x => x.id === c.id); if (i >= 0) cands[i].readiness = r.body.readiness;
      rerender(); return;
    }
    window.location.href = `mailto:${encodeURIComponent(m.to)}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`;
    if (((c.readiness && c.readiness.items) || {})[t.k]?.status !== 'done') readyUpdate(c, t.k, 'requested', 'Email drafted to ' + (m.to || t.owner));
  }; });
  box.querySelectorAll('[data-rs]').forEach(b => { b.onclick = () => {
    let note;
    if (b.dataset.rs === 'issue') { note = window.prompt('What is the problem? (saved for the record)', ''); if (note === null) return; }
    readyUpdate(c, b.dataset.k, b.dataset.rs, note);
  }; });
}

async function readyUpdate(c, k, status, note) {
  const r = await U().getJson('/api/induction/ready-update', { method: 'POST', body: JSON.stringify({ candidateId: c.id, k, status, note }) }).catch(() => ({ ok: false }));
  if (!r.ok) { U().toast('Not saved. Please try again.'); return; }
  const i = cands.findIndex(x => x.id === c.id); if (i >= 0) cands[i].readiness = r.body.readiness;
  rerender();
}

/* Day-1 readiness: the candidate's own check on WhatsApp */
function renderCheckStep(box, c, s, when) {
  const q = s.q, r = c.readiness || {}, a = (r.asks || {})[q.id] || {}, item = (r.items || {})[q.k] || {};
  box.innerHTML = panel({
    title: s.label, status: s.status, when, who: 'To the candidate on WhatsApp',
    what: `<p style="margin:0"><i>"${esc(q.text)}"</i> with <b>Yes</b> / <b>Not yet</b>. Yes marks the task done; Not yet flags it to HR and the owner.</p><p class="note" style="margin:6px 0 0">${health.scheduler ? 'Goes automatically on its date and time.' : 'Automatic sending is not set up yet: use the button.'}</p>`,
    actions: `<button class="btn primary" id="jlRcNow" type="button">${a.sentAt ? 'Ask again now' : 'Send now'}</button>`,
    result: a.sentAt ? `<p style="margin:0">Asked ${esc(fmtTime(a.sentAt))}${a.answer ? ` · answer: <b>${a.answer === 'yes' ? 'Yes' : 'Not yet'}</b> ${esc(fmtTime(a.answeredAt))}` : ''}${item.status ? ` · task: ${esc(RST[item.status][0])}` : ''}</p>` : ''
  });
  $('#jlRcNow').onclick = async () => {
    $('#jlRcNow').disabled = true;
    const res = await U().getJson('/api/induction/ready-ask', { method: 'POST', body: JSON.stringify({ candidateId: c.id, qid: q.id }) }).catch(() => ({ ok: false }));
    if (res.ok && res.body.held) U().toast('WhatsApp window is closed: it goes out when the candidate next writes.');
    else if (res.ok) U().toast('Sent to ' + c.name + '.'); else U().toast(U().explain(res));
    await reload(selected);
  };
}

/* journey check-in step (configured in Client setup → Journey setup) */
function ckFill(text, c) {
  const ck = ckSetups[c.profile && c.profile.client] || {};
  const j = (ck.setup && ck.setup.joining) || {};
  const p = c.profile || {};
  const map = j.mapUrl || (j.address ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(j.address) : '(link to follow)');
  const v = { first: p.first || c.first || (c.name || '').split(' ')[0], name: c.name, doj: fmtDate(p.doj || c.doj), company: c.company || c.clientLabel || 'the company', role: p.role || c.role || '', manager: p.mgr || 'your manager',
    reportTime: j.reportTime || 'the time shared by HR', address: j.address || 'the office address shared by HR', map, poc: j.poc || 'the HR team', pocPhone: j.pocPhone ? ` (${j.pocPhone})` : '', dress: j.dress || 'business casual', bring: j.bring || 'a photo ID',
    hrEmail: ((ck.setup && ck.setup.contacts) || {}).hr || 'the HR team', pending: '(open induction items)', inductionDue: fmtDate(addDays(p.doj || c.doj, (ck.setup && ck.setup.inductionDays) || 21)) };
  return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
}

function renderCkStep(box, c, s, when) {
  const it = s.o.item, a = ((c.checkins || {}).asks || {})[s.key] || {};
  const ck = ckSetups[c.profile && c.profile.client] || {};
  const cont = Object.assign({}, (ck.setup && ck.setup.contacts) || {}, c.contacts || {});
  const toCand = it.to === 'candidate';
  const who = `To ${TO_LABEL[it.to] || it.to} by ${CH_LABEL[toCand ? it.channel : 'email']}${!toCand ? (it.to === 'email' ? ' (' + (it.email || 'not set') + ')' : ' (' + (it.to === 'hr' ? cont.hr || 'Client setup reply-to' : cont[it.to] || 'no email yet') + ')') : ''}`;
  const ans = it.answer === 'buttons' ? `Answers: ${it.options.map(o => `<span class="chip ${it.flag.includes(o) ? 'bad' : 'teal'}">${esc(o)}</span>`).join(' ')}${it.flag.length ? ' <span class="note">(red = alerts HR)</span>' : ''}`
    : it.answer === 'rating' ? 'Answer: a rating from 1 to 5 (1–2 alerts HR).' : it.answer === 'date' ? 'Answer: a date.' : it.answer === 'text' ? 'Answer: free text.' : 'Information only, no answer needed.';
  const contactsBox = (it.to === 'manager' || it.to === 'buddy') ? `<div class="row" style="margin-top:8px;gap:6px;flex-wrap:wrap"><input id="jlCkMgr" type="text" placeholder="Manager email for ${esc(c.name)}" value="${esc((c.contacts || {}).manager || '')}" style="flex:1;min-width:180px"><input id="jlCkBuddy" type="text" placeholder="Buddy email" value="${esc((c.contacts || {}).buddy || '')}" style="flex:1;min-width:150px"><button class="btn small" id="jlCkCont" type="button">Save for this candidate</button></div>` : '';
  const rec = it.answer !== 'none' ? `<div class="row" style="margin-top:8px;gap:6px">${it.answer === 'buttons' ? `<select id="jlCkVal">${it.options.map(o => `<option>${esc(o)}</option>`).join('')}</select>` : `<input id="jlCkVal" type="${it.answer === 'date' ? 'date' : 'text'}" placeholder="${it.answer === 'rating' ? '1–5' : 'Answer'}" style="width:140px">`}<button class="btn small" id="jlCkRec" type="button">Record answer (e.g. given on a call)</button></div>` : '';
  box.innerHTML = panel({
    title: s.label, status: s.status, when: when + (it.every ? ` · repeats every ${it.every} days` : ''), who,
    what: `<pre class="jl-mail" style="white-space:pre-wrap">${esc(ckFill(it.text, c))}</pre><p class="note" style="margin:6px 0 0">${ans}${it.remind ? ` Reminder after ${it.remind} h without an answer${it.escalate ? ', then HR is alerted' : ''}.` : ''} ${health.scheduler ? 'Goes automatically at this time.' : 'Automatic sending is not set up: use the button.'} Change it in Client setup → Journey setup.</p>${contactsBox}`,
    actions: `<button class="btn primary" id="jlCkNow" type="button">${a.sentAt ? 'Send again now' : 'Send now'}</button>`,
    result: (a.sentAt || a.answer || a.skipped || a.missingAt) ? `<p style="margin:0">${a.sentAt ? `Sent ${esc(fmtTime(a.sentAt))}${a.via ? ' by ' + esc(a.via.replace('+', ' and ')) : ''}` : ''}${a.emailError ? ' · <span class="jl-st-bad">' + esc(a.emailError) + '</span>' : ''}${a.remindedAt ? ' · reminded ' + esc(fmtTime(a.remindedAt)) : ''}${a.escalatedAt ? ' · HR alerted ' + esc(fmtTime(a.escalatedAt)) : ''}${a.answer ? `<br>Answer: <b>${esc(a.answer)}</b>${a.by ? ' (' + esc(a.by) + ')' : ''} ${esc(fmtTime(a.answeredAt))}${a.flagged ? ' · <span class="jl-st-bad">sent to HR</span>' : ''}` : ''}${a.skipped ? 'Skipped: ' + esc(a.why || '') : ''}${a.missingAt ? '<span class="jl-st-bad">Not sent: ' + esc(a.why || '') + '</span>' : ''}</p>${rec}` : rec
  });
  $('#jlCkNow').onclick = async () => {
    $('#jlCkNow').disabled = true;
    const r = await U().getJson('/api/checkins/send', { method: 'POST', body: JSON.stringify({ candidateId: c.id, key: s.key }) }).catch(() => ({ ok: false }));
    if (r.ok && r.body.held) U().toast('WhatsApp window is closed: it goes out when the candidate next writes.');
    else if (r.ok) U().toast(r.body.sent ? 'Sent.' : 'Nothing was sent: check the email settings.'); else U().toast(U().explain(r));
    await reload(selected);
  };
  const rb = $('#jlCkRec');
  if (rb) rb.onclick = async () => {
    const v = $('#jlCkVal').value.trim(); if (!v) return;
    const r = await U().getJson('/api/checkins/answer', { method: 'POST', body: JSON.stringify({ candidateId: c.id, key: s.key, value: v }) }).catch(() => ({ ok: false }));
    U().toast(r.ok ? (r.body.flagged ? 'Recorded and flagged to HR.' : 'Recorded.') : U().explain(r));
    await reload(selected);
  };
  const cb = $('#jlCkCont');
  if (cb) cb.onclick = async () => {
    const r = await U().getJson('/api/checkins/contacts', { method: 'POST', body: JSON.stringify({ candidateId: c.id, manager: $('#jlCkMgr').value, buddy: $('#jlCkBuddy').value }) }).catch(() => ({ ok: false }));
    U().toast(r.ok ? 'Saved for ' + c.name + '.' : U().explain(r));
    await reload(selected);
  };
}

/* documents step */
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
  if (d.status === 'needs_review') return ['Needs HR review', 'bad'];
  if (d.status === 'rejected') return ['Rejected, ask again', 'bad'];
  return ['Read, waiting for candidate', 'info'];
}

function renderDocsStep(box, c, s, when) {
  const cd = c.docs || {};
  const ready = health.ocr && health.storage;
  const consent = cd.consentAt ? 'Consent given ' + fmtTime(cd.consentAt) : cd.declinedAt ? 'Candidate said "Not now" ' + fmtTime(cd.declinedAt) : cd.requestedAt ? 'Consent asked ' + fmtTime(cd.requestedAt) + ', not given yet' : 'Not asked yet';
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
  box.innerHTML = panel({
    title: s.label, status: s.status, when, who: 'To the candidate on WhatsApp',
    what: '<p style="margin:0">A consent message (<i>I agree</i> / <i>Not now</i>), then a request for the <b>Aadhaar front</b>, <b>PAN card</b> and <b>bank proof</b>, one at a time. Each is read automatically and shown back to the candidate to confirm or fix. Aadhaar is saved with the first 8 digits hidden.</p>',
    actions: ready ? `<button class="btn primary" id="jlAskDocs" type="button">${cd.requestedAt ? 'Ask again for what is missing' : 'Ask for documents'}</button>` : '<span class="note">Document reading is not connected yet.</span>',
    result: `<p class="note" style="margin:0 0 6px">${esc(consent)}</p>${rows}`
  });
  if ($('#jlAskDocs')) $('#jlAskDocs').onclick = askDocs;
  box.querySelectorAll('button[data-act]').forEach(b => { b.onclick = () => docAction(b.dataset.act, b.dataset.t); });
}

/* joining forms step */
const QLABEL = { marital: 'marital status', maritalOther: 'marital status', spouse: "spouse's name", presConfirm: 'present address', presAddr: 'present address', permSame: 'permanent address', permAddr: 'permanent address', family: 'family members', livesWith: 'whether family lives with them', familyPlace: "family's town", nominees: 'nominees and shares', guardian: 'guardian', prevEpf: 'previous PF', uan: 'UAN', prevPf: 'previous PF member ID', exitDate: 'last working day', prevEps: 'previous pension (EPS)', intl: 'international worker', religion: 'religion' };
const FORM_NAMES = { f11: 'Form 11', f2a: 'Form 2 Part A', f2b: 'Form 2 Part B', esic: 'ESIC', gf: 'Form F' };

function renderFormsStep(box, c, s, when) {
  const f = c.forms || {}, d = c.details || {};
  const kit = window.tcmplFormsKit;
  const applies = kit ? kit.defs(c).map(x => x.id) : [];
  const allQ = [...new Set(applies.flatMap(id => ((missingQ || {})[id] || [])).map(k => QLABEL[k] || k))];
  const empty = kit ? kit.empty(c) : 0;
  const lines = [
    `<li>${d.completedAt ? '✓' : d.step ? '●' : '○'} <b>Details from the candidate:</b> ${d.completedAt ? 'all answered ' + esc(fmtTime(d.completedAt)) : d.step ? 'answering on WhatsApp now' : allQ.length ? 'still needed: ' + esc(allQ.join(', ')) : 'nothing missing'}</li>`,
    `<li>${empty ? '○' : '✓'} <b>Forms filled:</b> ${esc(applies.map(id => FORM_NAMES[id]).join(', ') || '—')}${empty ? ` · ${empty} item(s) still empty` : ''}</li>`,
    `<li>${f.candidateConfirmedAt ? '✓' : f.sentAt ? '●' : '○'} <b>Candidate confirms:</b> ${f.candidateConfirmedAt ? 'All correct ' + esc(fmtTime(f.candidateConfirmedAt)) : f.sentAt ? 'sent ' + esc(fmtTime(f.sentAt)) + ', waiting' : 'not sent yet'}</li>`,
    `<li>${f.approvedBy ? '✓' : '○'} <b>HR approves:</b> ${f.approvedBy ? esc(f.approvedBy) + ' ' + esc(fmtTime(f.approvedAt)) : 'not yet'}</li>`
  ];
  const nextBtn = d.step ? '' : (!d.completedAt && allQ.length) ? '<button class="btn primary" id="jlFAsk" type="button">Ask missing details</button>'
    : (!f.sentAt || f.candidateNote) ? '<button class="btn primary" id="jlFSend" type="button">Send forms to confirm</button>'
      : (!f.approvedBy) ? '<button class="btn primary" id="jlFApprove" type="button">Approve forms</button>' : '';
  box.innerHTML = panel({
    title: 'Joining forms', status: s.status, when, who: 'To the candidate on WhatsApp, then HR',
    what: '<p style="margin:0">First only the details the forms are still missing (marital status, family, nominees, previous PF…), mostly with buttons. Then the filled PDFs (Form 11, Form 2, ESIC if eligible, Form F) with <i>All correct</i> / <i>Something is wrong</i>.</p>',
    actions: nextBtn + (f.sentAt && !f.approvedBy && !nextBtn.includes('jlFSend') ? '<button class="btn small" id="jlFSend" type="button">Send forms again</button>' : '') +
      (!d.step && !nextBtn.includes('jlFAsk') && allQ.length ? '<button class="btn small" id="jlFAsk" type="button">Ask missing details</button>' : '') +
      '<button class="btn small" id="jlFOpen" type="button">Open full forms</button>',
    result: `<ul class="jl-checklist">${lines.join('')}</ul>` +
      (!d.step && missingQ ? `<div class="jl-perform">${applies.map(id => { const q = [...new Set(((missingQ || {})[id] || []).map(k => QLABEL[k] || k))]; return `<div class="jl-pf"><b>${esc(FORM_NAMES[id])}</b> <span class="note">${q.length ? 'needs: ' + esc(q.join(', ')) : 'nothing missing ✓'}</span>${q.length ? ` <button class="btn small" data-fask="${id}" type="button">Ask for ${esc(FORM_NAMES[id])}</button>` : ''}</div>`; }).join('')}</div>` : '') +
      (f.candidateNote ? `<div class="callout"><b>Candidate says:</b> ${esc(f.candidateNote)}</div>` : '')
  });
  box.querySelectorAll('[data-fask]').forEach(b => { b.onclick = () => formsAsk(c, [b.dataset.fask]); });
  if ($('#jlFAsk')) $('#jlFAsk').onclick = () => formsAsk(c);
  if ($('#jlFSend')) $('#jlFSend').onclick = () => formsSend(c, empty);
  if ($('#jlFApprove')) $('#jlFApprove').onclick = () => formsApprove(c);
  $('#jlFOpen').onclick = () => kit && kit.open(c.id);
}

/* induction step */
function renderIndStep(box, c, s, when) {
  const it = s.item;
  const st = ((c.induction && c.induction.items) || {})[it.id] || {};
  const kind = it.kind || 'session';
  const what = kind === 'session' ? `<p style="margin:0">${it.remind ? 'A reminder before the meeting' : 'No reminder'}${it.check !== false ? ', then <i>"Did your ' + esc(it.title) + ' happen?"</i> with Yes / Not yet / Rescheduled' : ''}. Owner: ${esc(it.owner || 'HR')}.</p>`
    : kind === 'content' ? `<p style="margin:0">${it.material ? `File: <a href="/api/induction/file?id=${encodeURIComponent(it.material.id)}" target="_blank" rel="noopener">${esc(it.material.name)}</a>` : ''}${it.link ? ` Link: ${esc(it.link)}` : ''}${!it.material && !it.link ? 'No file or link yet (add it in the Induction tab).' : ''}${it.ack ? '<br>With an <i>I have read it</i> button.' : ''}</p>`
      : kind === 'quiz' ? '<p style="margin:0">The client\'s quiz, one question at a time with answer buttons, then the score.</p>'
        : `<p style="margin:0"><i>"Have you completed ${esc(it.title)}?"</i> with Yes / Not yet.</p>`;
  const res = [st.remindedAt ? 'Reminder sent ' + fmtTime(st.remindedAt) : '', st.sentAt ? 'Sent ' + fmtTime(st.sentAt) : '', st.checks ? `Asked ${st.checks} time(s)` : '', st.ackAt ? 'Read ✓ ' + fmtTime(st.ackAt) : '', st.score ? 'Score ' + st.score : '', st.newTime ? 'Rescheduled to ' + new Date(st.newTime).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '', st.doneAt ? 'Done ' + fmtTime(st.doneAt) : ''].filter(Boolean);
  box.innerHTML = panel({
    title: s.label, status: s.status, when, who: KIND_LABEL[kind] + ' · to the candidate on WhatsApp',
    what: what + (it.note ? `<p class="note" style="margin:6px 0 0">${esc(it.note)}</p>` : '') + `<p class="note" style="margin:6px 0 0">${health.scheduler ? 'Goes automatically on its date and time.' : 'Automatic sending is not set up yet: use the button.'} Change it in the Induction tab.</p>`,
    actions: `<button class="btn primary" id="jlIndNow" type="button">${st.sentAt || st.remindedAt ? 'Send again now' : 'Send now'}</button>`,
    result: res.length ? `<p style="margin:0">${res.map(esc).join(' · ')}</p>` : ''
  });
  $('#jlIndNow').onclick = async () => {
    $('#jlIndNow').disabled = true;
    const r = await U().getJson('/api/induction/send', { method: 'POST', body: JSON.stringify({ candidateId: c.id, itemId: it.id }) }).catch(() => ({ ok: false }));
    if (r.ok && r.body.held) U().toast('WhatsApp window is closed: it goes out when the candidate next writes.');
    else if (r.ok) U().toast(`Sent "${it.title}" to ${c.name}.`);
    else U().toast(r.body && r.body.error === 'no_quiz' ? 'Add quiz questions in the Induction tab first.' : U().explain(r));
    await reload(selected);
  };
}

const PJ = { resignation: 'Resignation', exitAgreement: 'Exit agreed', relievingDate: 'Relieving date', noticePay: 'Notice pay', travel: 'Travel', roleClarity: 'Role clarity', goals: 'Goals', closingCall: 'Closing call' };
function prejoinHtml(c) {
  const pj = c.prejoin || {};
  const rows = Object.entries(pj).map(([k, v]) => `<dt>${esc(PJ[k] || k)}</dt><dd>${esc(k === 'relievingDate' ? fmtDate(v.value) : v.value)}</dd>`).join('');
  const ct = c.contacts || {};
  return rows + (ct.manager ? `<dt>Manager email</dt><dd>${esc(ct.manager)}</dd>` : '') + (ct.buddy ? `<dt>Buddy email</dt><dd>${esc(ct.buddy)}</dd>` : '');
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
    <dt>Offer letter</dt><dd>${c.letterSent ? 'Sent on WhatsApp' : 'Not sent yet'} <button class="btn small" id="jlLetter" type="button">Send again</button></dd>
    ${prejoinHtml(c)}
    <dt>Risk signals</dt><dd>${risk}</dd>
    <dt>Handed to people</dt><dd>${ho}</dd></dl>`;
  $('#jlLetter').onclick = sendLetter;
}

function renderChat() {
  const box = $('#jlMsgs'); if (!box) return;
  const f = t => t ? new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
  const who = m => m.direction === 'in' ? '' : ' · ' + (m.source === 'hr' ? 'HR' : m.source === 'journey' ? 'Step' : m.source === 'ai' ? 'Agent (AI)' : m.source === 'induction' ? 'Induction' : 'Agent');
  box.innerHTML = msgs.map(m => `<div class="b ${m.direction === 'in' ? 'in' : 'out'}"><p style="white-space:pre-wrap;margin:0">${esc(m.text)}</p><span class="meta">${esc(f(m.at))}${esc(who(m))}${m.error ? ' · not delivered' : ''}</span></div>`).join('')
    || '<div class="note" style="padding:12px">No messages yet.</div>';
  box.scrollTop = box.scrollHeight;
}

/* ---------- actions ---------- */
async function afterSend(r, okMsg) {
  const u = U();
  if (r.ok && r.body && r.body.held) { const c = current(); u.toast(`WhatsApp only allows messages within 24 hours of ${c ? c.first || c.name : 'the candidate'}'s last reply. Saved: it goes out automatically as soon as they write.`); await reload(selected); }
  else if (r.ok) { u.toast(okMsg); await reload(selected); } else u.toast(u.explain(r));
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
  if (act === 'edit') { docEdit = type; renderStep(); return; }
  if (act === 'cancel') { docEdit = null; renderStep(); return; }
  const body = { candidateId: c.id, type, action: act === 'reject' ? 'reject' : 'approve' };
  if (act === 'save') { body.fields = {}; document.querySelectorAll('#jlStep .jl-docin').forEach(i => { if (i.value.trim()) body.fields[i.dataset.k] = i.value.trim(); }); }
  if (act === 'reject') { const note = window.prompt('Why is this document rejected? (saved for the record)', 'Not clear'); if (note === null) return; body.note = note; }
  const r = await U().getJson('/api/docs/review', { method: 'POST', body: JSON.stringify(body) }).catch(() => ({ ok: false }));
  if (!r.ok) { U().toast('Not saved' + (r.body && r.body.error ? ': ' + r.body.error : '')); return; }
  docEdit = null;
  U().toast(act === 'reject' ? 'Rejected. Click "Ask again for what is missing" to ask the candidate again.' : 'Approved.');
  await reload(selected);
}

async function formsAsk(c, scope) {
  if (c.details && c.details.step && !window.confirm('The candidate is still answering questions on WhatsApp. Start again with these questions instead?')) return;
  const r = await U().getJson('/api/forms/details', { method: 'POST', body: JSON.stringify({ candidateId: c.id, forms: scope }) }).catch(() => ({ ok: false }));
  if (r.ok && r.body.nothingMissing) { U().toast('Nothing is missing.'); await reload(selected); return; }
  await afterSend(r, `Asked ${c.name} for the details ${scope ? FORM_NAMES[scope[0]] : 'the forms'} still need${scope ? 's' : ''}.`);
}

async function formsSend(c, empty) {
  const kit = window.tcmplFormsKit; if (!kit) { U().toast('Forms are still loading. Try again in a moment.'); return; }
  if (empty && !window.confirm(`${empty} item(s) in the forms are still empty. Send to ${c.name} anyway?`)) return;
  const files = await kit.files(c);
  if (!files.length) { U().toast('PDF tool is still loading. Try again in a moment.'); return; }
  const r = await U().getJson('/api/forms/send', { method: 'POST', body: JSON.stringify({ candidateId: c.id, files }) }).catch(() => ({ ok: false }));
  await afterSend(r, `Sent ${files.length} form(s) to ${c.name} to confirm.`);
}

async function formsApprove(c) {
  const f = c.forms || {};
  if (!f.candidateConfirmedAt && !window.confirm('The candidate has not confirmed the forms yet. Approve anyway?')) return;
  const r = await U().getJson('/api/forms/save', { method: 'POST', body: JSON.stringify({ candidateId: c.id, vals: f.vals || {}, states: f.states || {}, approve: true }) }).catch(() => ({ ok: false }));
  await afterSend(r, 'Forms approved.');
}

async function sendPreview(s) {
  const c = current(); if (!c || !preview) return;
  const text = ($('#jlPrevText').value || '').trim();
  const withBtns = $('#jlPrevBtns') ? $('#jlPrevBtns').checked : false;
  const items = [];
  if ($('#jlPrevLetter') && $('#jlPrevLetter').checked) {
    const it = { type: 'letter' };
    const cur = window.tcmplCurrent && window.tcmplCurrent();
    const pdf = window.tcmplLetterPdf && window.tcmplLetterPdf();
    if (cur && U().candId(cur.mobile) === c.id && pdf && pdf.blob instanceof Blob) { it.pdfBase64 = await U().blobToBase64(pdf.blob); it.filename = pdf.name; it.protected = !!pdf.protected; }
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
  const viaWa = !$('#jlPrevWa') || $('#jlPrevWa').checked, viaEmail = $('#jlPrevEmail') && $('#jlPrevEmail').checked;
  if (!viaWa && !viaEmail) { U().toast('Choose WhatsApp, email or both.'); return; }
  if (!items.length) { U().toast('Nothing to send.'); return; }
  $('#jlPrevSend').disabled = true;
  if (viaEmail) {
    const er = await U().getJson('/api/notify/candidate', { method: 'POST', body: JSON.stringify({ candidateId: c.id, key: s.key, subject: `${s.label} · ${c.clientLabel || ''}`.replace(/ · $/, ''), body: text }) }).catch(() => ({ ok: false }));
    if (!er.ok) U().toast('Email not sent: ' + ((er.body && (er.body.detail || er.body.error)) || 'error'));
    else if (!viaWa) { $('#jlPrevSend').disabled = false; await afterSend(er, `Emailed "${s.label}" to ${c.name}.`); return; }
  }
  const r = await U().push(c.id, items, s.label, s.key);
  if ($('#jlPrevSend')) $('#jlPrevSend').disabled = false;
  await afterSend(r, `Sent "${s.label}" to ${c.name}${viaEmail ? ' on WhatsApp and email' : ' on WhatsApp'}.`);
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
  if (r.ok && r.body && r.body.held) { $('#jlText').value = ''; await afterSend(r, ''); }
  else if (r.ok) { $('#jlText').value = ''; loadMsgs(true); } else U().toast(U().explain(r));
}

// HR view: one candidate's stage, next step and what needs HR, using the same rules as this screen.
async function summary(c, allDocs) {
  const keep = [plan, readyTpl, docs, steps];
  try {
    plan = window.tcmplPlanFor ? window.tcmplPlanFor(profileOf(c)) : [];
    readyTpl = window.tcmplReadyFor ? window.tcmplReadyFor(profileOf(c)) || [] : [];
    docs = (allDocs || []).filter(d => d.candidateId === c.id);
    await loadPlan(c);
    const st = buildSteps(c);
    steps = st;
    const ph = PHASES.find(p => p.id === currentPhase());
    const ns = nextStep();
    return { phase: ph.label, phaseId: ph.id, next: ns ? ns.label : '', nextStatus: ns ? ns.status : null, red: st.filter(x => x.status.red).map(x => x.label), done: st.filter(x => x.status.done).length, total: st.length, stages: PHASES.map(p => ({ id: p.id, label: p.label, state: phaseState(p.id) })) };
  } finally { [plan, readyTpl, docs, steps] = keep; }
}

window.tcmplLive = { forgetSetup(client) { delete ckSetups[client]; }, reload, summary, open(id, stepId) { const b = document.querySelector('nav.tabs button[data-tab="journey"]'); if (b) b.click(); setTimeout(() => reload(id, stepId), 50); } };

(function waitForApp(n) {
  if (window.tcmplWAUtil && mount()) return;
  if (n > 100) return;
  setTimeout(() => waitForApp(n + 1), 100);
})(0);
