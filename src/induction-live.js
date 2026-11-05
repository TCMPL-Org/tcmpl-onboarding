// Induction tab, live version.
// Per client: the plan of milestones (meetings, decks/documents, tasks, quiz), uploaded files, and the quiz.
// Per candidate: what has been sent on WhatsApp, what they confirmed, and "Send now" to test a milestone.
// No calendar invites: meetings get a WhatsApp reminder before and a "Did it happen?" check after.

const U = () => window.tcmplWAUtil;
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const TYPES = [['session', 'Meeting / connect'], ['content', 'Deck or document'], ['task', 'Task'], ['quiz', 'Quiz']];
const REMIND = [[0, 'No reminder'], [30, '30 min before'], [60, '1 hour before'], [1440, '1 day before']];
const ST = { done: ['Done', 'ok'], sent: ['Sent, waiting', 'info'], not_yet: ['Not yet', 'warn'], rescheduled: ['Rescheduled', 'info'], escalated: ['Escalated to HR', 'bad'], help: ['Needs help', 'bad'], retry: ['Quiz: not passed yet', 'warn'], failed: ['Quiz not passed', 'bad'], skipped: ['Skipped (too late)', ''] };

let clientId = null, items = [], quiz = { questions: [], pass: 1 }, dirty = false, cands = [], cSel = '', health = {};

const rid = () => 'm' + Math.random().toString(36).slice(2, 9);
function kindOf(it) {
  if (it.kind) return it.kind;
  if (/quiz/i.test(it.title || '')) return 'quiz';
  if (it.material && typeof it.material === 'object') return 'content';
  return 'session';
}
function fromLegacy(it) {
  const kind = kindOf(it);
  return {
    id: it.id || rid(), day: +it.day || 0, time: it.time || '10:00', mins: +it.mins || 30, title: it.title || 'New milestone', owner: it.owner || 'HR', kind,
    remind: it.remind !== undefined ? +it.remind : (kind === 'session' ? 60 : 0),
    check: it.check !== undefined ? !!it.check : kind !== 'quiz', ack: !!it.ack, note: it.note || '',
    material: it.material && typeof it.material === 'object' ? it.material : null, link: it.link || ''
  };
}
function quizFrom(q) {
  if (q && Array.isArray(q.questions)) return { questions: q.questions.map(x => ({ q: x.q, options: (x.options || []).slice(0, 3), answer: +x.answer || 0 })), pass: +q.pass || 1 };
  const qs = (Array.isArray(q) ? q : []).map(([qq, o, a]) => ({ q: qq, options: (o || []).slice(0, 3), answer: Math.min(+a || 0, 2) }));
  return { questions: qs, pass: Math.max(1, Math.ceil(qs.length * 0.8)) };
}

/* ---------- mount ---------- */
function mount() {
  const sec = $('#tab-induct');
  if (!sec || $('#ilive')) return Boolean($('#ilive'));
  // Hide the demo editor, deck preview and demo quiz; keep the heading.
  [...sec.children].forEach(el => { if (!el.classList.contains('intro')) el.style.display = 'none'; });
  const introRow = sec.querySelector('.intro .row'); if (introRow) introRow.style.display = 'none';
  const box = document.createElement('div');
  box.id = 'ilive';
  box.innerHTML = `
  <div class="card" style="margin-bottom:14px">
    <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
      <div><h3 style="margin:0">Induction plan · <span id="ilClient"></span></h3>
      <p class="note" style="margin:4px 0 0">Day 0 is the joining day. Meetings get a WhatsApp reminder before and a "Did it happen?" check after; decks and policies are sent as files with an optional "I have read it". Times are India time.</p></div>
      <div class="row"><button class="btn small" id="ilAdd" type="button">Add milestone</button><button class="btn small primary" id="ilSave" type="button">Save plan for this client</button><span class="note" id="ilState"></span></div>
    </div>
    <div class="tscroll" style="margin-top:10px"><table class="il-tbl" id="ilTbl"></table></div>
  </div>
  <div class="grid2">
    <div class="card"><div class="row" style="justify-content:space-between"><h3 style="margin:0">Quiz</h3><button class="btn small" id="ilQAdd" type="button">Add question</button></div>
      <p class="note" style="margin:4px 0 10px">Up to 3 answers per question (WhatsApp shows them as buttons). Tick the correct one.</p>
      <div id="ilQuiz"></div>
      <div class="row" style="margin-top:8px"><label class="lbl" for="ilPass">Pass mark</label><input type="number" id="ilPass" min="1" style="width:70px"><span class="note" id="ilPassOf"></span></div></div>
    <div class="card"><h3 style="margin:0 0 8px">Progress on WhatsApp</h3>
      <div class="row"><label class="lbl" for="ilCand">Candidate</label><select id="ilCand"></select><button class="btn small" id="ilRefresh" type="button">Refresh</button></div>
      <p class="note" id="ilSched" style="margin:6px 0"></p>
      <div id="ilProg"></div></div>
  </div>`;
  sec.querySelector('.intro').after(box);
  $('#ilAdd').onclick = () => { items.push(fromLegacy({ day: 1, time: '11:00', title: 'New milestone', kind: 'session' })); sortItems(); markDirty(); renderPlan(); };
  $('#ilSave').onclick = save;
  $('#ilQAdd').onclick = () => { quiz.questions.push({ q: '', options: ['', '', ''], answer: 0 }); markDirty(); renderQuiz(); };
  $('#ilPass').onchange = () => { quiz.pass = Math.max(1, +$('#ilPass').value || 1); markDirty(); renderQuiz(); };
  $('#ilCand').onchange = () => { cSel = $('#ilCand').value; renderProgress(); };
  $('#ilRefresh').onclick = () => loadCands();
  document.querySelectorAll('nav.tabs button').forEach(b => b.addEventListener('click', () => { if (b.dataset.tab === 'induct') load(); }));
  const sel = $('#clientSel'); if (sel) sel.addEventListener('change', () => setTimeout(load, 50));
  load();
  return true;
}

