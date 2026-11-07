// Client setup → Email settings for the selected client: reply-to (who answers when people reply) and the
// CC added to every owner email. The From address is set in Azure (ACS_SENDER).

const U = () => window.tcmplWAUtil;
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function mount() {
  const sec = $('#tab-config');
  if (!sec || $('#slive')) return Boolean($('#slive'));
  const box = document.createElement('div');
  box.id = 'slive';
  box.className = 'card';
  box.style.marginBottom = '16px';
  box.innerHTML = `<h3 style="margin:0 0 4px">Email settings · <span id="slClient"></span></h3>
    <p class="note" style="margin:0 0 10px" id="slNote"></p>
    <div class="grid2">
      <label>Reply-to (replies go to this person, usually HR)<input id="slReply" type="text" placeholder="hr@talentcarriage.com" style="width:100%"></label>
      <label>CC on every email: owners and candidate (optional)<input id="slCc" type="text" placeholder="clienthr@company.com, recruiter@company.com" style="width:100%"></label>
    </div>
    <label style="display:flex;gap:6px;align-items:center;margin-top:8px"><input type="checkbox" id="slMirror" checked> Also email the candidate a copy of what goes on WhatsApp, with the same attachments (offer letter, forms, decks)</label>
    <label style="display:flex;gap:6px;align-items:center;margin-top:4px"><input type="checkbox" id="slMgr"> Copy the candidate's manager on HR alerts (red items: decline, "need help", low ratings, no answer)</label>
    <p class="note" style="margin:4px 0 0">HR alerts go to the HR email in Journey setup → Default contacts (or the Reply-to above) the moment something turns red.</p>
    <p class="note" style="margin:8px 0">Owners' emails come from the People section below: write them like <i>Rohit Verma, IT &lt;rohit@company.com&gt;</i>.</p>
    <div class="row"><button class="btn small primary" id="slSave" type="button">Save email settings</button><span class="note" id="slState"></span></div>`;
  sec.querySelector('.intro').after(box);
  $('#slSave').onclick = save;
  document.querySelectorAll('nav.tabs button').forEach(b => b.addEventListener('click', () => { if (b.dataset.tab === 'config') load(); }));
  const sel = $('#clientSel'); if (sel) sel.addEventListener('change', () => setTimeout(load, 50));
  load();
  return true;
}

async function load() {
  const u = U(); if (!u) return;
  const client = window.tcmplClientId ? window.tcmplClientId() : '';
  $('#slClient').textContent = window.tcmplClientLabel ? window.tcmplClientLabel() : client;
  const h = await u.loadHealth();
  $('#slNote').innerHTML = h.email ? 'Email is connected. Owner tasks, reminders and escalations are sent from the Azure sender address.' : '<b>Email is not connected yet</b> (add ACS_CONNECTION_STRING and ACS_SENDER in Azure). Until then, "Email owner" opens a draft in your Outlook.';
  const r = h.db ? await u.getJson(`/api/data/journeys/${encodeURIComponent(client)}`).catch(() => ({ ok: false })) : { ok: false };
  const e = (r.ok && r.body.data && r.body.data.email) || {};
  $('#slReply').value = e.replyTo || ''; $('#slCc').value = e.cc || ''; $('#slMirror').checked = e.mirror !== false; $('#slMgr').checked = Boolean(e.alertManager);
  $('#slState').textContent = '';
}

async function save() {
  const client = window.tcmplClientId ? window.tcmplClientId() : '';
  const r = await U().getJson('/api/notify/settings', { method: 'POST', body: JSON.stringify({ client, replyTo: $('#slReply').value, cc: $('#slCc').value, mirror: $('#slMirror').checked, alertManager: $('#slMgr').checked }) }).catch(() => ({ ok: false }));
  if (!r.ok) { $('#slState').textContent = 'Not saved.'; return; }
  $('#slReply').value = r.body.email.replyTo; $('#slCc').value = r.body.email.cc;
  $('#slState').textContent = 'Saved' + (r.body.sender ? ' · sent from ' + esc(r.body.sender) : '');
}

(function waitForApp(n) {
  if (window.tcmplWAUtil && window.tcmplClientId && mount()) return;
  if (n > 100) return;
  setTimeout(() => waitForApp(n + 1), 100);
})(0);
