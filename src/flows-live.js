// Named candidate journeys (Client setup → Candidate journey).
//  - A journey is a set of steps picked from the tool's step library, each with its timing (O+2 = two days after
//    the offer, D-7 = a week before joining, D+30 = 30 days after), its channel (WhatsApp, AI call, or WhatsApp
//    then a call if there is no reply) and, for the documents step, which documents are collected on WhatsApp.
//    Clients' own extra steps are added too.
//  - Journeys are shared: build "Nurses" or "Corporate" once and use it for any client. Each client picks a default
//    journey and can use a different one by role, grade or department.
//  - A candidate keeps the journey chosen when their offer was released.
// Stored: flows/<id> = { name, note, steps: { key: { when, ch } }, custom: [...], docs: [...] };
// the client's choice: clients/<id>.ov.flow = { def, rules: [{ f, v, id }] } (saved with the rest of Client setup).
// Used by buildPlan() in legacy-app.js through window.tcmplFlowFor(clientId, candidate).

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const toast = m => (window.tcmplWAUtil && window.tcmplWAUtil.toast ? window.tcmplWAUtil.toast(m) : console.log(m));
const uid = () => 'fl-' + Math.random().toString(36).slice(2, 10);

async function getJson(path) {
  try { const r = await fetch(path, { credentials: 'same-origin', headers: { accept: 'application/json' } }); return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) }; } catch { return { ok: false, status: 0, body: null }; }
}
async function send(method, path, body) {
  try { const r = await fetch(path, { method, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { ok: r.ok, status: r.status }; } catch { return { ok: false, status: 0 }; }
}

const CH = [['wa', 'WhatsApp'], ['call', 'AI call'], ['wa_call', 'WhatsApp, then a call if no reply']];
const DOCS = [['aadhaar', 'Aadhaar'], ['pan', 'PAN'], ['bank', 'Bank proof']];
const WHO = { c: 'Candidate', m: 'Manager', s: 'IT, Admin, Security' };
const STAGES = [['offer', 'Offer and acceptance'], ['pre', 'Before joining'], ['day1', 'Day 1'], ['p90', 'First 90 days']];
// Steps where a call fits best by default (see "Where calls help" in the builder).
const CALL_FIT = new Set(['offer', 'resign', 'call', 'welcome', 'survey_d1', 'week1', 'final90', 'docs', 'checkin']);

let flows = [], loaded = false, edit = null, dirty = false;

function lib() { return window.tcmplJourneyLib ? window.tcmplJourneyLib() : { steps: {}, cadence: {} }; }
const parse = code => { const m = /^([OD])([+-]\d+)$/.exec(code || ''); return m ? { base: m[1], n: +m[2] } : null; };
const stageOf = code => { const p = parse(code); if (!p) return 'pre'; if (p.base === 'O') return 'offer'; if (p.n < 0) return 'pre'; if (p.n <= 1) return 'day1'; return 'p90'; };
const sortKey = code => { const p = parse(code); return p ? (p.base === 'O' ? -1000 + p.n : p.n) : 0; };
const validWhen = v => /^[OD][+-]\d{1,3}$/.test(v);
const normWhen = v => String(v || '').trim().toUpperCase().replace(/^D0$/, 'D+0').replace(/^O0$/, 'O+0');

/* ---------- journeys for candidates ---------- */
const flowById = id => flows.find(f => f.id === id);
function clientChoice(cid) {
  const ov = window.tcmplClientOv ? window.tcmplClientOv(cid) : null;
  return (ov && ov.flow) || { def: '', rules: [] };
}
window.tcmplFlowFor = (cid, c) => {
  if (!loaded) return null;
  if (c && c.flow) { const f = flowById(c.flow); if (f) return Object.assign({ id: f.id }, f.data); }
  const ch = clientChoice(cid);
  let id = ch.def || '';
  for (const r of ch.rules || []) {
    const v = String((c && c[r.f]) || '').toLowerCase(), want = String(r.v || '').toLowerCase().trim();
    if (want && v.includes(want)) { id = r.id; break; }
  }
  const f = id && flowById(id);
  return f ? Object.assign({ id: f.id }, f.data) : null;
};

async function load() {
  const r = await getJson('/api/data/flows');
  flows = (r.ok && r.body && Array.isArray(r.body.items) ? r.body.items : []).filter(x => x && x.data && x.data.name).sort((a, b) => a.data.name.localeCompare(b.data.name));
  loaded = true;
  render();
  if (window.tcmplRebuildJourney) window.tcmplRebuildJourney();
}

/* ---------- builders ---------- */
function standardJourney(name) {
  const L = lib();
  const steps = {};
  for (const k of Object.keys(L.steps)) steps[k] = { when: L.cadence[k], ch: k === 'call' ? 'call' : 'wa' };
  return { name, note: '', steps, custom: [], docs: DOCS.map(d => d[0]) };
}
function fromClient(name) {
  const L = lib(), ov = (window.tcmplClientOv && window.tcmplClientOv(window.tcmplClientId())) || {};
  const off = ov.off || [], cad = Object.assign({}, L.cadence, ov.cadence || {});
  const steps = {};
  for (const k of Object.keys(L.steps)) if (!off.includes(k)) steps[k] = { when: cad[k], ch: k === 'call' ? 'call' : 'wa' };
  const custom = (ov.customTps || []).map(t => ({ id: t.id, name: t.name, when: t.when, track: t.track, ch: t.channel === 'Call' ? 'call' : 'wa', msg: t.msg || '' }));
  return { name, note: '', steps, custom, docs: DOCS.map(d => d[0]) };
}

/* ---------- render ---------- */
function usedBy(id) {
  const all = window.tcmplClients ? window.tcmplClients() : [];
  return all.filter(c => { const ch = clientChoice(c.id); return ch.def === id || (ch.rules || []).some(r => r.id === id); }).map(c => c.label);
}

function render() {
  const card = $('#flowCard');
  if (!card) return;
  const cid = window.tcmplClientId ? window.tcmplClientId() : 'default';
  const isDef = cid === 'default';
  const ch = clientChoice(cid);
  const opts = (cur, none) => `<option value="">${esc(none)}</option>` + flows.map(f => `<option value="${esc(f.id)}" ${f.id === cur ? 'selected' : ''}>${esc(f.data.name)}</option>`).join('');
  card.innerHTML = `<div class="row" style="justify-content:space-between;align-items:flex-start"><div><h3>Candidate journey</h3>
      <p class="note" style="margin:4px 0 0">Build journeys from the tool's steps and reuse them across clients, e.g. "Nurses" or "Corporate". Each step has its timing and channel. Candidates keep the journey they had when their offer was released.</p></div></div>
    <div class="fl-assign">
      <div class="field"><label class="lbl" for="flDef">Journey for ${esc(window.tcmplClientLabel ? window.tcmplClientLabel() : cid)}</label>
        <select id="flDef" ${isDef ? 'disabled' : ''}>${opts(ch.def, "This client's own step settings (below)")}</select></div>
      <div class="fl-rules"><div class="lbl">A different journey for some candidates</div>
        ${(ch.rules || []).map((r, i) => `<div class="row fl-rule"><select data-flrf="${i}" ${isDef ? 'disabled' : ''}>${[['role', 'Designation'], ['grade', 'Grade'], ['dept', 'Department']].map(([v, l]) => `<option value="${v}" ${r.f === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <span class="note">contains</span><input type="text" data-flrv="${i}" value="${esc(r.v || '')}" placeholder="e.g. nurse" ${isDef ? 'disabled' : ''}>
          <span class="note">→</span><select data-flri="${i}" ${isDef ? 'disabled' : ''}>${opts(r.id, 'Choose a journey')}</select><button class="btn small" data-flrx="${i}" type="button" ${isDef ? 'disabled' : ''}>Remove</button></div>`).join('')}
        <button class="btn small" id="flRuleAdd" type="button" ${isDef || !flows.length ? 'disabled' : ''}>Add a rule</button></div>
      ${isDef ? '<p class="note">Pick a client at the top to choose its journey. The TCMPL default client uses the standard steps.</p>' : ''}
    </div>
    <div class="fl-edit-h row">
      <div class="field"><label class="lbl" for="flPick">Edit a journey</label><select id="flPick">${flows.length ? flows.map(f => `<option value="${esc(f.id)}" ${edit && edit.id === f.id ? 'selected' : ''}>${esc(f.data.name)}</option>`).join('') : '<option value="">No journeys yet</option>'}${edit && !flowById(edit.id) ? `<option value="${esc(edit.id)}" selected>${esc(edit.data.name)} (new, not saved)</option>` : ''}</select></div>
      <button class="btn small" id="flNewStd" type="button">New from TCMPL standard</button>
      <button class="btn small" id="flNewCl" type="button" ${isDef ? 'disabled' : ''}>New from this client's steps</button>
      ${edit ? '<button class="btn small" id="flDup" type="button">Duplicate</button><button class="btn small" id="flDel" type="button">Delete</button>' : ''}
    </div>
    <div id="flBuilder"></div>`;
  wireAssign(cid, ch);
  $('#flPick').onchange = () => { if (dirty && !window.confirm('Discard the unsaved changes to this journey?')) { render(); return; } const f = flowById($('#flPick').value); edit = f ? { id: f.id, data: JSON.parse(JSON.stringify(f.data)) } : null; dirty = false; render(); };
  $('#flNewStd').onclick = () => { if (dirty && !window.confirm('Discard the unsaved changes?')) return; edit = { id: uid(), data: standardJourney('New journey') }; dirty = true; render(); setTimeout(() => { const n = $('#flName'); if (n) { n.focus(); n.select(); } }, 0); };
  if ($('#flNewCl')) $('#flNewCl').onclick = () => { if (dirty && !window.confirm('Discard the unsaved changes?')) return; edit = { id: uid(), data: fromClient((window.tcmplClientLabel ? window.tcmplClientLabel() : '') + ' journey') }; dirty = true; render(); };
  if ($('#flDup')) $('#flDup').onclick = () => { edit = { id: uid(), data: Object.assign(JSON.parse(JSON.stringify(edit.data)), { name: edit.data.name + ' (copy)' }) }; dirty = true; render(); };
  if ($('#flDel')) $('#flDel').onclick = async () => {
    const u = usedBy(edit.id);
    if (u.length) { toast(`This journey is used by ${u.join(', ')}. Choose another journey for them first.`); return; }
    if (!window.confirm(`Delete the journey "${edit.data.name}"? Candidates already on it keep their steps until their next update.`)) return;
    if (flowById(edit.id)) { const r = await send('DELETE', '/api/data/flows/' + encodeURIComponent(edit.id)); if (!r.ok) { toast('Could not delete the journey.'); return; } }
    edit = null; dirty = false; await load(); toast('Journey deleted.');
  };
  if (!edit && flows.length) { const f = flowById(ch.def) || flows[0]; edit = { id: f.id, data: JSON.parse(JSON.stringify(f.data)) }; dirty = false; const pk = $('#flPick'); if (pk) pk.value = f.id; }
  renderBuilder();
}

function saveChoice(cid, ch) {
  if (!window.tcmplSetClientFlow) return;
  window.tcmplSetClientFlow(cid, { def: ch.def || '', rules: (ch.rules || []).filter(r => r.v || r.id).map(r => ({ f: r.f || 'role', v: String(r.v || '').slice(0, 60), id: r.id || '' })) });
}
function wireAssign(cid, ch0) {
  const ch = { def: ch0.def || '', rules: (ch0.rules || []).map(r => Object.assign({}, r)) };
  const d = $('#flDef'); if (d) d.onchange = () => { ch.def = d.value; saveChoice(cid, ch); toast(d.value ? `New offers for this client use "${flowById(d.value).data.name}".` : 'New offers use this client\'s own step settings.'); };
  document.querySelectorAll('[data-flrf]').forEach(s => { s.onchange = () => { ch.rules[+s.dataset.flrf].f = s.value; saveChoice(cid, ch); }; });
  document.querySelectorAll('[data-flrv]').forEach(s => { s.onchange = () => { ch.rules[+s.dataset.flrv].v = s.value.trim(); saveChoice(cid, ch); }; });
  document.querySelectorAll('[data-flri]').forEach(s => { s.onchange = () => { ch.rules[+s.dataset.flri].id = s.value; saveChoice(cid, ch); }; });
  document.querySelectorAll('[data-flrx]').forEach(b => { b.onclick = () => { ch.rules.splice(+b.dataset.flrx, 1); saveChoice(cid, ch); render(); }; });
  const add = $('#flRuleAdd'); if (add) add.onclick = () => { ch.rules.push({ f: 'role', v: '', id: '' }); saveChoice(cid, ch); render(); };
}

function renderBuilder() {
  const box = $('#flBuilder');
  if (!box) return;
  if (!edit) { box.innerHTML = '<p class="note" style="margin-top:10px">Start with "New from TCMPL standard" (every step, standard timings) or "New from this client\'s steps", then take out or add steps.</p>'; return; }
  const L = lib(), d = edit.data;
  const inJ = Object.entries(d.steps || {}).filter(([k]) => L.steps[k]).map(([k, v]) => ({ k, when: v.when || L.cadence[k], ch: v.ch || 'wa', info: L.steps[k] }));
  const custom = (d.custom || []).map(c => ({ cx: c, when: c.when }));
  const rows = inJ.map(x => ({ type: 'std', x, when: x.when })).concat(custom.map(c => ({ type: 'cx', c: c.cx, when: c.when }))).sort((a, b) => sortKey(a.when) - sortKey(b.when));
  const avail = Object.keys(L.steps).filter(k => !(d.steps || {})[k]);
  const used = usedBy(edit.id);
  box.innerHTML = `<div class="fl-top row"><div class="field" style="flex:1;min-width:220px"><label class="lbl" for="flName">Journey name</label><input type="text" id="flName" value="${esc(d.name)}"></div>
      <div class="field" style="flex:2;min-width:260px"><label class="lbl" for="flNote">Who it is for (note)</label><input type="text" id="flNote" value="${esc(d.note || '')}" placeholder="e.g. Staff nurses, ward staff"></div></div>
    ${used.length ? `<p class="note">Used by: ${esc(used.join(', '))}. Changes apply to their candidates' upcoming steps.</p>` : ''}
    <div class="fl-cols">
      <div class="fl-lib"><h4>Steps you can add</h4>
        ${STAGES.map(([sid, sl]) => { const ks = avail.filter(k => stageOf(L.cadence[k]) === sid); return ks.length ? `<div class="fl-grp"><div class="fl-gh">${esc(sl)}</div>${ks.map(k => `<button type="button" class="fl-add" data-fladd="${k}"><span class="trk ${L.steps[k].k}">${esc(WHO[L.steps[k].k])}</span><span>${esc(L.steps[k].t)}</span><span class="note">${esc(L.cadence[k])}</span><b aria-hidden="true">+</b></button>`).join('')}</div>` : ''; }).join('') || '<p class="note">Every standard step is in this journey.</p>'}
        <button type="button" class="btn small" id="flAddOwn" style="margin-top:8px">Add your own step</button>
        <details class="fl-tip"><summary>Where calls help</summary><p class="note">An AI call works best where candidates drop out: the offer (no answer in 2 days), the resignation check, the day before joining, Day 1 or 2 ("how was your first day"), the Week-1 check and the Day-90 review. Use "WhatsApp, then a call if no reply" for the rest. HR starts each call from the Candidate journey screen; calls go out between 9 am and 8 pm.</p></details>
      </div>
      <div class="fl-tl"><h4>In this journey <span class="note">(${rows.length} steps · O = offer day, D = joining day)</span></h4>
        ${STAGES.map(([sid, sl]) => { const rs = rows.filter(r => stageOf(r.when) === sid); return rs.length ? `<div class="fl-grp"><div class="fl-gh">${esc(sl)}</div>${rs.map(r => r.type === 'std' ? stdRow(r.x) : ownRow(r.c)).join('')}</div>` : ''; }).join('') || '<p class="note">No steps yet. Add steps from the left.</p>'}
      </div>
    </div>
    <div class="row" style="margin-top:12px;gap:8px"><button class="btn primary" id="flSave" type="button">Save journey</button><span class="note" id="flState">${dirty ? 'Not saved yet' : 'Saved'}</span></div>`;
  wireBuilder();
}

function stdRow(x) {
  const fit = CALL_FIT.has(x.k) && x.ch === 'wa' ? '<span class="chip info" title="A call often helps here">call fits</span>' : '';
  return `<div class="fl-step" data-k="${x.k}">
    <div class="fl-s1"><span class="trk ${x.info.k}">${esc(WHO[x.info.k])}</span><b>${esc(x.info.t)}</b>${fit}</div>
    <div class="fl-s2"><label class="note">When <input type="text" class="fl-when" data-flwhen="${x.k}" value="${esc(x.when)}" aria-label="When ${esc(x.info.t)}"></label>
      ${x.info.k === 'c' ? `<label class="note">How <select data-flch="${x.k}" aria-label="Channel for ${esc(x.info.t)}">${CH.map(([v, l]) => `<option value="${v}" ${x.ch === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : '<span class="note">Email to the owner</span>'}
      ${x.k === 'docs' ? `<span class="fl-docs">${DOCS.map(([v, l]) => `<label class="note"><input type="checkbox" data-fldoc="${v}" ${(edit.data.docs || []).includes(v) ? 'checked' : ''}> ${l}</label>`).join('')}</span>` : ''}
      <button type="button" class="btn small" data-flrm="${x.k}">Remove</button></div></div>`;
}
function ownRow(c) {
  return `<div class="fl-step own" data-cx="${esc(c.id)}">
    <div class="fl-s1"><span class="trk ${c.track || 'c'}">${esc(WHO[c.track || 'c'])}</span><input type="text" data-cxn="${esc(c.id)}" value="${esc(c.name)}" aria-label="Step name"><span class="chip">Your own</span></div>
    <div class="fl-s2"><label class="note">When <input type="text" class="fl-when" data-cxw="${esc(c.id)}" value="${esc(c.when)}" aria-label="When"></label>
      <label class="note">Who <select data-cxt="${esc(c.id)}">${Object.entries(WHO).map(([v, l]) => `<option value="${v}" ${(c.track || 'c') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="note">How <select data-cxc="${esc(c.id)}">${CH.map(([v, l]) => `<option value="${v}" ${(c.ch || 'wa') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <button type="button" class="btn small" data-cxx="${esc(c.id)}">Remove</button></div>
    <textarea data-cxm="${esc(c.id)}" rows="2" placeholder="Message. You can use {first}, {company}, {doj}, {manager}" aria-label="Message">${esc(c.msg || '')}</textarea></div>`;
}

function touch() { dirty = true; const s = $('#flState'); if (s) s.textContent = 'Not saved yet'; }
function wireBuilder() {
  const d = edit.data, L = lib();
  $('#flName').oninput = e => { d.name = e.target.value; touch(); };
  $('#flNote').oninput = e => { d.note = e.target.value; touch(); };
  document.querySelectorAll('[data-fladd]').forEach(b => { b.onclick = () => { const k = b.dataset.fladd; d.steps[k] = { when: L.cadence[k], ch: k === 'call' ? 'call' : 'wa' }; touch(); renderBuilder(); }; });
  document.querySelectorAll('[data-flrm]').forEach(b => { b.onclick = () => { delete d.steps[b.dataset.flrm]; touch(); renderBuilder(); }; });
  document.querySelectorAll('[data-flwhen]').forEach(i => { i.onchange = () => { const v = normWhen(i.value); if (!validWhen(v)) { toast('Use a timing like O+2, D-7, D+0 or D+30.'); i.value = d.steps[i.dataset.flwhen].when; return; } d.steps[i.dataset.flwhen].when = v; touch(); renderBuilder(); }; });
  document.querySelectorAll('[data-flch]').forEach(s => { s.onchange = () => { d.steps[s.dataset.flch].ch = s.value; touch(); renderBuilder(); }; });
  document.querySelectorAll('[data-fldoc]').forEach(c => { c.onchange = () => { const set = new Set(d.docs || []); if (c.checked) set.add(c.dataset.fldoc); else set.delete(c.dataset.fldoc); d.docs = DOCS.map(x => x[0]).filter(x => set.has(x)); if (!d.docs.length) { toast('Keep at least one document, or remove the Documents step.'); c.checked = true; d.docs = [c.dataset.fldoc]; } touch(); }; });
  const cx = id => d.custom.find(c => c.id === id);
  document.querySelectorAll('[data-cxn]').forEach(i => { i.oninput = () => { cx(i.dataset.cxn).name = i.value; touch(); }; });
  document.querySelectorAll('[data-cxm]').forEach(i => { i.oninput = () => { cx(i.dataset.cxm).msg = i.value; touch(); }; });
  document.querySelectorAll('[data-cxw]').forEach(i => { i.onchange = () => { const v = normWhen(i.value); if (!validWhen(v)) { toast('Use a timing like O+2, D-7, D+0 or D+30.'); i.value = cx(i.dataset.cxw).when; return; } cx(i.dataset.cxw).when = v; touch(); renderBuilder(); }; });
  document.querySelectorAll('[data-cxt]').forEach(s => { s.onchange = () => { cx(s.dataset.cxt).track = s.value; touch(); renderBuilder(); }; });
  document.querySelectorAll('[data-cxc]').forEach(s => { s.onchange = () => { cx(s.dataset.cxc).ch = s.value; touch(); }; });
  document.querySelectorAll('[data-cxx]').forEach(b => { b.onclick = () => { d.custom = d.custom.filter(c => c.id !== b.dataset.cxx); touch(); renderBuilder(); }; });
  $('#flAddOwn').onclick = () => { d.custom = d.custom || []; d.custom.push({ id: 'c' + Math.random().toString(36).slice(2, 8), name: 'New step', when: 'D-2', track: 'c', ch: 'wa', msg: 'Hi {first}, ' }); touch(); renderBuilder(); };
  $('#flSave').onclick = save;
}

async function save() {
  const d = edit.data;
  d.name = String(d.name || '').trim();
  if (!d.name) { toast('Give the journey a name.'); return; }
  if (flows.some(f => f.id !== edit.id && f.data.name.toLowerCase() === d.name.toLowerCase())) { toast('Another journey already has this name.'); return; }
  if (!Object.keys(d.steps || {}).length && !(d.custom || []).length) { toast('Add at least one step.'); return; }
  const body = { name: d.name.slice(0, 80), note: String(d.note || '').slice(0, 200), steps: d.steps, custom: (d.custom || []).map(c => ({ id: c.id, name: String(c.name || '').slice(0, 120), when: c.when, track: c.track || 'c', ch: c.ch || 'wa', msg: String(c.msg || '').slice(0, 1500) })), docs: d.docs || DOCS.map(x => x[0]), updated: new Date().toISOString() };
  const r = await send('PUT', '/api/data/flows/' + encodeURIComponent(edit.id), body);
  if (!r.ok) { toast(r.status === 403 ? 'You do not have permission to change journeys.' : 'Could not save the journey.'); return; }
  dirty = false;
  const keep = edit.id; await load();
  const f = flowById(keep); if (f) { edit = { id: f.id, data: JSON.parse(JSON.stringify(f.data)) }; render(); }
  toast(`Journey "${d.name}" saved.${usedBy(keep).length ? '' : ' Choose it for a client above to use it.'}`);
}

function start(n) {
  if (!$('#flowCard') || !window.tcmplJourneyLib) { if (n < 100) setTimeout(() => start(n + 1), 150); return; }
  load();
  const sel = $('#clientSel'); if (sel) sel.addEventListener('change', () => setTimeout(render, 60));
}
start(0);
