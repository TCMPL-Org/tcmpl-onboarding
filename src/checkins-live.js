// Client setup → Journey setup: everything the agent asks or tells people on a cadence, per client.
// Each row: who it goes to, channel (WhatsApp / Email / both), an optional AI call (placed automatically only when the
// client's "Automatic AI calls" switch is on; off by default), day relative to joining + time, repeat, the message,
// the answer type, answers that alert HR, reminder and escalation. TCMPL default until HR changes it.
// Sending and answers are in Candidate journey (one step per check-in).

const U = () => window.tcmplWAUtil;
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const STAGES = [['pre', 'Pre-joining'], ['day1', 'Joining day'], ['p90', 'First 90 days'], ['close', 'Closure']];
const TO = [['candidate', 'Candidate'], ['manager', 'Manager'], ['hr', 'HR'], ['buddy', 'Buddy'], ['email', 'Other email']];
const CH = [['whatsapp', 'WhatsApp'], ['email', 'Email'], ['both', 'WhatsApp + Email']];
const CALL = [['', 'No call'], ['noreply', 'WhatsApp, then AI call if no answer'], ['call', 'AI call first (WhatsApp if not reached)'], ['both', 'WhatsApp and an AI call']];
const ANS = [['buttons', 'Choice buttons'], ['rating', 'Rating 1–5'], ['date', 'Date'], ['text', 'Free text'], ['none', 'No answer (information)']];
const JOIN = [['reportTime', 'Report by (time)'], ['address', 'Office address'], ['mapUrl', 'Google Maps link (optional, made from the address if empty)'], ['poc', 'Point of contact on day 1'], ['pocPhone', 'Point of contact phone'], ['dress', 'Dress code'], ['bring', 'What to bring']];

let client = '', setup = null, defaults = null, dirty = false;

const rel = d => (d === 0 ? 'Day 1' : d < 0 ? 'D' + d : 'D+' + d);
const opt = (list, v) => list.map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
const label = (l, list) => (list.find(x => x[0] === l) || [l, l])[1];
const csv = a => (a || []).join(', ');
const fromCsv = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);

function mount() {
  const sec = $('#tab-config');
  if (!sec || $('#cklive')) return Boolean($('#cklive'));
  const box = document.createElement('div');
  box.id = 'cklive';
  box.className = 'card';
  box.style.marginBottom = '16px';
  box.innerHTML = `<h3 style="margin:0 0 4px">Journey setup · check-ins, surveys and closure · <span id="ckClient"></span></h3>
    <p class="note" style="margin:0 0 10px">What the agent asks or tells the candidate, manager, HR and buddy, and when. Each row has its own channel (WhatsApp, Email or both). No calendar invites: meetings and calls get reminders and a "did it happen?" check. Everything is sent and tracked from <b>Candidate journey</b>.</p>
    <p class="note" id="ckFrom" style="margin:0 0 10px"></p>
    <div id="ckBody"><p class="note">Loading…</p></div>
    <div class="row" style="margin-top:10px"><button class="btn small primary" id="ckSave" type="button">Save journey setup</button><button class="btn small" id="ckAdd" type="button">+ Add check-in</button><button class="btn small" id="ckReset" type="button">Reset to TCMPL default</button><span class="note" id="ckState"></span></div>`;
  const after = $('#slive') || sec.querySelector('.intro');
  after.after(box);
  $('#ckSave').onclick = save;
  $('#ckAdd').onclick = () => { collect(); setup.items.push({ id: 'new-' + Math.random().toString(36).slice(2, 7), stage: 'p90', title: 'New check-in', to: 'candidate', channel: 'whatsapp', day: 7, time: '11:00', every: 0, until: null, text: 'Hi {first}, …', answer: 'buttons', options: ['Yes', 'Not yet'], flag: ['Not yet'], stopOn: [], remind: 24, escalate: true, saveAs: '', when: '', off: false, call: '', callAfter: 24, _open: true }); dirty = true; render(); };
  $('#ckReset').onclick = () => { if (!defaults) return; const keep = { joining: setup.joining, contacts: setup.contacts }; setup = Object.assign(JSON.parse(JSON.stringify(defaults)), keep); dirty = true; render(); $('#ckState').textContent = 'TCMPL default loaded: click Save to keep it.'; };
  document.querySelectorAll('nav.tabs button').forEach(b => b.addEventListener('click', () => { if (b.dataset.tab === 'config') load(); }));
  const sel = $('#clientSel'); if (sel) sel.addEventListener('change', () => setTimeout(load, 60));
  load();
  return true;
}

