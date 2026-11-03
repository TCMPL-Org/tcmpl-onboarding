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
window.tcmplWA = Object.assign(window.tcmplWA || {}, {
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
});


/* ---------- sending prepared journey touchpoints ---------- */
function candId(mobile) {
  let d = String(mobile || '').replace(/\D+/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = '91' + d;
  return d.length >= 11 && d.length <= 15 ? 'wa-' + d : '';
}

// Turns an agent chat bubble into WhatsApp text (*bold*, bullets, table rows as "Label: value").
function toWaText(el) {
  const out = [];
  const walk = (n) => {
    if (n.nodeType === 3) { out.push(n.nodeValue.replace(/\s+/g, ' ')); return; }
    if (n.nodeType !== 1) return;
    const tag = n.tagName;
    if (n.classList.contains('meta')) return;
    if (tag === 'BR') { out.push('\n'); return; }
    if (tag === 'B' || tag === 'STRONG') { out.push('*' + n.textContent.trim() + '*'); return; }
    if (tag === 'TR') { const c = [...n.children].map(td => td.textContent.trim()).filter(Boolean); out.push(c.join(': ') + '\n'); return; }
    if (tag === 'LI') { out.push('• '); n.childNodes.forEach(walk); out.push('\n'); return; }
    if (tag === 'A' && n.getAttribute('href') && /^https?:/.test(n.getAttribute('href'))) { out.push((n.textContent.trim() || 'Link') + ': ' + n.getAttribute('href') + '\n'); return; }
    n.childNodes.forEach(walk);
    if (tag === 'P' || tag === 'DIV' || tag === 'UL' || tag === 'OL' || tag === 'TABLE') out.push('\n');
  };
  walk(el);
  return out.join('').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function blobToBase64(blob) {
  return new Promise(res => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = () => res(''); fr.readAsDataURL(blob); });
}

// Collects the current touchpoint's agent messages (stops at the first simulated candidate reply).
async function collectTouchpoint() {
  const box = $('#msgs');
  if (!box) return { items: [], skipped: 0 };
  const start = Math.min(window.tcmplTpStart || 0, box.children.length);
  const items = []; let skipped = 0;
  for (const n of [...box.children].slice(start)) {
    if (n.classList.contains('b') && n.classList.contains('out')) break;
    if (n.classList.contains('b') && n.classList.contains('in')) { const t = toWaText(n); if (t) items.push({ type: 'text', text: t }); continue; }
    if (n.classList.contains('qr')) {
      const titles = [...n.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean);
      const last = items[items.length - 1];
      if (last && last.type === 'text' && titles.length) {
        if (titles.length <= 3 && titles.every(t => t.length <= 20)) last.buttons = titles;
        else last.text += '\n\nReply with: ' + titles.join(' / ');
      }
      continue;
    }
    if (n.classList.contains('doc')) {
      const nm = (n.querySelector('.nm') || n).textContent.trim();
      if (/offer_letter/i.test(nm)) {
        const pdf = window.tcmplLetterPdf && window.tcmplLetterPdf();
        const it = { type: 'letter', filename: nm };
        if (pdf && pdf.blob instanceof Blob) it.pdfBase64 = await blobToBase64(pdf.blob);
        items.push(it);
      } else skipped++;
      continue;
    }
  }
  // Send the letter first, then the message that talks about it.
  items.sort((a, b) => (a.type === 'letter' ? -1 : 0) - (b.type === 'letter' ? -1 : 0));
  return { items, skipped };
}

async function push(candidateId, items, touchpoint) {
  return getJson('/api/wa/push', { method: 'POST', body: JSON.stringify({ candidateId, items, touchpoint }) }).catch(() => ({ ok: false, body: null }));
}

function explain(r) {
  const e = r.body && r.body.error;
  if (e === 'window_closed') return 'Not sent: the candidate has not written on WhatsApp in the last 24 hours. Ask them to reply once (e.g. "Hi"), then send again.';
  if (e === 'candidate_not_found') return 'Not sent: release this offer first so the candidate is registered for WhatsApp.';
  if (e === 'no_offer_letter') return 'Not sent: no offer letter PDF available. Open the Offer desk for this candidate and try again.';
  if (e === 'whatsapp_not_configured') return 'WhatsApp is not connected yet.';
  return 'Not sent' + (r.body && r.body.detail ? ': ' + r.body.detail : '. Please try again.');
}

async function sendCurrentTouchpoint(quiet) {
  const c = window.tcmplCurrent && window.tcmplCurrent();
  const id = c && candId(c.mobile);
  if (!id) { if (!quiet) toast('This candidate has no valid WhatsApp number.'); return; }
  const { items, skipped } = await collectTouchpoint();
  if (!items.length) { if (!quiet) toast('Nothing to send for this touchpoint.'); return; }
  const tp = (window.tcmplTouchpoint && window.tcmplTouchpoint()) || '';
  const btn = $('#waSendTp'); if (btn) btn.disabled = true;
  const r = await push(id, items, tp);
  if (btn) btn.disabled = false;
  if (r.ok) toast(`Sent on WhatsApp to ${c.name}: ${r.body.sent} message${r.body.sent === 1 ? '' : 's'}${tp ? ' (' + tp + ')' : ''}${skipped ? `. ${skipped} attachment(s) are demo-only and were not sent.` : '.'}`);
  else toast(explain(r));
}

async function mountJourneyControls() {
  if ($('#waSendTp')) return true;
  const chip = $('#aiChip');
  if (!chip) return false;
  const h = await loadHealth();
  if (!h.whatsapp || $('#waSendTp')) return true;
  const wrap = document.createElement('span');
  wrap.className = 'row';
  wrap.style.gap = '8px';
  wrap.innerHTML = `<button class="btn small primary" id="waSendTp" type="button" title="Send this touchpoint's messages to the candidate's real WhatsApp">Send this touchpoint on WhatsApp</button>
    <label class="note" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="waAuto"> Auto-send each next touchpoint</label>`;
  chip.after(wrap);
  $('#waSendTp').onclick = () => sendCurrentTouchpoint(false);
  return true;
}

window.tcmplWA = window.tcmplWA || {};
window.tcmplWA.onTouchpoint = () => {
  const auto = $('#waAuto');
  if (auto && auto.checked) setTimeout(() => sendCurrentTouchpoint(true), 400);
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
    <div class="row"><span class="chip" id="waState">Checking…</span><button class="btn small" id="waLetter" type="button">Send offer letter again</button><button class="btn small" id="waRefresh">Refresh</button></div></div>
  <div class="grid2" style="grid-template-columns:minmax(260px,.9fr) minmax(0,1.1fr)">
    <div class="card"><h3 style="margin-bottom:8px">Candidates</h3><div id="waList"><div class="note">No WhatsApp conversations yet. Release an offer for a candidate with a valid mobile number.</div></div></div>
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
  $('#waLetter').onclick = async () => {
    if (!selected) { toast('Select a candidate first.'); return; }
    const item = { type: 'letter' };
    const cur = window.tcmplCurrent && window.tcmplCurrent();
    const pdf = window.tcmplLetterPdf && window.tcmplLetterPdf();
    // Attach a freshly generated letter when the Offer desk has this candidate open.
    if (cur && candId(cur.mobile) === selected && pdf && pdf.blob instanceof Blob) { item.pdfBase64 = await blobToBase64(pdf.blob); item.filename = pdf.name; }
    const r = await push(selected, [item], 'Offer letter resent');
    if (r.ok) { toast('Offer letter sent on WhatsApp.'); refresh(true); } else toast(explain(r));
  };
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
  if (mount()) { mountJourneyControls(); return; }
  if (n > 100) return;
  setTimeout(() => waitForApp(n + 1), 100);
})(0);
