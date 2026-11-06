// HR view, live: every real candidate on one page, using the same rules as Candidate journey.
// One row per candidate: joining date, current stage (with the 8 stage dots), next step, and anything that needs HR.
// Clicking a row opens the candidate in Candidate journey, where everything is done.

const U = () => window.tcmplWAUtil;
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let rows = [], filter = 'all', loading = false;

const fmtDate = iso => iso ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso + 'T00:00:00' : iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';
const fmtTime = iso => iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
function daysTo(iso) { if (!iso) return null; const t = new Date(iso + 'T00:00:00'); const n = new Date(); n.setHours(0, 0, 0, 0); return Math.round((t - n) / 864e5); }
const dLabel = d => d == null ? '' : d === 0 ? 'joins today' : d > 0 ? `in ${d} day${d > 1 ? 's' : ''}` : `day ${-d} after joining`;

function mount() {
  const sec = $('#tab-hr');
  if (!sec || $('#hlive')) return Boolean($('#hlive'));
  // Demo tiles and table are replaced; the released-offers table stays.
  ['#tiles'].forEach(q => { const e = $(q); if (e) e.style.display = 'none'; });
  const demoTbl = $('#hrTbl'); if (demoTbl && demoTbl.closest('.card')) demoTbl.closest('.card').style.display = 'none';
  const p = sec.querySelector('.intro p'); if (p) p.textContent = 'Every candidate in onboarding on one page: where they are, what is next, and what needs HR. Click a candidate to work on them in Candidate journey.';
  const box = document.createElement('div');
  box.id = 'hlive';
  box.innerHTML = `<div class="tiles" id="hlTiles"></div>
    <div class="card" style="margin-bottom:16px">
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div class="row" id="hlFilters">
          <button class="btn small" data-f="all" type="button">All</button>
          <button class="btn small" data-f="red" type="button">Needs HR</button>
          <button class="btn small" data-f="week" type="button">Joining in 7 days</button>
          <button class="btn small" data-f="held" type="button">Waiting for reply</button>
        </div>
        <button class="btn small" id="hlRefresh" type="button">Refresh</button>
      </div>
      <div class="tscroll" style="margin-top:10px"><table class="hl-tbl" id="hlTbl"></table></div>
    </div>`;
  sec.querySelector('.intro').after(box);
  $('#hlRefresh').onclick = load;
  document.querySelectorAll('#hlFilters [data-f]').forEach(b => { b.onclick = () => { filter = b.dataset.f; render(); }; });
  document.querySelectorAll('nav.tabs button').forEach(b => b.addEventListener('click', () => { if (b.dataset.tab === 'hr') load(); }));
  load();
  return true;
}

async function load() {
  const u = U(); if (!u || loading || !window.tcmplLive || !window.tcmplLive.summary) return;
  loading = true;
  try {
    const h = await u.loadHealth();
    if (!h.db) { rows = []; render(); return; }
    const [cr, dr] = await Promise.all([u.getJson('/api/data/candidates'), u.getJson('/api/data/documents')].map(p => p.catch(() => ({ ok: false }))));
    if (!cr.ok) return;
    const docs = dr.ok ? (dr.body.items || []).map(i => i.data) : [];
    const cands = (cr.body.items || []).map(i => Object.assign({ id: i.id }, i.data)).filter(c => c.profile || c.offerId);
    rows = [];
    for (const c of cands) {
      let sm = null;
      try { sm = await window.tcmplLive.summary(c, docs); } catch (e) { console.warn(e); }
      const doj = (c.profile && c.profile.doj) || c.doj;
      const win = c.lastInboundAt && Date.now() - Date.parse(c.lastInboundAt) < 864e5;
      rows.push({ c, sm, doj, d: daysTo(doj), win, held: (c.held || []).length });
    }
    rows.sort((a, b) => ((b.sm && b.sm.red.length) ? 1 : 0) - ((a.sm && a.sm.red.length) ? 1 : 0) || String(a.doj).localeCompare(String(b.doj)));
    render();
  } finally { loading = false; }
}

function render() {
  const n = rows.length, red = rows.filter(r => r.sm && r.sm.red.length).length, week = rows.filter(r => r.d != null && r.d >= 0 && r.d <= 7).length, held = rows.filter(r => r.held).length;
  $('#hlTiles').innerHTML = [['In onboarding', n, ''], ['Need HR', red, red ? 'bad' : 'ok'], ['Joining in 7 days', week, ''], ['Messages waiting for a reply', held, held ? 'warn' : '']]
    .map(([l, v, c]) => `<div class="tile card"><div class="v ${c ? "hl-" + c : ""}">${v}</div><div class="k">${esc(l)}</div></div>`).join('');
  document.querySelectorAll('#hlFilters [data-f]').forEach(b => b.classList.toggle('primary', b.dataset.f === filter));
  const list = rows.filter(r => filter === 'all' || (filter === 'red' && r.sm && r.sm.red.length) || (filter === 'week' && r.d != null && r.d >= 0 && r.d <= 7) || (filter === 'held' && r.held));
  const dot = { done: '✓', red: '!', active: '●', todo: '', empty: '' };
  $('#hlTbl').innerHTML = '<tr><th>Candidate</th><th>Joining</th><th>Stage</th><th>Next step</th><th>Needs HR</th><th>WhatsApp</th><th></th></tr>' + (list.map(r => {
    const c = r.c, sm = r.sm || { phase: '—', next: '', red: [], stages: [] };
    return `<tr data-id="${esc(c.id)}">
      <td><b>${esc(c.name || '+' + c.phone)}</b><div class="note">${esc((c.profile && c.profile.role) || '')}${c.clientLabel ? ' · ' + esc(c.clientLabel) : ''}</div></td>
      <td>${esc(fmtDate(r.doj))}<div class="note">${esc(dLabel(r.d))}</div></td>
      <td><b>${esc(sm.phase)}</b><div class="hl-dots">${sm.stages.map(s => `<span class="hl-dot ${s.state}" title="${esc(s.label)}">${dot[s.state] || ''}</span>`).join('')}</div></td>
      <td>${esc(sm.next || 'All done')}${sm.nextStatus ? `<div class="note">${esc(sm.nextStatus.text)}</div>` : ''}</td>
      <td>${sm.red.length ? sm.red.map(x => `<div class="hl-red">● ${esc(x)}</div>`).join('') : '<span class="note">—</span>'}</td>
      <td>${r.win ? '<span class="chip teal">Open</span>' : '<span class="chip warn">Waiting for reply</span>'}${r.held ? `<div class="note">${r.held} queued</div>` : ''}<div class="note">${esc(fmtTime(c.lastMessageAt))}</div></td>
      <td><button class="btn small primary" data-open="${esc(c.id)}" type="button">Open</button></td></tr>`;
  }).join('') || '<tr><td colspan="7" class="note">No candidates here.</td></tr>');
  document.querySelectorAll('#hlTbl [data-open]').forEach(b => { b.onclick = () => window.tcmplLive.open(b.dataset.open); });
}

(function waitForApp(n) {
  if (window.tcmplWAUtil && window.tcmplLive && window.tcmplLive.summary && mount()) return;
  if (n > 120) return;
  setTimeout(() => waitForApp(n + 1), 100);
})(0);