async function load() {
  const u = U(); if (!u) return;
  const id = window.tcmplClientId ? window.tcmplClientId() : '';
  if (id === client && setup && dirty) return;
  client = id;
  $('#ckClient').textContent = window.tcmplClientLabel ? window.tcmplClientLabel() : client;
  const r = await u.getJson('/api/checkins/setup', { method: 'POST', body: JSON.stringify({ client }) }).catch(() => ({ ok: false }));
  if (!r.ok) { $('#ckBody').innerHTML = '<p class="note">Journey setup needs the database (sign in, and check /api/health).</p>'; return; }
  setup = r.body.setup; defaults = r.body.defaults; dirty = false;
  const h = await u.loadHealth();
  $('#ckFrom').innerHTML = `<b>From:</b> ${esc(r.body.sender || 'the Azure sender address')} (fixed by Azure until your own domain is connected) · <b>To</b>, <b>CC</b> and <b>Reply-to</b> are set per row below${h && h.email ? '' : ' · <i>email is not connected</i>'}.`;
  // Joining details default to what Client setup already holds for this client.
  const f = window.tcmplClientFacts ? window.tcmplClientFacts() : {};
  for (const k of ['address', 'reportTime', 'poc', 'dress', 'bring', 'mapUrl']) if (!setup.joining[k] && f[k]) setup.joining[k] = f[k];
  render();
}

function itemHtml(it, i) {
  const sum = `${rel(it.day)} ${esc(it.time)} · <b>${esc(it.title)}</b> · ${esc(label(it.to, TO))} · ${esc(label(it.channel, CH))}${it.every ? ` · every ${it.every} days until ${rel(it.until ?? it.day)}` : ''}${it.call && it.to === 'candidate' ? ' · 📞 ' + esc(label(it.call, CALL)) : ''}${it.off ? ' · <i>off</i>' : ''}`;
  return `<details class="ck-it" data-i="${i}" ${it._open ? 'open' : ''}><summary><label class="note" style="display:inline-flex;gap:4px;align-items:center;margin-right:6px" onclick="event.stopPropagation()"><input type="checkbox" data-f="on" ${it.off ? '' : 'checked'}> on</label>${sum}</summary>
    <div class="ck-grid">
      <label>Title<input data-f="title" value="${esc(it.title)}"></label>
      <label>Stage<select data-f="stage">${opt(STAGES, it.stage)}</select></label>
      <label>Day (0 = joining day, −7 = a week before)<input data-f="day" type="number" value="${esc(it.day)}"></label>
      <label>Time (IST)<input data-f="time" type="time" value="${esc(it.time)}"></label>
      <label>Repeat every (days, 0 = once)<input data-f="every" type="number" min="0" value="${esc(it.every || 0)}"></label>
      <label>…until day<input data-f="until" type="number" value="${it.until == null ? '' : esc(it.until)}"></label>
      <label>To<select data-f="to">${opt(TO, it.to)}</select></label>
      <label>Other email (when To = Other email)<input data-f="email" value="${esc(it.email || '')}"></label>
      <label>CC (emails, comma)<input data-f="cc" value="${esc(it.cc || '')}" placeholder="clienthr@company.com, recruiter@company.com"></label>
      <label>Reply-to for this email (empty = client default)<input data-f="replyTo" value="${esc(it.replyTo || '')}" placeholder="hr@company.com"></label>
      <label>Channel<select data-f="channel">${opt(CH, it.channel)}</select></label>
      <label>Answer<select data-f="answer">${opt(ANS, it.answer)}</select></label>
      <label>Answer options (comma, max 20 letters each)<input data-f="options" value="${esc(csv(it.options))}"></label>
      <label>Alert HR when the answer is<input data-f="flag" value="${esc(csv(it.flag))}"></label>
      <label>Stop repeating when the answer is<input data-f="stopOn" value="${esc(csv(it.stopOn))}"></label>
      <label>Reminder if no answer (hours, 0 = none)<input data-f="remind" type="number" min="0" value="${esc(it.remind || 0)}"></label>
      <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-f="escalate" ${it.escalate ? 'checked' : ''}> Tell HR if still no answer after the reminder</label>
      <label>AI call ${it.to === 'candidate' ? '' : '<span class="note">(candidate steps only)</span>'}<select data-f="call">${opt(CALL, it.call || '')}</select></label>
      <label>…call if no answer after (hours)<input data-f="callAfter" type="number" min="1" max="240" value="${esc(it.callAfter || 24)}"></label>
      <label>Only while induction is open<select data-f="when"><option value="">Always</option><option value="induction_open" ${it.when === 'induction_open' ? 'selected' : ''}>Only if induction is not complete</option></select></label>
    </div>
    <label class="note" style="display:block;margin-top:6px">Message · placeholders: {first} {name} {doj} {company} {role} {manager} {reportTime} {address} {map} {poc} {pocPhone} {dress} {bring} {pending} {inductionDue} {hrEmail}
      <textarea data-f="text" rows="3" style="width:100%">${esc(it.text)}</textarea></label>
    <div class="row"><button class="btn small" data-del="${i}" type="button">Delete</button></div>
  </details>`;
}