const sortItems = () => items.sort((a, b) => a.day - b.day || String(a.time).localeCompare(String(b.time)));
function markDirty() { dirty = true; $('#ilState').textContent = 'Unsaved changes'; }

/* ---------- load / save ---------- */
async function load() {
  const u = U(); if (!u) return;
  clientId = window.tcmplClientId ? window.tcmplClientId() : 'default';
  $('#ilClient').textContent = window.tcmplClientLabel ? window.tcmplClientLabel() : clientId;
  health = await u.loadHealth();
  let saved = null;
  if (health.db) { const r = await u.getJson(`/api/data/plans/${encodeURIComponent(clientId)}`).catch(() => ({ ok: false })); if (r.ok) saved = r.body.data; }
  const def = window.tcmplInductionDefaults ? window.tcmplInductionDefaults() : { items: [], quiz: [] };
  items = ((saved && saved.items) || def.items).map(fromLegacy);
  quiz = quizFrom(saved && saved.quiz ? saved.quiz : def.quiz);
  sortItems(); dirty = false;
  $('#ilState').textContent = saved ? 'Saved plan' : 'Default plan (not saved yet)';
  renderPlan(); renderQuiz(); loadCands();
}

async function save() {
  const bad = quiz.questions.find(q => !q.q.trim() || q.options.filter(o => o.trim()).length < 2);
  if (bad) { U().toast('Each quiz question needs text and at least 2 answers.'); return; }
  const body = { client: clientId, items, quiz: { questions: quiz.questions.map(q => ({ q: q.q.trim(), options: q.options.map(o => o.trim()).filter(Boolean), answer: q.answer })), pass: Math.min(quiz.pass, quiz.questions.length || 1) }, updated: new Date().toISOString() };
  const r = await U().getJson(`/api/data/plans/${encodeURIComponent(clientId)}`, { method: 'PUT', body: JSON.stringify(body) }).catch(() => ({ ok: false }));
  if (!r.ok) { U().toast('Not saved. Please try again.'); return; }
  dirty = false; $('#ilState').textContent = 'Saved'; U().toast('Induction plan saved for this client.');
  renderProgress();
}

