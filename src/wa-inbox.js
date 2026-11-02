// WhatsApp inbox: a tab that shows live WhatsApp conversations stored by the
// backend (candidates + messages), lets HR reply by hand, and exposes
// window.tcmplWA.start(...) which the Offer desk calls when an offer is released.

const POLL_MS = 5000;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const $ = s => document.querySelector(s);

let health = null, selected = null, timer = null, lastSig = '';

function toast(t) {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.append(el); }
  el.textContent = t; el.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('on'), 3200);
}

async function getJson(path, opts) {
  const res = await fetch(path, Object.assign({ credentials: 'same-origin', headers: { accept: 'application/json', 'content-type': 'application/json' } }, opts || {}));
  const type = res.headers.get('content-type') || '';
  const body = type.includes('application/json') ? await res.json().catch(() => null) : null;
  return { ok: res.ok, status: res.status, body };
}

async function loadHealth() {
  if (health) return health;
  const r = await getJson('/api/health').catch(() => ({ ok: false }));
  health = (r.ok && r.body) || {};
  return health;
}

/* ---------- called by the Offer desk ---------- */
window.tcmplWA = {
  async start(payload) {
    const h = await loadHealth();
    if (!h.db) return; // backend not connected (e.g. local preview)
    const body = Object.assign({}, payload);
    if (body.letterPdf instanceof Blob) {
      body.letterPdfBase64 = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = () => res(''); fr.readAsDataURL(body.letterPdf); });
    }
    delete body.letterPdf;
    const r = await getJson('/api/wa/start', { method: 'POST', body: JSON.stringify(body) }).catch(() => ({ ok: false, body: null }));
    if (r.ok && r.body && r.body.sent) toast(`WhatsApp sent to ${payload.name}. Replies appear in the WhatsApp tab.`);
    else if (r.ok && r.body && r.body.reason === 'whatsapp_not_configured') { /* WhatsApp not switched on yet: stay quiet */ }
    else if (r.body && r.body.error === 'valid_mobile_required') toast('WhatsApp not sent: add a valid mobile number for the candidate.');
    else toast('WhatsApp could not be sent. Check the WhatsApp tab for details.');
  }
};

/* ---------- tab ---------- */
function mount() {
  const nav = $('nav.tabs'), main = $('main.wrap') || ($('section.tab') && $('section.tab').parentElement);
  if (!nav || !main || $('#tab-wa')) return Boolean($('#tab-wa'));

  const btn = document.createElement('button');
  btn.setAttribute('role', 'tab'); btn.dataset.tab = 'wa'; btn.setAttribute('aria-selected', 'false');
  btn.textContent = '8 · WhatsApp';
  nav.append(btn);

  const sec = document.createElement('section');
  sec.className = 'tab'; sec.id = 'tab-wa'; sec.hidden = true;
  sec.innerHTML = `
  <div class="intro"><div><h2>WhatsApp inbox</h2><p>Live conversations between the agent and candidates on WhatsApp. The agent answers automatically; reply here when a person needs to step in.</p></div>
    <div class="row"><span class="chip" id="waState">Checking…</span><button class="btn small" id="waRefresh">Refresh</button></div></div>
  <div class="grid2" style="grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr)">
    <div class="card"><h3 style="margin-bottom:8px">Candidates</h3><div id="waList" class="log"><div class="note">No WhatsApp conversations yet. Release an offer for a candidate with a valid mobile number.</div></div></div>
    <div>
      <div class="phone">
        <div class="phead"><div class="avatar" id="waAvatar">WA</div><div><div class="t" id="waName">Select a candidate</div><div class="s" id="waSub">WhatsApp Business</div></div></div>
        <div class="msgs" id="waMsgs" aria-live="polite"></div>
        <form class="composer" id="waForm" style="display:flex;gap:8px;padding:8px">
          <input id="waText" type="text" placeholder="Reply as HR (sent on WhatsApp)…" style="flex:1;min-width:0" disabled>
          <button class="btn primary small" id="waSend" disabled>Send</button>
        </form>
      </div>
      <div class="card" style="margin-top:12px" id="waFacts"><dl class="kv"><dt>Risk</dt><dd>—</dd><dt>Handed to people</dt><dd>—</dd></dl></div>
    </div>
  </div>`;
  const last = [...main.querySelectorAll('section.tab')].pop();
  (last ? last.after(sec) : main.append(sec));

  // Our tab button: hide the other sections; the app's own buttons hide ours.
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav.tabs button').forEach(b => b.setAttribute('aria-selected', String(b === btn)));
    document.querySelectorAll('section.tab').forEach(s => { s.hidden = s !== sec; });
    window.scrollTo({ top: 0 });
    refresh(true);
    if (!timer) timer = setInterval(() => { if (!sec.hidden && document.visibilityState === 'visible') refresh(false); }, POLL_MS);
  });
  nav.querySelectorAll('button').forEach(b => { if (b !== btn) b.addEventListener('click', () => { btn.setAttribute('aria-selected', 'false'); sec.hidden = true; }); });

  $('#waRefresh').onclick = () => refresh(true);
  $('#waForm').onsubmit = async e => {
    e.preventDefault();
    const text = $('#waText').value.trim();
    if (!text || !selected) return;
    $('#waSend').disabled = true;
    const r = await getJson('/api/wa/send', { method: 'POST', body: JSON.stringify({ candidateId: selected, text }) }).catch(() => ({ ok: false }));
    $('#waSend').disabled = false;
    if (r.ok) { $('#waText').value = ''; refresh(true); }
    else toast(r.body && r.body.detail ? 'Not sent: ' + r.body.detail : 'Not sent. WhatsApp only allows free replies within 24 hours of the candidate\'s last message.');
  };
  return true;
}