function render() {
  const s = setup;
  const j = s.joining || {}, c = s.contacts || {};
  $('#ckBody').innerHTML = `
    <div class="row" style="gap:16px;flex-wrap:wrap;margin-bottom:8px">
      <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="ckOn" ${s.enabled !== false ? 'checked' : ''}> Send check-ins automatically for this client</label>
      <label>Induction must be completed within <input id="ckIndDays" type="number" min="1" max="120" value="${esc(s.inductionDays || 21)}" style="width:70px"> days of joining</label>
    </div>
    <div class="ck-calls">
      <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="ckAutoCall" ${s.autoCall ? 'checked' : ''}> <b>Automatic AI calls</b> for this client</label>
      <p class="note" style="margin:4px 0 8px">Off by default. While it is off, nothing is dialled by itself: HR can still use <b>📞 Call now (AI)</b> on any candidate step in Candidate journey. When on, each step's <b>AI call</b> setting below is followed: calls go out between 9 am and 8 pm IST, up to 3 tries 2 hours apart, one call per candidate at a time; the answer given on the call completes the step and red answers alert HR. The offer letter, documents, forms and links always go on WhatsApp.</p>
      <div class="row" style="gap:6px;flex-wrap:wrap"><span class="note">Set the AI call for every candidate step:</span><select id="ckAllCall">${opt(CALL, '')}</select><button class="btn small" id="ckAllCallGo" type="button">Apply to all steps</button><button class="btn small" id="ckCallTips" type="button">Use the recommended calls</button></div>
    </div>
    <details open><summary><b>Joining details</b> (used in the joining message, with a Google Maps link)</summary>
      <div class="ck-grid">${JOIN.map(([k, l]) => `<label>${esc(l)}<input data-j="${k}" value="${esc(j[k] || '')}"></label>`).join('')}</div></details>
    <details><summary><b>Default contacts</b> (a candidate's own manager / buddy can be set in Candidate journey)</summary>
      <div class="ck-grid">
        <label>Manager email<input data-c="manager" value="${esc(c.manager || '')}" placeholder="manager@company.com"></label>
        <label>HR email (closing call, escalations)<input data-c="hr" value="${esc(c.hr || '')}" placeholder="hr@company.com"></label>
        <label>Buddy email<input data-c="buddy" value="${esc(c.buddy || '')}" placeholder="buddy@company.com"></label>
      </div></details>
    <details><summary><b>Infra and facilities</b> (the candidate is asked about each one the day after joining)</summary>
      <label class="note" style="display:block">One per line, e.g. Workstation / seat, Canteen coupons, Parking pass, Locker, Transport
        <textarea id="ckInfra" rows="4" style="width:100%">${esc((s.infra || []).join('\n'))}</textarea></label></details>
    ${STAGES.map(([st, l]) => {
      const rows = s.items.map((it, i) => [it, i]).filter(([it]) => it.stage === st).sort((a, b) => a[0].day - b[0].day || String(a[0].time).localeCompare(b[0].time));
      return `<h4 style="margin:14px 0 4px">${esc(l)} <span class="note">(${rows.length})</span></h4>${rows.map(([it, i]) => itemHtml(it, i)).join('') || '<p class="note">None.</p>'}`;
    }).join('')}`;
  const body = $('#ckBody');
  body.oninput = () => { dirty = true; $('#ckState').textContent = 'Not saved yet'; };
  body.onchange = body.oninput;
  $('#ckAllCallGo').onclick = () => {
    collect(); const v = $('#ckAllCall').value;
    let n = 0; setup.items.forEach(it => { if (it.to === 'candidate' && !it.off) { it.call = v; n++; } });
    dirty = true; render(); $('#ckState').textContent = `AI call set to "${label(v, CALL)}" on ${n} candidate steps: click Save to keep it.`;
  };
  $('#ckCallTips').onclick = () => {
    collect(); if (!defaults) return;
    const tip = Object.fromEntries((defaults.items || []).map(d => [d.id, [d.call || '', d.callAfter || 24]]));
    let n = 0; setup.items.forEach(it => { if (it.to !== 'candidate') return; const t = tip[it.id]; it.call = t ? t[0] : ''; if (t) it.callAfter = t[1]; if (it.call) n++; });
    dirty = true; render(); $('#ckState').textContent = `Recommended calls set on ${n} steps (resignation, relieving date, day before joining, Day-1 arrival, role clarity, Day-90 rating): click Save to keep it.`;
  };
  body.querySelectorAll('[data-del]').forEach(b => { b.onclick = () => { collect(); setup.items.splice(+b.dataset.del, 1); dirty = true; render(); }; });
}