/* ---------- plan editor ---------- */
function settingsCell(it, i) {
  if (it.kind === 'session') return `<select data-f="remind" data-i="${i}" aria-label="Reminder">${REMIND.map(([v, l]) => `<option value="${v}" ${+it.remind === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <label class="il-ck"><input type="checkbox" data-f="check" data-i="${i}" ${it.check ? 'checked' : ''}> Ask afterwards if it happened</label>`;
  if (it.kind === 'content') return `${it.material ? `<div><a href="/api/induction/file?id=${encodeURIComponent(it.material.id)}" target="_blank" rel="noopener">${esc(it.material.name)}</a> <span class="note">${Math.max(1, Math.round((it.material.size || 0) / 1024))} KB</span> <button class="btn small" data-rmfile="${i}" type="button">Remove</button></div>` : ''}
    <label class="btn small filebtn">${it.material ? 'Replace file' : 'Upload file'}<input type="file" data-up="${i}" accept=".pdf,.ppt,.pptx,.doc,.docx,.jpg,.png,.mp4" hidden></label>
    <input type="url" data-f="link" data-i="${i}" value="${esc(it.link)}" placeholder="or a link (YouTube, SharePoint…)" aria-label="Link" style="width:100%;margin-top:4px">
    <label class="il-ck"><input type="checkbox" data-f="ack" data-i="${i}" ${it.ack ? 'checked' : ''}> Ask for "I have read it"</label>
    <label class="il-ck"><input type="checkbox" data-f="check" data-i="${i}" ${it.check ? 'checked' : ''}> Follow up next day if not done</label>`;
  if (it.kind === 'task') return `<label class="il-ck"><input type="checkbox" data-f="check" data-i="${i}" ${it.check ? 'checked' : ''}> Ask if completed</label>`;
  return `<span class="note">Sends the quiz below, one question at a time.</span>`;
}

function renderPlan() {
  $('#ilTbl').innerHTML = '<tr><th>Day</th><th>Time</th><th>Milestone</th><th>Type</th><th>Owner</th><th>On WhatsApp</th><th>Message (optional)</th><th></th></tr>' + items.map((it, i) => `<tr>
    <td><input type="number" data-f="day" data-i="${i}" value="${it.day}" style="width:60px" aria-label="Day"></td>
    <td><input type="time" data-f="time" data-i="${i}" value="${esc(it.time)}" aria-label="Time"></td>
    <td><input type="text" data-f="title" data-i="${i}" value="${esc(it.title)}" style="min-width:190px;width:100%" aria-label="Milestone"></td>
    <td><select data-f="kind" data-i="${i}" aria-label="Type">${TYPES.map(([v, l]) => `<option value="${v}" ${it.kind === v ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
    <td><input type="text" data-f="owner" data-i="${i}" value="${esc(it.owner)}" style="width:110px" aria-label="Owner"></td>
    <td style="min-width:220px">${settingsCell(it, i)}</td>
    <td><textarea data-f="note" data-i="${i}" rows="2" style="min-width:180px;width:100%" aria-label="Message" placeholder="e.g. Join on Teams; bring your ID">${esc(it.note)}</textarea></td>
    <td><button class="btn small" data-x="${i}" type="button">Remove</button></td></tr>`).join('');
  document.querySelectorAll('#ilTbl [data-f]').forEach(e => { e.onchange = () => {
    const it = items[+e.dataset.i], f = e.dataset.f;
    it[f] = e.type === 'checkbox' ? e.checked : (f === 'day' || f === 'remind') ? (+e.value || 0) : e.value;
    if (f === 'kind') { it.check = it.kind !== 'quiz'; it.remind = it.kind === 'session' ? 60 : 0; }
    markDirty(); if (f === 'day' || f === 'time') sortItems(); if (['kind', 'day', 'time'].includes(f)) renderPlan();
  }; });
  document.querySelectorAll('#ilTbl [data-x]').forEach(b => { b.onclick = () => { items.splice(+b.dataset.x, 1); markDirty(); renderPlan(); }; });
  document.querySelectorAll('#ilTbl [data-rmfile]').forEach(b => { b.onclick = () => { items[+b.dataset.rmfile].material = null; markDirty(); renderPlan(); }; });
  document.querySelectorAll('#ilTbl [data-up]').forEach(e => { e.onchange = () => upload(+e.dataset.up, e.files[0]); });
}

async function upload(i, file) {
  if (!file) return;
  if (file.size > 16 * 1024 * 1024) { U().toast('That file is over 16 MB. For big videos, paste a link instead.'); return; }
  U().toast(`Uploading ${file.name}…`);
  const data = await U().blobToBase64(file);
  const r = await U().getJson('/api/induction/upload', { method: 'POST', body: JSON.stringify({ client: clientId, filename: file.name, mime: file.type || 'application/pdf', data }) }).catch(() => ({ ok: false }));
  if (!r.ok) { U().toast('Upload failed' + (r.body && r.body.detail ? ': ' + r.body.detail : r.body && r.body.error ? ': ' + r.body.error : '')); return; }
  items[i].material = { id: r.body.id, name: r.body.name, mime: r.body.mime, size: r.body.size };
  if (items[i].kind !== 'content') items[i].kind = 'content';
  markDirty(); renderPlan(); U().toast(`${file.name} uploaded. Click "Save plan for this client" to keep it.`);
}

/* ---------- quiz editor ---------- */
function renderQuiz() {
  $('#ilQuiz').innerHTML = quiz.questions.map((q, i) => `<div class="il-q">
    <div class="row" style="gap:6px"><b>${i + 1}.</b><input type="text" data-q="${i}" value="${esc(q.q)}" placeholder="Question" style="flex:1" aria-label="Question ${i + 1}"><button class="btn small" data-qx="${i}" type="button">Remove</button></div>
    ${[0, 1, 2].map(j => `<label class="il-opt"><input type="radio" name="ilq${i}" data-qa="${i}" value="${j}" ${q.answer === j ? 'checked' : ''} aria-label="Correct answer"><input type="text" data-qo="${i}" data-j="${j}" value="${esc(q.options[j] || '')}" maxlength="20" placeholder="Answer ${j + 1}${j === 2 ? ' (optional)' : ''}"></label>`).join('')}
  </div>`).join('') || '<p class="note">No questions yet.</p>';
  $('#ilPass').value = Math.min(quiz.pass, quiz.questions.length || 1);
  $('#ilPassOf').textContent = `out of ${quiz.questions.length}`;
  document.querySelectorAll('#ilQuiz [data-q]').forEach(e => { e.onchange = () => { quiz.questions[+e.dataset.q].q = e.value; markDirty(); }; });
  document.querySelectorAll('#ilQuiz [data-qo]').forEach(e => { e.onchange = () => { quiz.questions[+e.dataset.qo].options[+e.dataset.j] = e.value; markDirty(); }; });
  document.querySelectorAll('#ilQuiz [data-qa]').forEach(e => { e.onchange = () => { quiz.questions[+e.dataset.qa].answer = +e.value; markDirty(); }; });
  document.querySelectorAll('#ilQuiz [data-qx]').forEach(b => { b.onclick = () => { quiz.questions.splice(+b.dataset.qx, 1); markDirty(); renderQuiz(); }; });
}

/* ---------- per-candidate progress ---------- */
async function loadCands() {
  const u = U(); if (!u || !health.db) { cands = []; renderProgress(); return; }
  const r = await u.getJson('/api/data/candidates').catch(() => ({ ok: false }));
  cands = r.ok ? (r.body.items || []).map(i => Object.assign({ id: i.id }, i.data)).filter(c => c.profile && c.profile.client === clientId) : [];
  if (!cands.some(c => c.id === cSel)) cSel = cands[0] ? cands[0].id : '';
  $('#ilCand').innerHTML = cands.length ? cands.map(c => `<option value="${esc(c.id)}">${esc(c.name || '+' + c.phone)}</option>`).join('') : '<option value="">No candidates for this client yet</option>';
  $('#ilCand').value = cSel;
  renderProgress();
}

function dueDate(doj, day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(doj || ''); if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + day));
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function renderProgress() {
  $('#ilSched').innerHTML = health.scheduler ? 'Automatic sending is on (checked every 15 minutes, 8 am to 9 pm).' : '<b>Automatic sending is not set up yet.</b> Use "Send now" to test; the scheduler setup is a one-time step.';
  const c = cands.find(x => x.id === cSel);
  if (!c) { $('#ilProg').innerHTML = '<p class="note">Release an offer for this client to see progress here.</p>'; return; }
  const st = (c.induction && c.induction.items) || {};
  const done = items.filter(it => (st[it.id] || {}).status === 'done').length;
  $('#ilProg').innerHTML = `<p class="note" style="margin:0 0 8px">Joins ${esc(dueDate(c.profile.doj, 0))} · ${done} of ${items.length} done${dirty ? ' · <b>save the plan before sending</b>' : ''}</p>` +
    '<table class="il-prog">' + items.map(it => {
      const s = st[it.id] || {};
      const [lab, cls] = ST[s.status] || (s.remindedAt ? ['Reminded', 'info'] : ['Not started', '']);
      const extra = [s.score ? 'Score ' + s.score : '', s.ackAt ? 'Read ✓' : '', s.checks ? `Asked ${s.checks}×` : ''].filter(Boolean).join(' · ');
      return `<tr><td><b>${esc(it.title)}</b><div class="note">${esc(dueDate(c.profile.doj, it.day))}, ${esc(it.time)} · ${esc(TYPES.find(t => t[0] === it.kind)[1])}</div></td><td><span class="chip ${cls}">${esc(lab)}</span>${extra ? `<div class="note">${esc(extra)}</div>` : ''}</td><td><button class="btn small" data-now="${esc(it.id)}" type="button" ${dirty ? 'disabled' : ''}>Send now</button></td></tr>`;
    }).join('') + '</table>';
  document.querySelectorAll('#ilProg [data-now]').forEach(b => { b.onclick = () => sendNow(c, b.dataset.now, b); });
}

async function sendNow(c, itemId, btn) {
  btn.disabled = true;
  const r = await U().getJson('/api/induction/send', { method: 'POST', body: JSON.stringify({ candidateId: c.id, itemId }) }).catch(() => ({ ok: false }));
  btn.disabled = false;
  if (r.ok && r.body.held) U().toast('WhatsApp window is closed: the message will go out when the candidate next writes.');
  else if (r.ok) U().toast(`Sent to ${c.name} on WhatsApp.`);
  else U().toast(r.body && r.body.error === 'no_induction_plan' ? 'Save the plan for this client first.' : r.body && r.body.error === 'no_quiz' ? 'Add quiz questions and save first.' : U().explain(r));
  loadCands();
}

(function waitForApp(n) {
  if (window.tcmplWAUtil && window.tcmplInductionDefaults && mount()) return;
  if (n > 100) return;
  setTimeout(() => waitForApp(n + 1), 100);
})(0);