function fmt(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

async function refresh(force) {
  const h = await loadHealth();
  const state = $('#waState');
  if (state) {
    if (!h.db) { state.textContent = 'Database not connected'; state.className = 'chip warn'; }
    else if (!h.whatsapp) { state.textContent = 'WhatsApp not connected yet'; state.className = 'chip warn'; }
    else if (!h.webhook) { state.textContent = 'Sending on · replies not connected'; state.className = 'chip warn'; }
    else { state.textContent = 'WhatsApp live'; state.className = 'chip ok'; }
  }
  if (!h.db) return;
  const [c, m] = await Promise.all([getJson('/api/data/candidates'), getJson('/api/data/messages')]).catch(() => [{}, {}]);
  if (!c.ok || !m.ok) return;
  const cands = (c.body.items || []).map(i => Object.assign({ id: i.id }, i.data)).sort((a, b) => String(b.lastMessageAt).localeCompare(String(a.lastMessageAt)));
  const msgs = (m.body.items || []).map(i => i.data);
  const sig = JSON.stringify([cands.map(x => [x.id, x.lastMessageAt]), msgs.length, selected]);
  if (!force && sig === lastSig) return;
  lastSig = sig;
  if (!selected && cands.length) selected = cands[0].id;

  $('#waList').innerHTML = cands.length ? cands.map(x => {
    const open = (x.handovers || []).filter(h2 => h2.open).length;
    const risk = x.riskScore >= 40 ? '<span class="chip bad">High risk</span>' : x.riskScore > 0 ? '<span class="chip warn">Medium</span>' : '';
    return `<button type="button" class="btn" data-cid="${esc(x.id)}" style="display:block;width:100%;text-align:left;margin-bottom:6px;${x.id === selected ? 'border-color:var(--blue)' : ''}">
      <b>${esc(x.name || '+' + x.phone)}</b> ${risk} ${open ? `<span class="chip info">${open} to handle</span>` : ''}<br>
      <span class="note">${esc(x.role || x.stage || '')}${x.clientLabel ? ' · ' + esc(x.clientLabel) : ''} · ${esc(fmt(x.lastMessageAt))}</span></button>`;
  }).join('') : '<div class="note">No WhatsApp conversations yet. Release an offer for a candidate with a valid mobile number.</div>';
  document.querySelectorAll('#waList [data-cid]').forEach(b => { b.onclick = () => { selected = b.dataset.cid; refresh(true); }; });

  const cur = cands.find(x => x.id === selected);
  $('#waText').disabled = $('#waSend').disabled = !cur || !h.whatsapp;
  if (!cur) { $('#waMsgs').innerHTML = ''; return; }
  $('#waName').textContent = cur.name || '+' + cur.phone;
  $('#waSub').textContent = '+' + cur.phone + (cur.clientLabel ? ' · ' + cur.clientLabel : '');
  $('#waAvatar').textContent = (cur.name || 'WA').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const thread = msgs.filter(x => x.candidateId === selected).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  // Candidate messages on the left, agent/HR on the right (the inbox is HR's view).
  $('#waMsgs').innerHTML = thread.map(x => `<div class="b ${x.direction === 'in' ? 'in' : 'out'}"><p>${esc(x.text)}</p><span class="meta">${esc(fmt(x.at))}${x.direction === 'out' ? ' · ' + (x.source === 'hr' ? 'HR' : x.source === 'ai' ? 'Agent (AI)' : 'Agent') : ''}${x.error ? ' · not delivered' : ''}</span></div>`).join('') || '<div class="note" style="padding:12px">No messages yet.</div>';
  const box = $('#waMsgs'); box.scrollTop = box.scrollHeight;
  const risk = (cur.risk || []).map(r => esc(r.label)).join('; ') || 'None';
  const ho = (cur.handovers || []).map(x => `${esc(x.why)} <span class="note">${esc(fmt(x.at))}</span>`).join('<br>') || 'None';
  $('#waFacts').innerHTML = `<dl class="kv"><dt>Risk score</dt><dd>${cur.riskScore || 0}/100</dd><dt>Risk signals</dt><dd>${risk}</dd><dt>Handed to people</dt><dd>${ho}</dd><dt>Stage</dt><dd>${esc(cur.stage || '')}</dd></dl>`;
}

// The app renders its markup first; mount once the tabs exist.
(function waitForApp(n) {
  if (mount()) return;
  if (n > 100) return;
  setTimeout(() => waitForApp(n + 1), 100);
})(0);