function collect() {
  const s = setup;
  if (!s || !$('#ckOn')) return s;
  s.enabled = $('#ckOn').checked;
  s.autoCall = $('#ckAutoCall').checked;
  s.inductionDays = +$('#ckIndDays').value || 21;
  document.querySelectorAll('#ckBody [data-j]').forEach(el => { s.joining[el.dataset.j] = el.value.trim(); });
  document.querySelectorAll('#ckBody [data-c]').forEach(el => { s.contacts[el.dataset.c] = el.value.trim(); });
  s.infra = $('#ckInfra').value.split('\n').map(x => x.trim()).filter(Boolean);
  document.querySelectorAll('#ckBody .ck-it').forEach(d => {
    const it = s.items[+d.dataset.i]; if (!it) return;
    const v = f => d.querySelector(`[data-f="${f}"]`);
    it._open = d.open;
    it.off = !v('on').checked;
    for (const f of ['title', 'stage', 'time', 'to', 'email', 'cc', 'replyTo', 'channel', 'answer', 'text', 'when', 'call']) it[f] = v(f).value;
    it.callAfter = +v('callAfter').value || 24;
    it.day = +v('day').value || 0; it.every = +v('every').value || 0;
    it.until = v('until').value === '' ? null : +v('until').value;
    it.options = fromCsv(v('options').value); it.flag = fromCsv(v('flag').value); it.stopOn = fromCsv(v('stopOn').value);
    it.remind = +v('remind').value || 0; it.escalate = v('escalate').checked;
  });
  return s;
}

async function save() {
  collect();
  const bad = setup.items.find(it => it.answer === 'buttons' && !it.off && !it.options.length);
  if (bad) { U().toast(`"${bad.title}" needs answer options (or choose another answer type).`); return; }
  const long = setup.items.find(it => it.options.some(o => o.length > 20));
  if (long) U().toast(`Options longer than 20 letters are shortened (WhatsApp limit): "${long.title}".`);
  const items = setup.items.map(it => { const x = Object.assign({}, it); delete x._open; return x; });
  const r = await U().getJson('/api/checkins/save', { method: 'POST', body: JSON.stringify({ client, setup: Object.assign({}, setup, { items }) }) }).catch(() => ({ ok: false }));
  if (!r.ok) { $('#ckState').textContent = 'Not saved: ' + U().explain(r); return; }
  const open = new Set(setup.items.filter(it => it._open).map(it => it.id));
  setup = r.body.setup; setup.items.forEach(it => { it._open = open.has(it.id); });
  dirty = false; render();
  $('#ckState').textContent = 'Saved. Candidate journey uses it from now on.';
  if (window.tcmplLive && window.tcmplLive.forgetSetup) window.tcmplLive.forgetSetup(client);
}

(function waitForApp(n) {
  if (window.tcmplWAUtil && window.tcmplClientId && mount()) return;
  if (n > 100) return;
  setTimeout(() => waitForApp(n + 1), 100);
})(0);
